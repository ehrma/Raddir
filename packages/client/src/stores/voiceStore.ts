import { create } from "zustand";

export interface VoiceState {
  isMuted: boolean;
  isDeafened: boolean;
  isPttActive: boolean;
  isSpeaking: boolean;
  e2eeActive: boolean;
  keyEpoch: number;
  userVolumes: Map<string, number>;
  speakingUsers: Set<string>;

  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setPttActive: (active: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setE2eeActive: (active: boolean, epoch?: number) => void;
  setUserVolume: (userId: string, volume: number) => void;
  setUserSpeaking: (userId: string, speaking: boolean) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isMuted: false,
  isDeafened: false,
  isPttActive: false,
  isSpeaking: false,
  e2eeActive: false,
  keyEpoch: 0,
  userVolumes: new Map<string, number>(),
  speakingUsers: new Set<string>(),

  setMuted: (isMuted) => set({ isMuted }),
  setDeafened: (isDeafened) => set({ isDeafened }),
  setPttActive: (isPttActive) => set({ isPttActive }),
  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setE2eeActive: (e2eeActive, keyEpoch) => set({ e2eeActive, ...(keyEpoch !== undefined ? { keyEpoch } : {}) }),

  setUserVolume: (userId, volume) =>
    set((state) => {
      const userVolumes = new Map(state.userVolumes);
      userVolumes.set(userId, volume);
      return { userVolumes };
    }),

  setUserSpeaking: (userId, speaking) =>
    set((state) => {
      const speakingUsers = new Set(state.speakingUsers);
      if (speaking) {
        speakingUsers.add(userId);
      } else {
        speakingUsers.delete(userId);
      }
      return { speakingUsers };
    }),

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  toggleDeafen: () =>
    set((state) => ({
      isDeafened: !state.isDeafened,
      isMuted: !state.isDeafened ? true : state.isMuted,
    })),
}));
