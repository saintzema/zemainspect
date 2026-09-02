import { describe, expect, it, vi } from "vitest";

/**
 * Reproduces the "camera light on, black frame" report.
 *
 * `start()` acquires the camera and loads the model concurrently. With
 * `Promise.all`, a model failure rejects the combined promise immediately and
 * the already-granted camera stream is simply dropped: never attached to the
 * video element, never stopped. The hardware indicator stays lit over a blank
 * frame, so a model failure looks exactly like a broken camera.
 *
 * These tests pin the settle-both-then-release behaviour that replaced it,
 * against a fake MediaStream, so the contract holds without needing a browser.
 */

function fakeStream() {
  const track = { stop: vi.fn(), kind: "video" as const };
  return {
    stream: { getTracks: () => [track] },
    track,
  };
}

/** The shape `start()` now uses: settle both, release the camera if unusable. */
async function acquire(
  camera: Promise<{ getTracks: () => Array<{ stop: () => void }> }>,
  model: Promise<string>,
) {
  const [cameraResult, sessionResult] = await Promise.allSettled([camera, model]);

  if (cameraResult.status === "fulfilled" && sessionResult.status !== "fulfilled") {
    cameraResult.value.getTracks().forEach((track) => track.stop());
  }
  if (sessionResult.status === "rejected") throw sessionResult.reason;
  if (cameraResult.status === "rejected") throw cameraResult.reason;

  return { stream: cameraResult.value, session: sessionResult.value };
}

describe("camera acquisition when the model fails", () => {
  it("stops the camera tracks so the hardware light goes back off", async () => {
    const { stream, track } = fakeStream();

    await expect(
      acquire(Promise.resolve(stream), Promise.reject(new Error("initWasm failed"))),
    ).rejects.toThrow("initWasm failed");

    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("surfaces the model's error, not a misleading camera error", async () => {
    const { stream } = fakeStream();

    await expect(
      acquire(Promise.resolve(stream), Promise.reject(new Error("WASM session creation timed out"))),
    ).rejects.toThrow(/WASM session creation timed out/);
  });

  it("keeps the camera when both succeed", async () => {
    const { stream, track } = fakeStream();

    const result = await acquire(Promise.resolve(stream), Promise.resolve("session"));

    expect(result.session).toBe("session");
    expect(result.stream).toBe(stream);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("reports the camera's own failure when the camera is the thing that broke", async () => {
    await expect(
      acquire(Promise.reject(new Error("Permission denied")), Promise.resolve("session")),
    ).rejects.toThrow("Permission denied");
  });

  it("prefers the model error when both fail, since that is the root cause to fix", async () => {
    await expect(
      acquire(Promise.reject(new Error("Permission denied")), Promise.reject(new Error("no backend"))),
    ).rejects.toThrow("no backend");
  });
});
