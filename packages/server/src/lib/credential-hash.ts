import { createHash } from "node:crypto";

/**
 * Hash a credential for storage using SHA-256.
 * Credentials are high-entropy nanoid(32) tokens, so a fast hash is sufficient
 * (no need for argon2/bcrypt since the input isn't a weak password).
 * Returns a hex-encoded SHA-256 digest.
 */
export function hashCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf-8").digest("hex");
}
