import { useEffect, useRef, useCallback } from "react";
import { useServerStore } from "../stores/serverStore";
import { useVoiceStore } from "../stores/voiceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getSignalingClient, getKeyManager } from "./useConnection";
import { MediaClient } from "../lib/media-client";
import { VoiceActivityDetector } from "../lib/audio/vad";
import { playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound } from "../lib/audio/sounds";
import { setFrameEncryptionKey } from "../lib/e2ee/frame-crypto";
import { setActiveMediaClient } from "../lib/audio/audio-bridge";
import type { ServerJoinedChannelMessage, ServerNewProducerMessage } from "@raddir/shared";

let mediaClient: MediaClient | null = null;
let vad: VoiceActivityDetector | null = null;
let localStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let mediaReady = false;
let pendingProducers: Array<{ producerId: string; userId: string }> = [];

export function useAudio() {
  const { currentChannelId, userId } = useServerStore();
  const { isMuted, isDeafened, isPttActive, setSpeaking, setUserSpeaking } = useVoiceStore();
  const { inputDeviceId, outputDeviceId, voiceActivation, vadThreshold, pttKey } = useSettingsStore();
  const prevChannelRef = useRef<string | null>(null);
  const prevMutedRef = useRef(false);
  const prevDeafenedRef = useRef(false);

  // Register signaling listeners once — they persist across channel joins
  useEffect(() => {
    const signaling = getSignalingClient();
    if (!signaling) return;

    const unsubJoined = signaling.on("joined-channel", async (msg) => {
      const data = msg as ServerJoinedChannelMessage;
      console.log("[audio] joined-channel received, setting up audio for", data.channelId);

      // Clean up previous audio if switching channels
      cleanupAudio();
      playJoinSound();

      try {
        const currentUserId = useServerStore.getState().userId;
        const deviceId = useSettingsStore.getState().inputDeviceId;

        mediaClient = new MediaClient(signaling);
        setActiveMediaClient(mediaClient);
        await mediaClient.loadDevice(data.routerRtpCapabilities as any);

        // Send our RTP capabilities to the server so it can create consumers for us
        if (mediaClient.rtpCapabilities) {
          signaling.send({ type: "rtp-capabilities", rtpCapabilities: mediaClient.rtpCapabilities });
        }

        // Wire E2EE key to frame encryption
        const km = getKeyManager();
        if (km) {
          const key = km.getChannelKey();
          setFrameEncryptionKey(key);
          km.setOnKeyChanged((newKey, _epoch) => {
            setFrameEncryptionKey(newKey);
          });
          km.announcePublicKey();
        }

        // Capture mic
        await startMicrophone(deviceId);

        // Produce audio
        if (localStream) {
          await mediaClient.produce(localStream);
          console.log("[audio] Producing audio");

          // If user is already muted, pause the producer immediately
          const { isMuted } = useVoiceStore.getState();
          if (isMuted) {
            mediaClient.pauseProducer();
            console.log("[audio] User is muted, pausing producer");
          }
        }

        // Now ready — consume any producers that arrived during setup
        mediaReady = true;
        console.log("[audio] Media ready, consuming", pendingProducers.length, "pending producers");
        for (const pp of pendingProducers) {
          try {
            await mediaClient.consume(pp.producerId, pp.userId);
            console.log("[audio] Consumed pending producer from", pp.userId);
          } catch (err) {
            console.error("[audio] Failed to consume pending producer:", err);
          }
        }
        pendingProducers = [];
      } catch (err) {
        console.error("[audio] Failed to setup audio pipeline:", err);
      }
    });

    const unsubNewProducer = signaling.on("new-producer", async (msg) => {
      const data = msg as ServerNewProducerMessage;
      const currentUserId = useServerStore.getState().userId;
      if (data.userId === currentUserId) return;

      console.log("[audio] new-producer from", data.userId, data.producerId, "ready:", mediaReady);

      if (!mediaReady || !mediaClient) {
        // Queue for later — setup is still in progress
        pendingProducers.push({ producerId: data.producerId, userId: data.userId });
        return;
      }

      try {
        await mediaClient.consume(data.producerId, data.userId);
        console.log("[audio] Consuming producer from", data.userId);
      } catch (err) {
        console.error("[audio] Failed to consume producer:", err);
      }
    });

    const unsubUserJoined = signaling.on("user-joined-channel", () => {
      playJoinSound();
    });

    const unsubUserLeft = signaling.on("user-left-channel", () => {
      playLeaveSound();
    });

    return () => {
      unsubJoined();
      unsubNewProducer();
      unsubUserJoined();
      unsubUserLeft();
    };
  }, []);

  // Handle leaving a channel
  useEffect(() => {
    const prevChannel = prevChannelRef.current;
    prevChannelRef.current = currentChannelId;

    if (prevChannel && !currentChannelId) {
      playLeaveSound();
      cleanupAudio();
    }
  }, [currentChannelId]);

  // Mute/unmute
  useEffect(() => {
    if (prevMutedRef.current !== isMuted) {
      prevMutedRef.current = isMuted;

      if (isMuted) {
        playMuteSound();
        mediaClient?.pauseProducer();
      } else {
        playUnmuteSound();
        mediaClient?.resumeProducer();
      }

      const signaling = getSignalingClient();
      signaling?.send({ type: "mute", muted: isMuted });
    }
  }, [isMuted]);

  // Deafen
  useEffect(() => {
    if (prevDeafenedRef.current !== isDeafened) {
      prevDeafenedRef.current = isDeafened;

      const signaling = getSignalingClient();
      signaling?.send({ type: "deafen", deafened: isDeafened });

      // When deafened, mute all consumers by setting volume to 0
      // (actual consumer pause would require iterating all consumers)
    }
  }, [isDeafened]);

  // VAD threshold update
  useEffect(() => {
    vad?.setThreshold(vadThreshold);
  }, [vadThreshold]);

  // PTT key handling
  useEffect(() => {
    if (!pttKey || voiceActivation) return;

    // Register global shortcut with Electron
    window.raddir?.registerPttKey(pttKey);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === pttKey && !e.repeat) {
        useVoiceStore.getState().setPttActive(true);
        mediaClient?.resumeProducer();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === pttKey) {
        useVoiceStore.getState().setPttActive(false);
        mediaClient?.pauseProducer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Listen for Electron global PTT (fires when app is unfocused)
    const unsubPtt = window.raddir?.onPttPressed(() => {
      useVoiceStore.getState().setPttActive(true);
      mediaClient?.resumeProducer();
      setTimeout(() => {
        useVoiceStore.getState().setPttActive(false);
        mediaClient?.pauseProducer();
      }, 100);
    });

    // PTT mode: start with producer paused
    mediaClient?.pauseProducer();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      unsubPtt?.();
      window.raddir?.unregisterPttKey();
    };
  }, [pttKey, voiceActivation]);

  // Device hot-switching
  const switchInputDevice = useCallback(async (deviceId: string) => {
    if (!localStream || !mediaClient) return;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
      });

      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      await mediaClient.replaceTrack(newTrack);

      // Stop old tracks
      for (const track of localStream.getAudioTracks()) {
        track.stop();
      }

      localStream = newStream;

      // Re-setup VAD on new stream
      if (voiceActivation && audioContext) {
        vad?.stop();
        const source = audioContext.createMediaStreamSource(newStream);
        vad = new VoiceActivityDetector(audioContext, source, vadThreshold);
        vad.start((speaking) => {
          setSpeaking(speaking);
          const currentUserId = useServerStore.getState().userId;
          if (currentUserId) {
            useVoiceStore.getState().setUserSpeaking(currentUserId, speaking);
          }
          if (speaking) {
            mediaClient?.resumeProducer();
          } else {
            mediaClient?.pauseProducer();
          }
        });
      }
    } catch (err) {
      console.error("[audio] Failed to switch input device:", err);
    }
  }, [voiceActivation, vadThreshold, setSpeaking]);

  // Watch for input device changes
  useEffect(() => {
    if (localStream && inputDeviceId !== "default") {
      switchInputDevice(inputDeviceId);
    }
  }, [inputDeviceId, switchInputDevice]);

  // Master output volume
  const { outputVolume } = useSettingsStore();
  useEffect(() => {
    mediaClient?.setMasterVolume(outputVolume);
  }, [outputVolume]);

  // Per-user volume control
  const setUserVolume = useCallback((targetUserId: string, volume: number) => {
    mediaClient?.setUserVolume(targetUserId, volume);
    useVoiceStore.getState().setUserVolume(targetUserId, volume);
  }, []);

  return { setUserVolume, switchInputDevice };
}

