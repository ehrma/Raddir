const IDENTITY_STORAGE_KEY = "raddir-identity";

export interface LocalIdentity {
  publicKey: string;
  privateKey: string;
  algorithm: string;
  createdAt: number;
}

// Try Ed25519 first, fall back to ECDSA P-256 (universally supported)
async function generateIdentityKeyPair(): Promise<{ keyPair: CryptoKeyPair; algorithm: string }> {
  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"]
    );
    return { keyPair, algorithm: "Ed25519" };
  } catch {
    // Ed25519 not supported — fall back to ECDSA P-256
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    return { keyPair, algorithm: "ECDSA-P256" };
  }
}

async function exportPublicKeyHex(key: CryptoKey): Promise<string> {
  // Use SPKI format — works for both Ed25519 and ECDSA
  const spki = await crypto.subtle.exportKey("spki", key);
  return arrayBufferToHex(spki);
}

async function exportPrivateKeyHex(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", key);
  return arrayBufferToHex(pkcs8);
}

function getImportAlgorithm(algorithm: string): AlgorithmIdentifier | EcKeyImportParams {
  if (algorithm === "ECDSA-P256") {
    return { name: "ECDSA", namedCurve: "P-256" };
  }
  return { name: "Ed25519" } as any;
}

async function importPrivateKey(hex: string, algorithm: string): Promise<CryptoKey> {
  const pkcs8 = hexToArrayBuffer(hex);
  return crypto.subtle.importKey("pkcs8", pkcs8, getImportAlgorithm(algorithm), true, ["sign"]);
}

async function importPublicKey(hex: string, algorithm: string): Promise<CryptoKey> {
  const spki = hexToArrayBuffer(hex);
  return crypto.subtle.importKey("spki", spki, getImportAlgorithm(algorithm), true, ["verify"]);
}

export async function getOrCreateIdentity(): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyHex: string;
}> {
  const stored = loadStoredIdentity();

  if (stored) {
    try {
      const algo = stored.algorithm ?? "Ed25519";
      const privateKey = await importPrivateKey(stored.privateKey, algo);
      const publicKey = await importPublicKey(stored.publicKey, algo);
      return {
        keyPair: { privateKey, publicKey },
        publicKeyHex: stored.publicKey,
      };
    } catch {
      console.warn("[identity] Failed to load stored identity, generating new one");
    }
  }

  const { keyPair, algorithm } = await generateIdentityKeyPair();
  const publicKeyHex = await exportPublicKeyHex(keyPair.publicKey);
  const privateKeyHex = await exportPrivateKeyHex(keyPair.privateKey);

  saveIdentity({
    publicKey: publicKeyHex,
    privateKey: privateKeyHex,
    algorithm,
    createdAt: Date.now(),
  });

  console.log(`[identity] Generated ${algorithm} identity key`);
  return { keyPair, publicKeyHex };
}

/**
 * Compute a 12-digit safety number from two public keys using SHA-256.
 * The result is deterministic and identical for both parties.
 * Format: "1234 5678 9012" — easy to read aloud over phone/Signal/SMS.
 */
export async function computeSafetyNumber(
  myPublicKey: string,
  theirPublicKey: string
): Promise<string> {
  const sorted = [myPublicKey, theirPublicKey].sort();
  const combined = sorted[0]! + sorted[1]!;
  const data = new TextEncoder().encode(combined);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert first 5 bytes to a 12-digit number
  let num = BigInt(0);
  for (let i = 0; i < 5; i++) {
    num = (num << BigInt(8)) | BigInt(hashArray[i]!);
  }
  const digits = (num % BigInt(1_000_000_000_000)).toString().padStart(12, "0");
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
}

/**
 * Compute a short fingerprint from a single public key.
 * Format: "ABCD EF01 2345 6789" — the first 16 hex chars in groups of 4.
 */
export function computeFingerprint(publicKey: string): string {
  return publicKey.slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join(" ") ?? "";
}

export function getStoredIdentityPublicKey(): string | null {
  const stored = loadStoredIdentity();
  return stored?.publicKey ?? null;
}

function getSignAlgorithm(algorithm: string): AlgorithmIdentifier | EcdsaParams {
  if (algorithm === "ECDSA-P256") {
    return { name: "ECDSA", hash: "SHA-256" };
  }
  return { name: "Ed25519" } as any;
}

/**
 * Sign arbitrary data with the identity private key.
 * Returns the signature as a base64 string.
 */
export async function signData(data: string): Promise<string | null> {
  try {
    const identity = await getOrCreateIdentity();
    const algo = loadStoredIdentity()?.algorithm ?? "Ed25519";
    const encoded = new TextEncoder().encode(data);
    const signature = await crypto.subtle.sign(
      getSignAlgorithm(algo),
      identity.keyPair.privateKey,
      encoded
    );
    return arrayBufferToBase64(signature);
  } catch {
    return null;
  }
}

/**
 * Verify a signature against data using a public key (SPKI hex).
 */
export async function verifySignature(
  data: string,
  signatureBase64: string,
  publicKeyHex: string,
  algorithm?: string
): Promise<boolean> {
  try {
    const algo = algorithm ?? loadStoredIdentity()?.algorithm ?? "Ed25519";
    const publicKey = await importPublicKey(publicKeyHex, algo);
    const encoded = new TextEncoder().encode(data);
    const signature = base64ToArrayBuffer(signatureBase64);
    return crypto.subtle.verify(
      getSignAlgorithm(algo),
      publicKey,
      signature,
      encoded
    );
  } catch {
    return false;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── Identity Export / Import (passphrase-encrypted) ─────────────────────────

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function exportIdentity(passphrase: string): Promise<string> {
  const stored = loadStoredIdentity();
  if (!stored) throw new Error("No identity to export");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify(stored));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return JSON.stringify({
    version: 1,
    salt: arrayBufferToHex(salt.buffer as ArrayBuffer),
    iv: arrayBufferToHex(iv.buffer as ArrayBuffer),
    data: arrayBufferToHex(ciphertext),
  });
}

export async function importIdentity(fileContents: string, passphrase: string): Promise<void> {
  const file = JSON.parse(fileContents);
  if (file.version !== 1) throw new Error("Unsupported identity file version");

  const salt = new Uint8Array(hexToArrayBuffer(file.salt));
  const iv = new Uint8Array(hexToArrayBuffer(file.iv));
  const ciphertext = hexToArrayBuffer(file.data);
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const identity = JSON.parse(new TextDecoder().decode(plaintext)) as LocalIdentity;

  if (!identity.publicKey || !identity.privateKey) {
    throw new Error("Invalid identity file");
  }

  saveIdentity(identity);
}

function loadStoredIdentity(): LocalIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalIdentity;
  } catch {
    return null;
  }
}

function saveIdentity(identity: LocalIdentity): void {
  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}
