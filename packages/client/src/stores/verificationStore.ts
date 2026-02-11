import { create } from "zustand";

const STORAGE_KEY = "raddir-verified-users";

export interface VerifiedUser {
  publicKey: string;
  nickname: string;
  verifiedAt: number;
}

export interface VerificationState {
  verifiedUsers: Map<string, VerifiedUser>;
  isVerified: (publicKey: string) => boolean;
  verifyUser: (publicKey: string, nickname: string) => void;
  unverifyUser: (publicKey: string) => void;
}

function loadVerified(): Map<string, VerifiedUser> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as VerifiedUser[];
    return new Map(arr.map((v) => [v.publicKey, v]));
  } catch {
    return new Map();
  }
}

function saveVerified(map: Map<string, VerifiedUser>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(map.values())));
  } catch {}
}

export const useVerificationStore = create<VerificationState>((set, get) => ({
  verifiedUsers: loadVerified(),

  isVerified: (publicKey) => get().verifiedUsers.has(publicKey),

  verifyUser: (publicKey, nickname) =>
    set((state) => {
      const verifiedUsers = new Map(state.verifiedUsers);
      verifiedUsers.set(publicKey, { publicKey, nickname, verifiedAt: Date.now() });
      saveVerified(verifiedUsers);
      return { verifiedUsers };
    }),

  unverifyUser: (publicKey) =>
    set((state) => {
      const verifiedUsers = new Map(state.verifiedUsers);
      verifiedUsers.delete(publicKey);
      saveVerified(verifiedUsers);
      return { verifiedUsers };
    }),
}));
