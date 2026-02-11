export interface E2EEPublicKeyAnnounce {
  kind: "public-key-announce";
  ecdhPublicKey: string;
  identityPublicKey?: string;
  targetUserId?: string;
}

export interface E2EEEncryptedChannelKey {
  kind: "encrypted-channel-key";
  targetUserId: string;
  encryptedKey: string;
  senderEcdhPublicKey: string;
  keyEpoch: number;
}

export interface E2EEKeyRatchet {
  kind: "key-ratchet";
  keyEpoch: number;
  reason: "member-left" | "periodic" | "manual";
}

export interface E2EEVerificationRequest {
  kind: "verification-request";
  targetUserId: string;
  safetyNumber: string;
}

export interface E2EEVerificationConfirm {
  kind: "verification-confirm";
  targetUserId: string;
  confirmed: boolean;
}

export type E2EEKeyExchangeMessage =
  | E2EEPublicKeyAnnounce
  | E2EEEncryptedChannelKey
  | E2EEKeyRatchet
  | E2EEVerificationRequest
  | E2EEVerificationConfirm;

export interface E2EEFrameHeader {
  keyEpoch: number;
  senderId: number;
  frameCounter: number;
}

export const E2EE_FRAME_HEADER_SIZE = 12;
export const E2EE_IV_SIZE = 12;
export const E2EE_TAG_SIZE = 16;
export const E2EE_KEY_SIZE = 32;
