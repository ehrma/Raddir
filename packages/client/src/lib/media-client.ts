import { Device } from "mediasoup-client";
import type { Transport, Producer, Consumer, RtpCapabilities, DtlsParameters, MediaKind, RtpParameters } from "mediasoup-client/types";
import type { SignalingClient } from "./signaling-client";
import type {
  ServerTransportCreatedMessage,
  ServerProducedMessage,
  ServerConsumeResultMessage,
} from "@raddir/shared";

export class MediaClient {
  private device: Device;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producer: Producer | null = null;
  private consumers = new Map<string, Consumer>();
  private signaling: SignalingClient;
  private audioContext: AudioContext;
  private gainNodes = new Map<string, GainNode>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private masterVolume = 1.0;
  private userVolumes = new Map<string, number>();
  private outputDeviceId = "default";
  private onConsumerCreated?: (userId: string, consumer: Consumer, stream: MediaStream) => void;

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
        kind: "audio",
        rtpParameters,
      });

      const unsub = this.signaling.on("produced", (msg) => {
        const produced = msg as ServerProducedMessage;
        callback({ id: produced.producerId });
        unsub();
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

    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("No audio track in stream");

    this.producer = await this.sendTransport!.produce({
      track,
      codecOptions: {
        opusStereo: true,
        opusDtx: true,
        opusFec: true,
        opusMaxPlaybackRate: 48000,
      },
      encodings: [{ maxBitrate: 128000 }],
    });

    this.producer.on("transportclose", () => {
      console.log("[media] Producer transport closed");
      this.producer = null;
    });
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
          .then((consumer: Consumer) => {
            this.consumers.set(consumer.id, consumer);
            console.log("[media] Consumer created, track:", consumer.track.kind, "readyState:", consumer.track.readyState, "paused:", consumer.paused);

            // Route through Web Audio GainNode for volume boost beyond 100%
            const stream = new MediaStream([consumer.track]);
            const source = this.audioContext.createMediaStreamSource(stream);
            const gain = this.audioContext.createGain();
            const userVol = this.userVolumes.get(userId) ?? 1.0;
            gain.gain.value = this.masterVolume * userVol;
            source.connect(gain);
            gain.connect(this.audioContext.destination);
            this.gainNodes.set(userId, gain);

            // Hidden audio element to keep the WebRTC track alive
            const audio = document.createElement("audio");
            audio.srcObject = stream;
            audio.autoplay = true;
            audio.volume = 0; // muted — playback is via GainNode
            if (this.outputDeviceId !== "default" && typeof (audio as any).setSinkId === "function") {
              (audio as any).setSinkId(this.outputDeviceId).catch(() => {});
            }
            document.body.appendChild(audio);
            audio.play().catch(() => {});
            this.audioElements.set(userId, audio);

            // Resume consumer on server side (it starts paused)
            console.log("[media] Sending resume-consumer for", consumer.id);
            this.signaling.send({ type: "resume-consumer", consumerId: consumer.id });

            consumer.on("transportclose", () => {
              this.consumers.delete(consumer.id);
              this.gainNodes.delete(userId);
              const el = this.audioElements.get(userId);
              if (el) { el.srcObject = null; el.remove(); }
              this.audioElements.delete(userId);
            });

            this.onConsumerCreated?.(userId, consumer, stream);
            resolve(consumer);
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
    const gain = this.gainNodes.get(userId);
    if (gain) {
      gain.gain.value = this.masterVolume * Math.max(0, volume);
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    // Route AudioContext to the selected device (Chromium 110+)
    if (typeof (this.audioContext as any).setSinkId === "function") {
      await (this.audioContext as any).setSinkId(deviceId).catch(() => {});
    }
    // Route all existing audio elements
    for (const audio of this.audioElements.values()) {
      if (typeof (audio as any).setSinkId === "function") {
        (audio as any).setSinkId(deviceId).catch(() => {});
      }
    }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, volume);
    for (const [userId, gain] of this.gainNodes.entries()) {
      const userVol = this.userVolumes.get(userId) ?? 1.0;
      gain.gain.value = this.masterVolume * userVol;
    }
  }

  setOnConsumerCreated(callback: (userId: string, consumer: Consumer, stream: MediaStream) => void): void {
    this.onConsumerCreated = callback;
  }

  pauseProducer(): void {
    if (this.producer) {
      this.producer.pause();
      // Also disable the track to guarantee silence
      const track = this.producer.track;
      if (track) track.enabled = false;
    }
  }

  resumeProducer(): void {
    if (this.producer) {
      // Re-enable the track first
      const track = this.producer.track;
      if (track) track.enabled = true;
      this.producer.resume();
    }
  }

  async replaceTrack(newTrack: MediaStreamTrack): Promise<void> {
    if (this.producer) {
      await this.producer.replaceTrack({ track: newTrack });
    }
  }

  get rtpCapabilities(): RtpCapabilities | undefined {
    return this.device.loaded ? this.device.rtpCapabilities : undefined;
  }

  close(): void {
    this.producer?.close();
    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.consumers.clear();
    this.gainNodes.clear();
    for (const el of this.audioElements.values()) {
      el.srcObject = null;
      el.remove();
    }
    this.audioElements.clear();
    this.producer = null;
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
