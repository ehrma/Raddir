// ─── Electron IPC bridge (required) ──────────────────────────────────────────
// Identity private key is managed exclusively by the Electron main process.
// Algorithm: ECDSA P-256 + SHA-256. No browser fallback, no localStorage.

const raddir = (window as any).raddir as {
  identityGetPublicKey: () => Promise<string>;
  identitySign: (data: string) => Promise<string>;
  identityRegenerate: () => Promise<string>;
  identityExport: (passphrase: string) => Promise<string | null>;
  identityImportEncrypted: (file: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
  identityPinCheck: (serverId: string, userId: string, identityPublicKeyHex: string) => Promise<"new" | "ok" | "mismatch">;
  identityPinGet: (serverId: string, userId: string) => Promise<string | null>;
  identityPinRemove: (serverId: string, userId: string) => Promise<void>;
};

if (!raddir?.identityGetPublicKey || !raddir?.identitySign) {
  console.error("[identity] Electron identity IPC not available — E2EE will not function");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getOrCreateIdentity(): Promise<{ publicKeyHex: string }> {
  const publicKeyHex = await raddir.identityGetPublicKey();
  return { publicKeyHex };
}

export async function getStoredIdentityPublicKey(): Promise<string | null> {
  try {
    return await raddir.identityGetPublicKey();
  } catch {
    return null;
  }
}

/**
 * Sign arbitrary data with the identity private key (ECDSA P-256 + SHA-256).
 * Signing happens in the main process — private key never enters the renderer.
 */
export async function signData(data: string): Promise<string | null> {
  try {
    return await raddir.identitySign(data);
  } catch {
    return null;
  }
}

/**
 * TOFU identity pin check. Returns:
 * - "new": first contact with this peer on this server — key is now pinned
 * - "ok": identity key matches the pinned key
 * - "mismatch": identity key differs from pinned key — REJECT (possible MITM)
 */
export async function checkIdentityPin(
  serverId: string,
  userId: string,
  identityPublicKeyHex: string
): Promise<"new" | "ok" | "mismatch"> {
  return raddir.identityPinCheck(serverId, userId, identityPublicKeyHex);
}

/**
 * Verify a signature against data using a public key (SPKI hex).
 * Algorithm is auto-detected from the SPKI key OID.
 */
export async function verifySignature(
  data: string,
  signatureBase64: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const algo = detectAlgorithmFromSpki(publicKeyHex);
    const publicKey = await importPublicKeyFromHex(publicKeyHex, algo);
    const encoded = new TextEncoder().encode(data);
    const signature = base64ToArrayBuffer(signatureBase64);
    return crypto.subtle.verify(
      algo === "ECDSA-P256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" } as any,
      publicKey,
      signature,
      encoded
    );
  } catch {
    return false;
  }
}

// ─── Safety Numbers & Fingerprints ───────────────────────────────────────────

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
  // P-256 SPKI hex: 52 chars fixed header + "04" uncompressed prefix = 54 chars before unique EC point
  const SPKI_P256_PREFIX_LEN = 54;
  const uniquePart = publicKey.length > SPKI_P256_PREFIX_LEN ? publicKey.slice(SPKI_P256_PREFIX_LEN) : publicKey;
  return uniquePart.slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join(" ") ?? "";
}

// ─── Identity Export / Import (passphrase-encrypted, main process) ───────────

export async function exportIdentity(passphrase: string): Promise<string> {
  const result = await raddir.identityExport(passphrase);
  if (!result) throw new Error("No identity to export");
  return result;
}

export async function importIdentity(fileContents: string, passphrase: string): Promise<void> {
  const result = await raddir.identityImportEncrypted(fileContents, passphrase);
  if (!result.success) throw new Error(result.error ?? "Import failed");
}

export async function clearIdentity(): Promise<string> {
  return raddir.identityRegenerate();
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function detectAlgorithmFromSpki(publicKeyHex: string): string {
  if (publicKeyHex.toLowerCase().includes("2a8648ce3d030107")) return "ECDSA-P256";
  return "Ed25519";
}

function importPublicKeyFromHex(hex: string, algorithm: string): Promise<CryptoKey> {
  const spki = hexToArrayBuffer(hex);
  const algo = algorithm === "ECDSA-P256"
    ? { name: "ECDSA", namedCurve: "P-256" }
    : { name: "Ed25519" } as any;
  return crypto.subtle.importKey("spki", spki, algo, true, ["verify"]);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}
