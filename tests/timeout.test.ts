import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withTimeout } from "@/lib/timeout";

/**
 * This guards the exact production incident: a browser whose cross-origin
 * isolation state left the threaded WASM worker unable to complete its
 * handshake, leaving model initialisation pending — and "Loading model…" on
 * screen — for over half an hour with nothing to bound the wait.
 */
describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the underlying value when it settles in time", async () => {
    const fast = Promise.resolve("model ready");
    await expect(withTimeout(fast, 1000, "load")).resolves.toBe("model ready");
  });

  it("rejects with the underlying error when it fails in time", async () => {
    const failing = Promise.reject(new Error("no WebGPU adapter"));
    await expect(withTimeout(failing, 1000, "load")).rejects.toThrow("no WebGPU adapter");
  });

  it("times out a promise that never settles, instead of waiting forever", async () => {
    const hung = new Promise(() => {
      /* simulates a worker that never posts back — the actual production bug */
    });
    const result = withTimeout(hung, 5000, "WASM session creation");
    const assertion = expect(result).rejects.toThrow(/WASM session creation timed out after 5s/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("does not fire the timeout once the promise has already settled", async () => {
    const fast = Promise.resolve("ok");
    await withTimeout(fast, 5000, "load");
    // If clearTimeout wasn't called, this would still be a live timer whose
    // rejection nothing is listening for — not user-visible, but a leak this
    // guards against on every successful load, which is the common case.
    expect(vi.getTimerCount()).toBe(0);
  });
});
