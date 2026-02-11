const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

export async function generateChannelKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key);
}

export async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export function generateIV(frameCounter: number, senderId: number): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH);
  const view = new DataView(iv.buffer);
  view.setUint32(0, senderId, true);
  view.setFloat64(4, frameCounter, true);
  return iv;
}

export async function encryptFrame(
  key: CryptoKey,
  frame: ArrayBuffer,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as BufferSource, tagLength: TAG_LENGTH },
    key,
    frame
  );
}

export async function decryptFrame(
  key: CryptoKey,
  encrypted: ArrayBuffer,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as BufferSource, tagLength: TAG_LENGTH },
    key,
    encrypted
  );
}

export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key);
}

export async function importPublicKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    bits,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("raddir-e2ee-v1"),
      info: new TextEncoder().encode("channel-key"),
    },
    hkdfKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptKeyForRecipient(
  channelKey: CryptoKey,
  recipientPublicKey: CryptoKey,
  senderPrivateKey: CryptoKey
): Promise<ArrayBuffer> {
  const sharedKey = await deriveSharedKey(senderPrivateKey, recipientPublicKey);
  const rawChannelKey = await exportKey(channelKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    sharedKey,
    rawChannelKey
  );

  const result = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), IV_LENGTH);
  return result.buffer;
}

export async function decryptKeyFromSender(
  encryptedData: ArrayBuffer,
  senderPublicKey: CryptoKey,
  recipientPrivateKey: CryptoKey
): Promise<CryptoKey> {
  const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);
  const data = new Uint8Array(encryptedData);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const rawKey = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    sharedKey,
    ciphertext
  );

  return importKey(rawKey);
}

export async function ratchetKey(currentKey: CryptoKey): Promise<CryptoKey> {
  const raw = await exportKey(currentKey);
  const hkdfKey = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("raddir-ratchet-v1"),
      info: new TextEncoder().encode("next-key"),
    },
    hkdfKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
