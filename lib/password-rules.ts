/**
 * Password rules, with no server-only dependencies.
 *
 * Split out from `lib/password.ts` so the sign-up form can enforce the same
 * rules in the browser without pulling bcrypt and node:crypto into the client
 * bundle. The server always re-validates — this half exists to give the user
 * an instant, honest error instead of a round trip.
 */

/** Minimum length. Length beats composition rules for real-world strength. */
export const MIN_PASSWORD_LENGTH = 10;

/** bcrypt silently truncates beyond this many bytes. */
export const MAX_PASSWORD_BYTES = 72;

export interface PasswordProblem {
  code: "too_short" | "too_common" | "too_long";
  message: string;
}

/**
 * A deliberately small list of the passwords that actually get tried first in
 * credential-stuffing attacks. This is not a substitute for rate limiting; it
 * just stops the most obviously guessable choices at signup.
 */
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "letmein123", "welcome123", "admin12345", "iloveyou1",
  "zemainspect", "changeme123", "passw0rd123", "1qaz2wsx3edc",
]);

/** TextEncoder rather than Buffer, so this runs unchanged in a browser. */
const utf8ByteLength = (value: string) => new TextEncoder().encode(value).length;

export function validatePassword(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      code: "too_short",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  // Reject rather than let a user believe a long passphrase is fully
  // protecting them when bcrypt would quietly ignore the tail.
  if (utf8ByteLength(password) > MAX_PASSWORD_BYTES) {
    return { code: "too_long", message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes.` };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { code: "too_common", message: "That password is too easy to guess." };
  }
  return null;
}
