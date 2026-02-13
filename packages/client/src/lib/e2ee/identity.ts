const IDENTITY_STORAGE_KEY = "raddir-identity";

export interface LocalIdentity {
  publicKey: string;
  privateKey: string;
  algorithm: string;
  createdAt: number;
}

// ─── Electron IPC bridge detection ───────────────────────────────────────────

const raddir = (window as any).raddir as {
  identityGetPublicKey?: () => Promise<string>;
  identitySign?: (data: string) => Promise<string>;
  identityGetAlgorithm?: () => Promise<string>;
  identityImportLegacy?: (pub: string, priv: string, algo: string) => Promise<boolean>;
  identityExport?: (passphrase: string) => Promise<string | null>;
  identityImportEncrypted?: (file: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
} | undefined;

const hasSecureIdentity = !!(raddir?.identityGetPublicKey && raddir?.identitySign);

// ─── Legacy migration (one-time: localStorage → main process) ────────────────

let migrationDone = false;

async function migrateLegacyIdentity(): Promise<void> {
  if (migrationDone || !hasSecureIdentity) return;
  migrationDone = true;

  const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
  if (!raw) return;

  try {
    const legacy = JSON.parse(raw) as LocalIdentity;
    if (legacy.publicKey && legacy.privateKey) {
      const imported = await raddir!.identityImportLegacy!(legacy.publicKey, legacy.privateKey, legacy.algorithm ?? "Ed25519");
      if (imported) {
        localStorage.removeItem(IDENTITY_STORAGE_KEY);
        console.log("[identity] Migrated legacy identity to secure storage and removed from localStorage");
      }
    }
  } catch {
    console.warn("[identity] Failed to migrate legacy identity");
  }
}

// ─── WebCrypto fallback (non-Electron / browser) ─────────────────────────────

async function generateIdentityKeyPair(): Promise<{ keyPair: CryptoKeyPair; algorithm: string }> {
  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"]
    );
    return { keyPair, algorithm: "Ed25519" };
  } catch {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    return { keyPair, algorithm: "ECDSA-P256" };
  }
}

async function exportPublicKeyHex(key: CryptoKey): Promise<string> {
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

async function importPublicKeyFromHex(hex: string, algorithm: string): Promise<CryptoKey> {
  const spki = hexToArrayBuffer(hex);
  return crypto.subtle.importKey("spki", spki, getImportAlgorithm(algorithm), true, ["verify"]);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getOrCreateIdentity(): Promise<{
  publicKeyHex: string;
}> {
  // Secure path: Electron main process holds the private key
  if (hasSecureIdentity) {
    await migrateLegacyIdentity();
    const publicKeyHex = await raddir!.identityGetPublicKey!();
    return { publicKeyHex };
  }

  // Fallback path: WebCrypto in renderer (browser-only, less secure)
  const stored = loadStoredIdentity();
  if (stored) {
    return { publicKeyHex: stored.publicKey };
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

  console.log(`[identity] Generated ${algorithm} identity key (browser fallback)`);
  return { publicKeyHex };
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

export async function getStoredIdentityPublicKey(): Promise<string | null> {
  if (hasSecureIdentity) {
    try {
      return await raddir!.identityGetPublicKey!();
    } catch {
      return null;
    }
  }
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
 * In Electron: delegates to main process (private key never in renderer).
 * In browser: uses WebCrypto fallback.
 * Returns the signature as a base64 string, or null on failure.
 */
export async function signData(data: string): Promise<string | null> {
  try {
    // Secure path: main process signing
    if (hasSecureIdentity) {
      return await raddir!.identitySign!(data);
    }

    // Fallback: WebCrypto (browser)
    const stored = loadStoredIdentity();
    if (!stored) return null;
    const algo = stored.algorithm ?? "Ed25519";
    const privateKey = await importPrivateKey(stored.privateKey, algo);
    const encoded = new TextEncoder().encode(data);
    const signature = await crypto.subtle.sign(
      getSignAlgorithm(algo),
      privateKey,
      encoded
    );
    return arrayBufferToBase64(signature);
  } catch {
    return null;
  }
}

/**
 * Verify a signature against data using a public key (SPKI hex).
 * Verification always happens in the renderer (only needs the public key).
 */
export async function verifySignature(
  data: string,
  signatureBase64: string,
  publicKeyHex: string,
  algorithm?: string
): Promise<boolean> {
  try {
    const algo = algorithm ?? "Ed25519";
    const publicKey = await importPublicKeyFromHex(publicKeyHex, algo);
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

export async function exportIdentity(passphrase: string): Promise<string> {
  // Secure path: main process handles export
  if (hasSecureIdentity) {
    const result = await raddir!.identityExport!(passphrase);
    if (!result) throw new Error("No identity to export");
    return result;
  }

  // Fallback: WebCrypto (browser)
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

  // v2 format: handled by main process
  if (file.version === 2 && hasSecureIdentity) {
    const result = await raddir!.identityImportEncrypted!(fileContents, passphrase);
    if (!result.success) throw new Error(result.error ?? "Import failed");
    return;
  }

  // v1 format: WebCrypto fallback (browser) or legacy
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

  // If Electron is available, migrate to secure storage
  if (hasSecureIdentity) {
    const imported = await raddir!.identityImportLegacy!(identity.publicKey, identity.privateKey, identity.algorithm ?? "Ed25519");
    if (imported) return;
  }

  saveIdentity(identity);
}

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
