import { createHash, randomBytes, timingSafeEqual } from "crypto";

const KEY_PREFIX = "zi_live_";

export interface GeneratedApiKey {
  /** Full plaintext key. Shown to the user exactly once. */
  plaintext: string;
  /** SHA-256 of the plaintext — the only form persisted. */
  keyHash: string;
  /** Short identifiable fragment, safe to display in listings. */
  keyPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    keyPrefix: plaintext.slice(0, KEY_PREFIX.length + 4),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Pull the bearer token out of an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
