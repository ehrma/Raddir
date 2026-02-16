import { useEffect, useRef, useCallback } from "react";
import { useServerStore } from "../stores/serverStore";
import { useVoiceStore } from "../stores/voiceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getSignalingClient, getKeyManager } from "./useConnection";
import { MediaClient } from "../lib/media-client";
import { VoiceActivityDetector } from "../lib/audio/vad";
import { playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound } from "../lib/audio/sounds";
import { setFrameEncryptionKey, resetFrameCrypto } from "../lib/e2ee/frame-crypto";
import { setActiveMediaClient } from "../lib/audio/audio-bridge";
import { setVideoMediaClient } from "./useVideo";
import type { ServerJoinedChannelMessage, ServerNewProducerMessage } from "@raddir/shared";

let mediaClient: MediaClient | null = null;
let vad: VoiceActivityDetector | null = null;
let vadSource: MediaStreamAudioSourceNode | null = null;
let localStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let mediaReady = false;
let pendingProducers: Array<{ producerId: string; userId: string }> = [];
let lastSentSpeaking: boolean | null = null;
let lastLocalSpeaking: boolean | null = null;
let currentTransmit: boolean | null = null;
let pttPressed = false;
let vadSpeaking = false;

type TransmitMode = "voice-activation" | "ptt";

interface PttBinding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  hasCombo: boolean;
}

function getTransmitMode(): TransmitMode {
  const { voiceActivation, pttKey } = useSettingsStore.getState();
  if (voiceActivation) return "voice-activation";
  if (pttKey) return "ptt";
  // Product rule: no implicit open-mic fallback.
  return "ptt";
}

