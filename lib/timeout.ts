/**
 * Race a promise against a deadline.
 *
 * A hung operation and a slow one look identical from the caller's side —
 * both are just a promise that hasn't settled yet — so nothing upstream can
 * tell them apart without one of these. Used around browser model
 * initialisation, where a stalled worker handshake has, in production, left
 * a "Loading model…" spinner running for over half an hour with nothing to
 * time it out.
 *
 * The original promise is not cancelled — most underlying APIs (a worker
 * message round trip, `fetch`, `InferenceSession.create`) don't expose a way
 * to abort them — it is simply no longer awaited once the deadline passes,
 * so the caller's own promise chain settles either way.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
