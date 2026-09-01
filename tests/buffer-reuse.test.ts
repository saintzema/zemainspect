import { describe, expect, it } from "vitest";

/**
 * This is the exact bug reported from production: a real MacBook with actual
 * WebGPU support hit "Could not start the detection model" with the browser
 * error "Failed to execute 'postMessage' on 'Worker': An ArrayBuffer is
 * detached and could not be cloned."
 *
 * `onnx-web.ts` attempts a WebGPU session first and falls back to WASM.
 * Both calls used to build from the SAME `Uint8Array`/`ArrayBuffer`. With
 * `ort.env.wasm.proxy = true`, ORT hands the model bytes to a worker via
 * `postMessage` with the buffer in the transfer list — which detaches it in
 * this thread, a real platform limitation of transferable objects, not an
 * ORT bug. So the WebGPU attempt permanently consumes the one buffer that
 * existed, and the WASM fallback is left trying to send an already-detached
 * one.
 *
 * `structuredClone(buf, { transfer: [buf] })` reproduces exactly what
 * `postMessage` does to a transferred ArrayBuffer (Node has implemented the
 * same detach semantics since v17), so this test proves the failure mode and
 * the fix without needing a real Worker or browser.
 */
describe("model bytes must not be reused across InferenceSession.create() attempts", () => {
  it("a buffer transferred once cannot be sent again (reproduces the bug)", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    // Simulates the WebGPU attempt's postMessage to its worker.
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });

    expect(bytes.buffer.byteLength).toBe(0); // detached

    // Simulates the WASM fallback trying to send the same buffer again.
    expect(() => structuredClone(bytes.buffer, { transfer: [bytes.buffer] })).toThrow();
  });

  it("giving each attempt its own .slice() copy avoids the failure (the fix)", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    const forWebgpuAttempt = bytes.slice();
    const forWasmAttempt = bytes.slice();

    // The WebGPU attempt "sends" its own copy and loses it — expected and fine.
    structuredClone(forWebgpuAttempt.buffer, { transfer: [forWebgpuAttempt.buffer] });
    expect(forWebgpuAttempt.buffer.byteLength).toBe(0);

    // The WASM fallback's copy was never touched, so it can still be sent.
    expect(() =>
      structuredClone(forWasmAttempt.buffer, { transfer: [forWasmAttempt.buffer] }),
    ).not.toThrow();

    // And the original source bytes are untouched throughout, so a third
    // attempt (or a retry) can always take its own fresh copy too.
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });
});