async function startMicrophone(deviceId: string): Promise<void> {
  try {
    const { noiseSuppression, echoCancellation, autoGainControl } = useSettingsStore.getState();
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId !== "default" ? { exact: deviceId } : undefined,
        echoCancellation,
        noiseSuppression,
        autoGainControl,
        sampleRate: 48000,
        channelCount: 1,
      },
    });

    audioContext = new AudioContext({ sampleRate: 48000 });
    const source = audioContext.createMediaStreamSource(localStream);

    const { voiceActivation, vadThreshold } = useSettingsStore.getState();
    if (voiceActivation) {
      vad = new VoiceActivityDetector(audioContext, source, vadThreshold);
      vad.start((speaking) => {
        useVoiceStore.getState().setSpeaking(speaking);
        const currentUserId = useServerStore.getState().userId;
        if (currentUserId) {
          useVoiceStore.getState().setUserSpeaking(currentUserId, speaking);
        }
        const signaling = getSignalingClient();
        signaling?.send({ type: "speaking", speaking });
      });
    }
  } catch (err) {
    console.error("[audio] Failed to get microphone:", err);
  }
}

function cleanupAudio(): void {
  mediaReady = false;
  pendingProducers = [];
  vad?.stop();
  vad = null;

  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop();
    }
    localStream = null;
  }

  mediaClient?.close();
  mediaClient = null;
  setActiveMediaClient(null);

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  setFrameEncryptionKey(null);
}
