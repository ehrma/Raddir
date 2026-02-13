import { useEffect, useCallback } from "react";
import { useVideoStore } from "../stores/videoStore";
import { useServerStore } from "../stores/serverStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useVoiceStore } from "../stores/voiceStore";
import { getSignalingClient } from "./useConnection";
import type { ServerNewProducerMessage, ServerProducerClosedMessage } from "@raddir/shared";

const RESOLUTION_MAP = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;

let mediaClientRef: import("../lib/media-client").MediaClient | null = null;

export function setVideoMediaClient(mc: import("../lib/media-client").MediaClient | null): void {
  mediaClientRef = mc;
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
      if (!data.mediaType || data.mediaType === "mic") return; // audio handled by useAudio

      const mediaType = data.mediaType as "webcam" | "screen";
      console.log("[video] new-producer from", data.userId, mediaType, data.producerId);

      if (!mediaClientRef) return;

      mediaClientRef.consume(data.producerId, data.userId).then((consumer) => {
        if (!consumer) return;
        // The MediaClient's onVideoConsumerCreated callback handles adding to the store
      }).catch((err) => {
        console.error("[video] Failed to consume video producer:", err);
      });
    });

    const unsubProducerClosed = signaling.on("producer-closed", (msg) => {
      const data = msg as ServerProducerClosedMessage;
      if (!data.mediaType || data.mediaType === "mic") return;
      const mediaType = data.mediaType as "webcam" | "screen";
      console.log("[video] producer-closed from", data.userId, mediaType);
      useVideoStore.getState().removeRemoteVideo(data.userId, mediaType);
    });

    // Wire up the video consumer callback on the media client
    if (mediaClientRef) {
      mediaClientRef.setOnVideoConsumerCreated((userId, _consumer, stream, _mediaType) => {
        // Determine actual mediaType from the producer info — for now default to "webcam"
        // The server sends mediaType in new-producer but not in consume-result,
        // so we track it via the new-producer listener above
        useVideoStore.getState().addRemoteVideo(userId, "webcam", stream);
      });
    }

    return () => {
      unsubNewProducer();
      unsubProducerClosed();
    };
  }, []);

  const startWebcam = useCallback(async () => {
    if (!mediaClientRef) return;
    if (!useVoiceStore.getState().e2eeActive) {
      console.error("[video] Cannot start webcam — E2EE key not established");
      return;
    }
    try {
      const { webcamResolution, webcamFps, webcamBitrate } = useSettingsStore.getState();
      const res = RESOLUTION_MAP[webcamResolution];
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: res.width }, height: { ideal: res.height }, frameRate: { ideal: webcamFps } },
      });
      await mediaClientRef.produceVideo(stream, "webcam", {
        maxBitrate: webcamBitrate * 1000,
        maxFramerate: webcamFps,
      });
      useVideoStore.getState().setLocalWebcamStream(stream);
      useVideoStore.getState().setWebcamActive(true);
      console.log("[video] Webcam started");
    } catch (err) {
      console.error("[video] Failed to start webcam:", err);
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

  const startScreenShareWithSource = useCallback(async (sourceId: string) => {
    if (!mediaClientRef) return;
    if (!useVoiceStore.getState().e2eeActive) {
      console.error("[video] Cannot start screen share — E2EE key not established");
      useVideoStore.getState().setShowSourcePicker(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
          },
        } as any,
      });

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
      useVideoStore.getState().setLocalScreenStream(stream);
      useVideoStore.getState().setScreenShareActive(true);
      useVideoStore.getState().setShowSourcePicker(false);
      console.log("[video] Screen share started with source:", sourceId);
    } catch (err) {
      console.error("[video] Failed to start screen share:", err);
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

  return { webcamActive, screenShareActive, showSourcePicker, toggleWebcam, toggleScreenShare, startWebcam, stopWebcam, startScreenShare, startScreenShareWithSource, stopScreenShare };
}
