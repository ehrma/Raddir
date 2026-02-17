import { Device } from "mediasoup-client";
import type { Transport, Producer, Consumer, RtpCapabilities, DtlsParameters, MediaKind, RtpParameters } from "mediasoup-client/types";
import type { SignalingClient } from "./signaling-client";
import {
  ServerTransportCreatedMessage,
  ServerProducedMessage,
  ServerConsumeResultMessage,
} from "@raddir/shared";
import { applyEncryptTransform, applyDecryptTransform } from "./e2ee/frame-crypto";

type OutgoingMediaType = "mic" | "webcam" | "screen" | "screen-audio";

interface RoutedAudioConsumer {
  userId: string;
  gain: GainNode;
  audio: HTMLAudioElement;
}

export class MediaClient {
  private device: Device;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers = new Map<OutgoingMediaType, Producer>();
  private consumers = new Map<string, Consumer>();
  private signaling: SignalingClient;
  private audioContext: AudioContext;
  private audioConsumers = new Map<string, RoutedAudioConsumer>(); // keyed by consumerId
  private masterVolume = 1.0;
  private userVolumes = new Map<string, number>();
  private outputDeviceId = "default";
  private onConsumerCreated?: (userId: string, consumer: Consumer, stream: MediaStream) => void;
  private onVideoConsumerCreated?: (userId: string, consumer: Consumer, stream: MediaStream, mediaType: string) => void;
  private pendingMediaType: OutgoingMediaType = "mic";
  private micSendTrack: MediaStreamTrack | null = null;

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
    this.device = new Device();
    this.audioContext = new AudioContext();
  }

  async loadDevice(routerRtpCapabilities: RtpCapabilities): Promise<void> {
    if (!this.device.loaded) {
      await this.device.load({ routerRtpCapabilities });
    }
  }

  async createSendTransport(): Promise<void> {
    const transportData = await this.requestTransport("send");
    if (!transportData) return;

    this.sendTransport = this.device.createSendTransport({
      id: transportData.transportId,
      iceParameters: transportData.iceParameters as any,
      iceCandidates: transportData.iceCandidates as any,
      dtlsParameters: transportData.dtlsParameters as any,
    });

    this.sendTransport.on("connect", ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback: () => void, errback: (err: Error) => void) => {
      this.signaling.send({
        type: "connect-transport",
        transportId: this.sendTransport!.id,
        dtlsParameters,
      });
      callback();
    });

    this.sendTransport.on("produce", ({ kind, rtpParameters }: { kind: MediaKind; rtpParameters: RtpParameters }, callback: (arg: { id: string }) => void, errback: (err: Error) => void) => {
      this.signaling.send({
        type: "produce",
        transportId: this.sendTransport!.id,
        kind,
        rtpParameters,
        mediaType: this.pendingMediaType,
      });

      const unsub = this.signaling.on("produced", (msg) => {
        const produced = msg as ServerProducedMessage;
        unsubErr();
        callback({ id: produced.producerId });
        unsub();
      });

      const unsubErr = this.signaling.on("error", (msg: any) => {
        if (msg.code === "PRODUCER_LIMIT" || msg.code === "NO_PERMISSION") {
          unsub();
          unsubErr();
          errback(new Error(msg.message ?? msg.code));
        }
      });
    });
  }

  async createRecvTransport(): Promise<void> {
    const transportData = await this.requestTransport("recv");
    if (!transportData) return;

    this.recvTransport = this.device.createRecvTransport({
      id: transportData.transportId,
      iceParameters: transportData.iceParameters as any,
      iceCandidates: transportData.iceCandidates as any,
      dtlsParameters: transportData.dtlsParameters as any,
    });

    this.recvTransport.on("connect", ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback: () => void, errback: (err: Error) => void) => {
      console.log("[media] recvTransport connecting...");
      this.signaling.send({
        type: "connect-transport",
        transportId: this.recvTransport!.id,
        dtlsParameters,
      });
      callback();
    });

    this.recvTransport.on("connectionstatechange", (state: string) => {
      console.log("[media] recvTransport connection state:", state);
    });
  }

  async produce(stream: MediaStream): Promise<void> {
    if (!this.sendTransport) {
      await this.createSendTransport();
    }

    const sourceTrack = stream.getAudioTracks()[0];
    if (!sourceTrack) throw new Error("No audio track in stream");
    const sendTrack = sourceTrack.clone();
    if (this.micSendTrack) {
      this.micSendTrack.stop();
    }
    this.micSendTrack = sendTrack;

    this.pendingMediaType = "mic";
    const producer = await this.sendTransport!.produce({
      track: sendTrack,
      // Keep track enabled while paused so local VAD can still read mic energy.
      // Otherwise VA deadlocks: paused producer disables track => VAD sees silence forever.
      disableTrackOnPause: false,
      // But still force actual RTP muting when paused (for mute/PTT/deafen semantics).
      zeroRtpOnPause: true,
      codecOptions: {
        opusStereo: true,
        opusDtx: true,
        opusFec: true,
        opusMaxPlaybackRate: 48000,
      },
      encodings: [{ maxBitrate: 128000 }],
    });

    this.producers.set("mic", producer);

    // Apply E2EE encrypt transform to outgoing audio frames
    const sender = producer.rtpSender;
    if (sender) {
      applyEncryptTransform(sender);
    }

    producer.on("transportclose", () => {
      console.log("[media] Mic producer transport closed");
      this.producers.delete("mic");
      this.micSendTrack?.stop();
      this.micSendTrack = null;
    });
  }

  async produceVideo(
    stream: MediaStream,
    mediaType: "webcam" | "screen",
    encodingOptions?: { maxBitrate?: number; maxFramerate?: number }
  ): Promise<Producer> {
    if (!this.sendTransport) {
      await this.createSendTransport();
    }

    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("No video track in stream");

    const maxBr = encodingOptions?.maxBitrate;
    const maxFps = encodingOptions?.maxFramerate;

    // Simulcast: 3 layers for webcam, 2 for screen share
    const encodings = mediaType === "screen"
      ? [
          { rid: "q", maxBitrate: Math.round((maxBr ?? 2_500_000) * 0.25), scaleResolutionDownBy: 2 },
          { rid: "f", maxBitrate: maxBr ?? 2_500_000 },
        ]
      : [
          { rid: "q", maxBitrate: 150_000, scaleResolutionDownBy: 4, maxFramerate: maxFps ?? 30 },
          { rid: "h", maxBitrate: Math.round((maxBr ?? 1_500_000) * 0.35), scaleResolutionDownBy: 2, maxFramerate: maxFps ?? 30 },
          { rid: "f", maxBitrate: maxBr ?? 1_500_000, maxFramerate: maxFps ?? 30 },
        ];

    this.pendingMediaType = mediaType;
    const producer = await this.sendTransport!.produce({
      track,
      encodings,
      codecOptions: { videoGoogleStartBitrate: 300 },
    });

    this.producers.set(mediaType, producer);

    // Apply E2EE encrypt transform to outgoing video frames
    const sender = producer.rtpSender;
    if (sender) {
      applyEncryptTransform(sender, "video");
    }

    producer.on("transportclose", () => {
      console.log(`[media] ${mediaType} producer transport closed`);
      this.producers.delete(mediaType);
    });

    return producer;
  }

  async produceScreenAudio(stream: MediaStream): Promise<Producer | null> {
    if (!this.sendTransport) {
      await this.createSendTransport();
    }

    const existing = this.producers.get("screen-audio");
    if (existing) {
      this.signaling.send({ type: "stop-producer", producerId: existing.id });
      existing.close();
      this.producers.delete("screen-audio");
    }

    const track = stream.getAudioTracks()[0];
    if (!track) return null;

    this.pendingMediaType = "screen-audio";
    const producer = await this.sendTransport!.produce({
      track,
      disableTrackOnPause: false,
      zeroRtpOnPause: true,
      codecOptions: {
        opusStereo: true,
        opusDtx: true,
        opusFec: true,
        opusMaxPlaybackRate: 48000,
      },
      encodings: [{ maxBitrate: 128000 }],
    });

    this.producers.set("screen-audio", producer);

    const sender = producer.rtpSender;
    if (sender) {
      applyEncryptTransform(sender);
    }

    producer.on("transportclose", () => {
      console.log("[media] screen-audio producer transport closed");
      this.producers.delete("screen-audio");
    });

    return producer;
  }

  setPreferredLayers(consumerId: string, spatialLayer: number, temporalLayer?: number): void {
    this.signaling.send({
      type: "set-preferred-layers",
      consumerId,
      spatialLayer,
      ...(temporalLayer !== undefined ? { temporalLayer } : {}),
    });
  }

  stopProducer(mediaType: OutgoingMediaType): void {
    const producer = this.producers.get(mediaType);
    if (!producer) return;

    // Tell server to close this producer
    this.signaling.send({ type: "stop-producer", producerId: producer.id });
    producer.close();
    this.producers.delete(mediaType);
    if (mediaType === "mic") {
      this.micSendTrack?.stop();
      this.micSendTrack = null;
    }
  }

  getProducerId(mediaType: OutgoingMediaType): string | undefined {
    return this.producers.get(mediaType)?.id;
  }

  hasProducer(mediaType: OutgoingMediaType): boolean {
    return this.producers.has(mediaType);
  }

  async consume(producerId: string, userId: string): Promise<Consumer | null> {
    if (!this.recvTransport) {
      await this.createRecvTransport();
    }

    console.log("[media] Sending consume request for producer", producerId);
    this.signaling.send({ type: "consume", producerId });

    return new Promise((resolve) => {
      const unsub = this.signaling.on("consume-result", (msg) => {
        const result = msg as ServerConsumeResultMessage;
        if (result.producerId !== producerId) return;
        unsub();
        console.log("[media] Got consume-result, consumerId:", result.consumerId);

        this.recvTransport!
          .consume({
            id: result.consumerId,
            producerId: result.producerId,
            kind: result.kind,
            rtpParameters: result.rtpParameters as any,
          })
          .then(async (consumer: Consumer) => {
            this.consumers.set(consumer.id, consumer);
            console.log("[media] Consumer created, track:", consumer.track.kind, "readyState:", consumer.track.readyState, "paused:", consumer.paused);

            // Apply E2EE decrypt transform to incoming frames
            const receiver = consumer.rtpReceiver;
            if (receiver) {
              applyDecryptTransform(receiver, result.kind as "audio" | "video");
            }

            const stream = new MediaStream([consumer.track]);

            const cleanupConsumer = () => {
              this.consumers.delete(consumer.id);
              const routed = this.audioConsumers.get(consumer.id);
              if (routed) {
                try { routed.gain.disconnect(); } catch {}
                routed.audio.srcObject = null;
                routed.audio.remove();
                this.audioConsumers.delete(consumer.id);
              }
            };

            if (result.kind === "video") {
              // Video consumer — emit via callback, no audio routing
              console.log("[media] Sending resume-consumer for video", consumer.id);
              this.signaling.send({ type: "resume-consumer", consumerId: consumer.id });

              consumer.on("transportclose", cleanupConsumer);
              consumer.on("trackended", cleanupConsumer);
              consumer.on("@close", cleanupConsumer);

              this.onVideoConsumerCreated?.(userId, consumer, stream, "video");
              resolve(consumer);
            } else {
              // Audio consumer — route through Web Audio GainNode
              if (this.audioContext.state === "suspended") {
                await this.audioContext.resume();
              }
              const source = this.audioContext.createMediaStreamSource(stream);
              const gain = this.audioContext.createGain();
              const userVol = this.userVolumes.get(userId) ?? 1.0;
              gain.gain.value = this.masterVolume * userVol;
              source.connect(gain);
              gain.connect(this.audioContext.destination);

              // Hidden audio element to keep the WebRTC track alive
              const audio = document.createElement("audio");
              audio.srcObject = stream;
              audio.autoplay = true;
              audio.muted = true; // keep track alive; playback is via GainNode
              audio.volume = 0;
              if (this.outputDeviceId !== "default" && typeof (audio as any).setSinkId === "function") {
                (audio as any).setSinkId(this.outputDeviceId).catch(() => {});
              }
              document.body.appendChild(audio);
              audio.play().catch(() => {});
              this.audioConsumers.set(consumer.id, { userId, gain, audio });

              // Resume consumer on server side (it starts paused)
              console.log("[media] Sending resume-consumer for", consumer.id);
              this.signaling.send({ type: "resume-consumer", consumerId: consumer.id });

              consumer.on("transportclose", cleanupConsumer);
              consumer.on("trackended", cleanupConsumer);
              consumer.on("@close", cleanupConsumer);

              this.onConsumerCreated?.(userId, consumer, stream);
              resolve(consumer);
            }
          })
          .catch((err: Error) => {
            console.error("[media] Failed to consume:", err);
            resolve(null);
          });
      });
    });
  }

  setUserVolume(userId: string, volume: number): void {
    this.userVolumes.set(userId, Math.max(0, volume));
    const safeVolume = Math.max(0, volume);
    for (const routed of this.audioConsumers.values()) {
      if (routed.userId !== userId) continue;
      routed.gain.gain.value = this.masterVolume * safeVolume;
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    console.log("[media] setOutputDevice:", deviceId);
    // Route AudioContext to the selected device (Chromium 110+)
    if (typeof (this.audioContext as any).setSinkId === "function") {
      try {
        await (this.audioContext as any).setSinkId(deviceId);
        console.log("[media] AudioContext.setSinkId succeeded");
      } catch (err) {
        console.error("[media] AudioContext.setSinkId failed:", err);
      }
    } else {
      console.warn("[media] AudioContext.setSinkId not available");
    }
    // Route all existing audio elements
    for (const routed of this.audioConsumers.values()) {
      const audio = routed.audio;
      if (typeof (audio as any).setSinkId === "function") {
        (audio as any).setSinkId(deviceId).catch(() => {});
      }
    }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, volume);
    for (const routed of this.audioConsumers.values()) {
      const userVol = this.userVolumes.get(routed.userId) ?? 1.0;
      routed.gain.gain.value = this.masterVolume * userVol;
    }
  }

  setOnConsumerCreated(callback: (userId: string, consumer: Consumer, stream: MediaStream) => void): void {
    this.onConsumerCreated = callback;
  }

  setOnVideoConsumerCreated(callback: (userId: string, consumer: Consumer, stream: MediaStream, mediaType: string) => void): void {
    this.onVideoConsumerCreated = callback;
  }

  pauseProducer(): void {
    const mic = this.producers.get("mic");
    if (mic) {
      const track = this.micSendTrack ?? mic.track;
      if (track) track.enabled = false;
      mic.pause();
    }
  }

  resumeProducer(): void {
    const mic = this.producers.get("mic");
    if (mic) {
      const track = this.micSendTrack ?? mic.track;
      if (track) track.enabled = true;
      mic.resume();
    }
  }

  async replaceTrack(newTrack: MediaStreamTrack): Promise<void> {
    const mic = this.producers.get("mic");
    if (mic) {
      const replacement = newTrack.clone();
      const previous = this.micSendTrack ?? mic.track;
      await mic.replaceTrack({ track: replacement });
      this.micSendTrack = replacement;
      if (previous && previous !== replacement) {
        previous.stop();
      }
    }
  }

  get rtpCapabilities(): RtpCapabilities | undefined {
    return this.device.loaded ? this.device.rtpCapabilities : undefined;
  }

  close(): void {
    this.micSendTrack?.stop();
    this.micSendTrack = null;
    for (const producer of this.producers.values()) {
      producer.close();
    }
    this.producers.clear();
    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.consumers.clear();
    for (const routed of this.audioConsumers.values()) {
      routed.audio.srcObject = null;
      routed.audio.remove();
    }
    this.audioConsumers.clear();
    this.sendTransport = null;
    this.recvTransport = null;
  }

  private requestTransport(direction: "send" | "recv"): Promise<ServerTransportCreatedMessage | null> {
    return new Promise((resolve) => {
      this.signaling.send({ type: "create-transport", direction });

      const unsub = this.signaling.on("transport-created", (msg) => {
        unsub();
        resolve(msg as ServerTransportCreatedMessage);
      });

      setTimeout(() => {
        unsub();
        resolve(null);
      }, 10000);
    });
  }
}