function normalizePttKeyCode(token: string): string {
  if (!token) return "";
  if (token.startsWith("Key") || token.startsWith("Digit") || token.startsWith("Arrow")) {
    return token;
  }
  if (/^[A-Za-z]$/.test(token)) {
    return `Key${token.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(token)) {
    return `Digit${token}`;
  }

  const map: Record<string, string> = {
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Esc: "Escape",
    Escape: "Escape",
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
  };

  return map[token] ?? token;
}

function parsePttBinding(configured: string): PttBinding | null {
  const raw = configured.trim();
  if (!raw) return null;

  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let keyToken = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "controlleft" || lower === "controlright") {
      ctrl = true;
      continue;
    }
    if (lower === "alt" || lower === "altleft" || lower === "altright" || lower === "option") {
      alt = true;
      continue;
    }
    if (lower === "shift" || lower === "shiftleft" || lower === "shiftright") {
      shift = true;
      continue;
    }
    if (
      lower === "meta" || lower === "super" || lower === "cmd" || lower === "command" ||
      lower === "metaleft" || lower === "metaright" || lower === "win" || lower === "windows"
    ) {
      meta = true;
      continue;
    }
    keyToken = part;
  }

  if (!keyToken) {
    keyToken = parts[parts.length - 1] ?? "";
  }

  const code = normalizePttKeyCode(keyToken);
  if (!code) return null;

  return {
    code,
    ctrl,
    alt,
    shift,
    meta,
    hasCombo: parts.length > 1,
  };
}

function isMatchingPttKeyDown(e: KeyboardEvent, binding: PttBinding): boolean {
  if (e.code !== binding.code) return false;
  return (
    e.ctrlKey === binding.ctrl &&
    e.altKey === binding.alt &&
    e.shiftKey === binding.shift &&
    e.metaKey === binding.meta
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function shouldRegisterGlobalShortcut(configured: string): boolean {
  const binding = parsePttBinding(configured);
  if (!binding) return false;
  // Electron globalShortcut is exclusive and will steal plain keys system-wide.
  // To avoid blocking user input in other apps, only allow explicit combo accelerators.
  return binding.hasCombo;
}

function setLocalSpeakingState(speaking: boolean): void {
  if (lastLocalSpeaking !== speaking) {
    useVoiceStore.getState().setSpeaking(speaking);
    const currentUserId = useServerStore.getState().userId;
    if (currentUserId) {
      useVoiceStore.getState().setUserSpeaking(currentUserId, speaking);
    }
    lastLocalSpeaking = speaking;
  }

  // Never spam the signaling channel with duplicate speaking states.
  if (lastSentSpeaking === speaking) {
    return;
  }
  lastSentSpeaking = speaking;

  const signaling = getSignalingClient();
  signaling?.send({ type: "speaking", speaking });
}

function setTransmitState(shouldTransmit: boolean): void {
  const hasMicProducer = !!mediaClient?.hasProducer("mic");
  if (!hasMicProducer) {
    // Do not cache desired state before producer exists.
    // Otherwise first real pause/resume after produce can be skipped.
    currentTransmit = null;
    return;
  }

  if (currentTransmit === shouldTransmit) return;
  currentTransmit = shouldTransmit;

  if (shouldTransmit) {
    mediaClient?.resumeProducer();
  } else {
    mediaClient?.pauseProducer();
  }
}

function applyAudioState(): void {
  const { isMuted } = useVoiceStore.getState();
  const mode = getTransmitMode();

  let shouldTransmit = false;
  let shouldSpeak = false;

  if (!isMuted) {
    if (mode === "voice-activation") {
      shouldTransmit = vadSpeaking;
      shouldSpeak = vadSpeaking;
    } else {
      shouldTransmit = pttPressed;
      shouldSpeak = pttPressed;
    }
  }

  setTransmitState(shouldTransmit);
  setLocalSpeakingState(shouldSpeak);
}

function restartVadPipeline(): void {
  if (!audioContext || !localStream) return;

  const { vadThreshold } = useSettingsStore.getState();
  const mode = getTransmitMode();
  const needsVad = mode === "voice-activation";

  vad?.stop();
  vad = null;

  try {
    vadSource?.disconnect();
  } catch {}
  vadSource = null;

  vadSpeaking = false;

  if (!needsVad) {
    applyAudioState();
    return;
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  const source = audioContext.createMediaStreamSource(localStream);
  vadSource = source;
  vad = new VoiceActivityDetector(audioContext, source, vadThreshold);
  vad.start((speaking) => {
    vadSpeaking = speaking;
    applyAudioState();
  });

  applyAudioState();
}

/** Get the live audio context (available when in a voice channel) */
export function getLiveAudioContext(): AudioContext | null {
  return audioContext;
}

/** Get the live mic stream (available when in a voice channel) */
export function getLiveStream(): MediaStream | null {
  return localStream;
}

export function useAudio() {
  const { currentChannelId } = useServerStore();
  const { isMuted, isDeafened } = useVoiceStore();
  const inputDeviceId = useSettingsStore((s) => s.inputDeviceId);
  const outputDeviceId = useSettingsStore((s) => s.outputDeviceId);
  const muteKey = useSettingsStore((s) => s.muteKey);
  const deafenKey = useSettingsStore((s) => s.deafenKey);
  const noiseSuppression = useSettingsStore((s) => s.noiseSuppression);
  const echoCancellation = useSettingsStore((s) => s.echoCancellation);
  const autoGainControl = useSettingsStore((s) => s.autoGainControl);
  const voiceActivation = useSettingsStore((s) => s.voiceActivation);
  const vadThreshold = useSettingsStore((s) => s.vadThreshold);
  const pttKey = useSettingsStore((s) => s.pttKey);
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
        setVideoMediaClient(mediaClient);
        await mediaClient.loadDevice(data.routerRtpCapabilities as any);

        // Apply stored output device immediately
        const storedOutputDevice = useSettingsStore.getState().outputDeviceId || "default";
        mediaClient.setOutputDevice(storedOutputDevice).catch(() => {});

        // Send our RTP capabilities to the server so it can create consumers for us
        if (mediaClient.rtpCapabilities) {
          signaling.send({ type: "rtp-capabilities", rtpCapabilities: mediaClient.rtpCapabilities });
        }

        // Wire E2EE key to frame encryption and track active state
        const km = getKeyManager();
        if (!km) {
          console.error("[audio] KeyManager not available — cannot establish E2EE, aborting audio");
          return;
        }

        const serverId = useServerStore.getState().serverId;
        if (serverId) {
          km.setChannelContext(data.channelId, serverId);
        }

        km.onKeyChanged((newKey, epoch) => {
          setFrameEncryptionKey(newKey);
          useVoiceStore.getState().setE2eeActive(!!newKey, epoch);
        });
        km.announcePublicKey();

        // Deterministic key holder election based on min(hash(identityPublicKey))
        const memberIds = (data.users ?? []).map((u: any) => u.userId).concat(currentUserId!);
        await km.electKeyHolder(currentUserId!, memberIds);

        // Wait for E2EE key before producing/consuming audio.
        // If the key doesn't arrive within 10s, abort — never transmit unencrypted.
        let e2eeKey = km.getChannelKey();
        if (!e2eeKey) {
          console.log("[audio] Waiting for E2EE channel key before enabling audio...");
          e2eeKey = await new Promise<CryptoKey | null>((resolve) => {
            const timeout = setTimeout(() => {
              unsub();
              resolve(null);
            }, 10_000);
            const unsub = km.onKeyChanged((newKey) => {
              if (newKey) {
                clearTimeout(timeout);
                unsub();
                resolve(newKey);
              }
            });
          });
        }

        if (!e2eeKey) {
          console.error("[audio] E2EE key not established within timeout — aborting audio (will not transmit unencrypted)");
          useVoiceStore.getState().setE2eeActive(false, 0);
          return;
        }

        setFrameEncryptionKey(e2eeKey);
        useVoiceStore.getState().setE2eeActive(true, km.getKeyEpoch());
        console.log("[audio] E2EE key established, enabling audio");

        // Capture mic
        await startMicrophone(deviceId);

        // Produce audio (E2EE key is guaranteed non-null at this point)
        if (localStream) {
          await mediaClient.produce(localStream);
          console.log("[audio] Producing audio (E2EE active)");

          // Ensure first post-produce state is always applied to the real producer.
          currentTransmit = null;

          // Ensure indicator behavior matches current mode (VA/open-mic/PTT).
          restartVadPipeline();
          applyAudioState();
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
      // Only handle mic producers — video producers are handled by useVideo
      if (data.mediaType && data.mediaType !== "mic") return;

      console.log("[audio] new-producer from", data.userId, data.producerId, "ready:", mediaReady);

      if (!mediaReady || !mediaClient) {
        // Queue for later — setup is still in progress
        pendingProducers.push({ producerId: data.producerId, userId: data.userId });
        return;
      }

      // Only consume if E2EE key is active
      const km2 = getKeyManager();
      if (!km2?.getChannelKey()) {
        console.warn("[audio] Rejecting new-producer from", data.userId, "— no E2EE key");
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
        pttPressed = false;
        useVoiceStore.getState().setPttActive(false);
        applyAudioState();
      } else {
        playUnmuteSound();
        applyAudioState();
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

      // Mute/unmute all incoming audio via master volume
      if (isDeafened) {
        mediaClient?.setMasterVolume(0);
      } else {
        const vol = useSettingsStore.getState().outputVolume;
        mediaClient?.setMasterVolume(vol);
      }
    }
  }, [isDeafened]);

  // VAD threshold update
  useEffect(() => {
    vad?.setThreshold(vadThreshold);
  }, [vadThreshold]);

  // PTT key handling
  useEffect(() => {
    if (!pttKey || voiceActivation) return;

    const pttBinding = parsePttBinding(pttKey);
    if (!pttBinding) return;

    let globalPttReleaseTimer: ReturnType<typeof setTimeout> | null = null;
    const allowGlobalPtt = shouldRegisterGlobalShortcut(pttKey);
    const registerGlobal = () => {
      if (allowGlobalPtt) {
        window.raddir?.registerPttKey(pttKey);
      }
    };
    const unregisterGlobal = () => {
      if (allowGlobalPtt) {
        window.raddir?.unregisterPttKey();
      }
    };

    // Avoid hijacking normal typing while app is focused.
    if (allowGlobalPtt) {
      if (document.hasFocus()) {
        unregisterGlobal();
      } else {
        registerGlobal();
      }
    }

    const handleFocus = () => {
      unregisterGlobal();
    };

    const handleBlur = () => {
      registerGlobal();
    };

    if (allowGlobalPtt) {
      window.addEventListener("focus", handleFocus);
      window.addEventListener("blur", handleBlur);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isMatchingPttKeyDown(e, pttBinding) && !e.repeat) {
        if (useVoiceStore.getState().isMuted) return;
        pttPressed = true;
        useVoiceStore.getState().setPttActive(true);
        applyAudioState();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === pttBinding.code) {
        pttPressed = false;
        useVoiceStore.getState().setPttActive(false);
        applyAudioState();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Listen for Electron global PTT (fires when app is unfocused)
    const unsubPtt = allowGlobalPtt
      ? window.raddir?.onPttPressed(() => {
          // When app is focused, keydown/keyup already provide proper hold semantics.
          // Ignore global shortcut pulse to avoid indicator/transmit flicker.
          if (document.hasFocus()) return;
          if (useVoiceStore.getState().isMuted) return;

          // Global shortcut can fire repeatedly while key is held.
          // Treat repeated pulses as "still held" instead of re-sending speaking=true.
          if (!useVoiceStore.getState().isPttActive) {
            pttPressed = true;
            useVoiceStore.getState().setPttActive(true);
            applyAudioState();
          }

          if (globalPttReleaseTimer) {
            clearTimeout(globalPttReleaseTimer);
          }
          globalPttReleaseTimer = setTimeout(() => {
            pttPressed = false;
            useVoiceStore.getState().setPttActive(false);
            applyAudioState();
            globalPttReleaseTimer = null;
          }, 150);
        })
      : undefined;

    // PTT mode starts idle.
    pttPressed = false;
    applyAudioState();

    return () => {
      if (globalPttReleaseTimer) {
        clearTimeout(globalPttReleaseTimer);
        globalPttReleaseTimer = null;
      }
      pttPressed = false;
      if (allowGlobalPtt) {
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("blur", handleBlur);
      }
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      unsubPtt?.();
      unregisterGlobal();
      applyAudioState();
    };
  }, [pttKey, voiceActivation]);

  // Mute toggle hotkey
  useEffect(() => {
    if (!muteKey) return;

    const muteBinding = parsePttBinding(muteKey);
    if (!muteBinding) return;

    const allowGlobalMute = shouldRegisterGlobalShortcut(muteKey);
    let lastToggleAt = 0;

    const triggerMuteToggle = () => {
      const now = Date.now();
      if (now - lastToggleAt < 150) return;
      lastToggleAt = now;
      useVoiceStore.getState().toggleMute();
    };

    const registerGlobal = () => {
      if (allowGlobalMute) {
        window.raddir?.registerMuteKey(muteKey);
      }
    };
    const unregisterGlobal = () => {
      if (allowGlobalMute) {
        window.raddir?.unregisterMuteKey();
      }
    };

    if (allowGlobalMute) {
      if (document.hasFocus()) {
        unregisterGlobal();
      } else {
        registerGlobal();
      }
    }

    const handleFocus = () => {
      unregisterGlobal();
    };

    const handleBlur = () => {
      registerGlobal();
    };

    if (allowGlobalMute) {
      window.addEventListener("focus", handleFocus);
      window.addEventListener("blur", handleBlur);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isMatchingPttKeyDown(e, muteBinding) && !e.repeat) {
        triggerMuteToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const unsubGlobalMute = allowGlobalMute
      ? window.raddir?.onMuteTogglePressed(() => {
          if (document.hasFocus()) return;
          triggerMuteToggle();
        })
      : undefined;

    return () => {
      if (allowGlobalMute) {
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("blur", handleBlur);
      }
      window.removeEventListener("keydown", handleKeyDown);
      unsubGlobalMute?.();
      unregisterGlobal();
    };
  }, [muteKey]);

  // Deafen toggle hotkey
  useEffect(() => {
    if (!deafenKey) return;

    const deafenBinding = parsePttBinding(deafenKey);
    if (!deafenBinding) return;

    const allowGlobalDeafen = shouldRegisterGlobalShortcut(deafenKey);
    let lastToggleAt = 0;

    const triggerDeafenToggle = () => {
      const now = Date.now();
      if (now - lastToggleAt < 150) return;
      lastToggleAt = now;
      useVoiceStore.getState().toggleDeafen();
    };

    const registerGlobal = () => {
      if (allowGlobalDeafen) {
        window.raddir?.registerDeafenKey(deafenKey);
      }
    };
    const unregisterGlobal = () => {
      if (allowGlobalDeafen) {
        window.raddir?.unregisterDeafenKey();
      }
    };

    if (allowGlobalDeafen) {
      if (document.hasFocus()) {
        unregisterGlobal();
      } else {
        registerGlobal();
      }
    }

    const handleFocus = () => {
      unregisterGlobal();
    };

    const handleBlur = () => {
      registerGlobal();
    };

    if (allowGlobalDeafen) {
      window.addEventListener("focus", handleFocus);
      window.addEventListener("blur", handleBlur);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isMatchingPttKeyDown(e, deafenBinding) && !e.repeat) {
        triggerDeafenToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const unsubGlobalDeafen = allowGlobalDeafen
      ? window.raddir?.onDeafenTogglePressed(() => {
          if (document.hasFocus()) return;
          triggerDeafenToggle();
        })
      : undefined;

    return () => {
      if (allowGlobalDeafen) {
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("blur", handleBlur);
      }
      window.removeEventListener("keydown", handleKeyDown);
      unsubGlobalDeafen?.();
      unregisterGlobal();
    };
  }, [deafenKey]);

  // Reconfigure VAD + producer state when mode changes.
  useEffect(() => {
    restartVadPipeline();
    applyAudioState();
  }, [voiceActivation, pttKey, isMuted]);

  // Device hot-switching
  const switchInputDevice = useCallback(async (deviceId: string) => {
    if (!localStream || !mediaClient) return;

    try {
      const { echoCancellation, noiseSuppression, autoGainControl } = useSettingsStore.getState();
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId !== "default" ? { exact: deviceId } : undefined,
          echoCancellation,
          noiseSuppression,
          autoGainControl,
          sampleRate: 48000,
          channelCount: 1,
        },
      });

      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      await mediaClient.replaceTrack(newTrack);

      // Stop old tracks
      for (const track of localStream.getAudioTracks()) {
        track.stop();
      }

      localStream = newStream;

      restartVadPipeline();
    } catch (err) {
      console.error("[audio] Failed to switch input device:", err);
    }
  }, []);

  // Watch for input device changes
  useEffect(() => {
    if (localStream) {
      switchInputDevice(inputDeviceId);
    }
  }, [inputDeviceId, switchInputDevice]);

  // Hot-apply mic processing toggles by re-acquiring the current input.
  useEffect(() => {
    if (localStream) {
      const selectedInput = useSettingsStore.getState().inputDeviceId;
      switchInputDevice(selectedInput);
    }
  }, [noiseSuppression, echoCancellation, autoGainControl, switchInputDevice]);

  // Re-acquire selected devices when OS/device topology changes.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      const selectedInput = useSettingsStore.getState().inputDeviceId;
      if (localStream) {
        switchInputDevice(selectedInput);
      }

      const selectedOutput = useSettingsStore.getState().outputDeviceId;
      mediaClient?.setOutputDevice(selectedOutput).catch(() => {});
    };

    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [switchInputDevice]);

  // Output device routing
  useEffect(() => {
    mediaClient?.setOutputDevice(outputDeviceId);
  }, [outputDeviceId]);

  // Master output volume
  const outputVolume = useSettingsStore((s) => s.outputVolume);
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
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }
    audioContext.addEventListener("statechange", () => {
      if (audioContext?.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
    });
    restartVadPipeline();
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
  setVideoMediaClient(null);

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  try {
    vadSource?.disconnect();
  } catch {}
  vadSource = null;

  pttPressed = false;
  vadSpeaking = false;
  currentTransmit = null;
  setLocalSpeakingState(false);
  lastLocalSpeaking = null;
  lastSentSpeaking = null;

  resetFrameCrypto();
}
