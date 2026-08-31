/**
 * Read an environment variable, treating blank as absent.
 *
 * `process.env.X ?? fallback` is the obvious spelling and it is wrong on
 * Vercel. Its project-import screen renders every documented variable as a
 * field, and any field left blank is stored as an EMPTY STRING rather than
 * omitted. `??` only falls back on null/undefined, so `""` sails through as a
 * real value.
 *
 * That is not theoretical: a blank MODEL_FILE resolved the weights path to the
 * `public/models` directory, `existsSync` reported it present, the app
 * declared the model deployed, and the browser then requested `/models/` and
 * got a 404 — edge inference dead on a live deployment, with a config screen
 * that looked correctly filled in.
 *
 * Trimming matters too: a value pasted with a trailing newline or space is a
 * different kind of silently-wrong.
 */
export function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Same, with a fallback for when the variable is absent or blank. */
export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

/** True when the variable holds a real, non-blank value. */
export function hasEnv(name: string): boolean {
  return env(name) !== undefined;
}
