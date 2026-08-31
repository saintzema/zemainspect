import { randomInt } from "crypto";

import bcrypt from "bcryptjs";

// Re-exported so server code has a single import for everything password
// related, while the browser can import the rules alone.
export {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  validatePassword,
} from "@/lib/password-rules";
export type { PasswordProblem } from "@/lib/password-rules";

/**
 * Password hashing.
 *
 * bcrypt at cost 12: deliberately slow, so a leaked hash is expensive to
 * attack, while still finishing well inside a serverless request. Raise the
 * cost as hardware improves — `verifyPassword` keeps working against hashes
 * made at any earlier cost, since bcrypt stores it in the hash itself.
 */
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verify a password against a stored hash.
 *
 * When there is no hash (an OAuth-only account), still run a comparison
 * against a dummy hash before returning false. Otherwise the response is
 * measurably faster for non-existent or OAuth accounts, which leaks which
 * addresses are registered.
 */
const DUMMY_HASH = "$2b$12$VP2/55JYXl9go6Y1D/OVVuQ4wsBaH8RwTUzy4gqe1BU7tZ.OqTPRy";

export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH).catch(() => false);
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** A readable temporary password for an admin-created account. */
export function generateTemporaryPassword(): string {
  // Ambiguous characters removed so it survives being read aloud or copied
  // off a screen on a factory floor.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 14; i++) out += alphabet[randomInt(0, alphabet.length)];
  return out;
}
