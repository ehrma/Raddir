import { useEffect, useCallback } from "react";
import { useVideoStore } from "../stores/videoStore";
import { useServerStore } from "../stores/serverStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useVoiceStore } from "../stores/voiceStore";
import { getSignalingClient } from "./useConnection";
import type {
  ServerNewProducerMessage,
  ServerProducerClosedMessage,
  ServerUserLeftChannelMessage,
} from "@raddir/shared";

const RESOLUTION_MAP = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;

let mediaClientRef: import("../lib/media-client").MediaClient | null = null;
const producerMediaTypes = new Map<string, "webcam" | "screen">();

function isVideoMediaType(mediaType: string | undefined): mediaType is "webcam" | "screen" {
  return mediaType === "webcam" || mediaType === "screen";
}

export function setVideoMediaClient(mc: import("../lib/media-client").MediaClient | null): void {
  mediaClientRef = mc;
}

export function requestVideoLayer(consumerId: string, spatialLayer: number): void {
  if (!mediaClientRef) return;
  mediaClientRef.setPreferredLayers(consumerId, spatialLayer);
}

export function useVideo() {
  const { webcamActive, screenShareActive, showSourcePicker } = useVideoStore();

  // Listen for video producers from other users
  useEffect(() => {
    const signaling = getSignalingClient();
    if (!signaling) return;

    const unsubNewProducer = signaling.on("new-producer", (msg) => {
      const data = msg as ServerNewProducerMessage;
      const currentUserId = useServerStore.getState().userId;
      if (data.userId === currentUserId) return;
      if (!isVideoMediaType(data.mediaType)) return; // audio handled by useAudio

      const mediaType = data.mediaType;
      console.log("[video] new-producer from", data.userId, mediaType, data.producerId);
      producerMediaTypes.set(data.producerId, mediaType);

      if (!mediaClientRef) {
        console.warn("[video] mediaClientRef is null, cannot consume video producer");
        return;
      }

      console.log("[video] Calling mediaClient.consume for", data.producerId);
      mediaClientRef.consume(data.producerId, data.userId).then((consumer) => {
        console.log("[video] consume() resolved, consumer:", consumer ? consumer.id : "null", "track:", consumer?.track?.kind, consumer?.track?.readyState);
        if (!consumer) return;
        const stream = new MediaStream([consumer.track]);
        consumer.track.onended = () => {
          console.log("[video] remote track ended for", data.userId, mediaType);
          useVideoStore.getState().removeRemoteVideo(data.userId, mediaType);
        };
        useVideoStore.getState().addRemoteVideo(data.userId, mediaType, stream, consumer.id);
        console.log("[video] Added remote video for", data.userId, mediaType, "consumerId:", consumer.id);
      }).catch((err) => {
        console.error("[video] Failed to consume video producer:", err);
      });
    });

    const unsubProducerClosed = signaling.on("producer-closed", (msg) => {
      const data = msg as ServerProducerClosedMessage;
      if (!isVideoMediaType(data.mediaType)) return;
      const mediaType = data.mediaType;
      console.log("[video] producer-closed from", data.userId, mediaType);
      useVideoStore.getState().removeRemoteVideo(data.userId, mediaType);
    });

    const unsubUserLeft = signaling.on("user-left-channel", (msg) => {
      const data = msg as ServerUserLeftChannelMessage;
      useVideoStore.getState().removeAllRemoteVideosForUser(data.userId);
    });

    return () => {
      unsubNewProducer();
      unsubProducerClosed();
      unsubUserLeft();
    };
  }, []);

  const startWebcam = useCallback(async () => {
    if (!mediaClientRef) return;
    if (!useVoiceStore.getState().e2eeActive) {
      console.error("[video] Cannot start webcam — E2EE key not established");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      const { webcamResolution, webcamFps, webcamBitrate } = useSettingsStore.getState();
      const res = RESOLUTION_MAP[webcamResolution];
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: res.width }, height: { ideal: res.height }, frameRate: { ideal: webcamFps } },
      });
      await mediaClientRef.produceVideo(stream, "webcam", {
        maxBitrate: webcamBitrate * 1000,
        maxFramerate: webcamFps,
      });
      useVideoStore.getState().setLocalWebcamStream(stream);
      useVideoStore.getState().setWebcamActive(true);
      console.log("[video] Webcam started");
    } catch (err: any) {
      if (stream) for (const t of stream.getTracks()) t.stop();
      console.error("[video] Failed to start webcam:", err?.message ?? err);
    }
  }, []);

  const stopWebcam = useCallback(() => {
    if (!mediaClientRef) return;
    mediaClientRef.stopProducer("webcam");
    const stream = useVideoStore.getState().localWebcamStream;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    useVideoStore.getState().setLocalWebcamStream(null);
    useVideoStore.getState().setWebcamActive(false);
    console.log("[video] Webcam stopped");
  }, []);

  const startScreenShareWithSource = useCallback(async (sourceId: string, includeAudio = false) => {
    if (!mediaClientRef) return;
    if (!useVoiceStore.getState().e2eeActive) {
      console.error("[video] Cannot start screen share — E2EE key not established");
      useVideoStore.getState().setShowSourcePicker(false);
      return;
    }
    let stream: MediaStream | null = null;
    try {
      const canAttemptSystemAudio = includeAudio && sourceId.startsWith("screen:");
      if (includeAudio && !sourceId.startsWith("screen:")) {
        console.warn("[video] System audio is only available for full-screen sources in this build.");
      }

      const sourceSet = await window.raddir?.setScreenShareSource(sourceId, canAttemptSystemAudio);
      if (!sourceSet) {
        throw new Error("Failed to prepare selected screen source");
      }

      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: canAttemptSystemAudio,
      });

      if (canAttemptSystemAudio && stream.getAudioTracks().length === 0) {
        console.warn("[video] Selected source did not provide system audio. Screen video will continue without audio.");
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      const { screenShareBitrate, screenShareFps } = useSettingsStore.getState();
      await mediaClientRef.produceVideo(stream, "screen", {
        maxBitrate: screenShareBitrate * 1000,
        maxFramerate: screenShareFps,
      });

      if (canAttemptSystemAudio && stream.getAudioTracks().length > 0) {
        try {
          await mediaClientRef.produceScreenAudio(new MediaStream([stream.getAudioTracks()[0]!]))
        } catch (audioErr) {
          console.warn("[video] Screen share started without system audio:", audioErr);
        }
      }

      useVideoStore.getState().setLocalScreenStream(stream);
      useVideoStore.getState().setScreenShareActive(true);
      useVideoStore.getState().setShowSourcePicker(false);
      console.log("[video] Screen share started with source:", sourceId);
    } catch (err: any) {
      if (stream) for (const t of stream.getTracks()) t.stop();
      console.error("[video] Failed to start screen share:", err?.message ?? err);
      useVideoStore.getState().setShowSourcePicker(false);
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    if (!mediaClientRef) return;
    // Show the source picker — the actual capture starts when user picks a source
    useVideoStore.getState().setShowSourcePicker(true);
  }, []);

  const stopScreenShare = useCallback(() => {
    if (!mediaClientRef) return;
    mediaClientRef.stopProducer("screen");
    mediaClientRef.stopProducer("screen-audio");
    const stream = useVideoStore.getState().localScreenStream;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    useVideoStore.getState().setLocalScreenStream(null);
    useVideoStore.getState().setScreenShareActive(false);
    console.log("[video] Screen share stopped");
  }, []);

  const toggleWebcam = useCallback(() => {
    if (useVideoStore.getState().webcamActive) {
      stopWebcam();
    } else {
      startWebcam();
    }
  }, [startWebcam, stopWebcam]);

  const toggleScreenShare = useCallback(() => {
    if (useVideoStore.getState().screenShareActive) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [startScreenShare, stopScreenShare]);

  const requestLayer = useCallback((consumerId: string, spatialLayer: number) => {
    if (!mediaClientRef) return;
    mediaClientRef.setPreferredLayers(consumerId, spatialLayer);
  }, []);

  return { webcamActive, screenShareActive, showSourcePicker, toggleWebcam, toggleScreenShare, startWebcam, stopWebcam, startScreenShare, startScreenShareWithSource, stopScreenShare, requestLayer };
}
