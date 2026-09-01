"use client";

import type * as OrtWeb from "onnxruntime-web";

import {
  MODEL_INPUT_SIZE,
  decodeYolov8,
  type Detection,
} from "@/lib/inference/postprocess";
import { letterboxToTensor } from "@/lib/inference/preprocess";
import { withTimeout } from "@/lib/timeout";

type InferenceSession = OrtWeb.InferenceSession;

/**
 * Load onnxruntime-web as a native browser module from our own origin.
 *
 * The `webpackIgnore` comment is load-bearing: ORT's published .mjs is a
 * prebuilt bundle the app bundler cannot parse, and it does not need to —
 * the browser imports it directly from /ort/, which is also what lets a
 * plant that blocks public CDNs run edge inference at all.
 */
const ORT_ENTRY = "/ort/ort.webgpu.min.mjs";

let ortModule: Promise<typeof OrtWeb> | null = null;

function loadOrt(): Promise<typeof OrtWeb> {
  ortModule ??= import(/* webpackIgnore: true */ ORT_ENTRY).then(
    (mod) => (mod.default ?? mod) as typeof OrtWeb,
  );
  return ortModule;
}

/**
 * Browser-side inference.
 *
 * This is the path that makes "real time in a Chinese factory" actually work:
 * the frame never crosses the internet, so latency is the model's ~10-40 ms
 * rather than a round trip to a US region, and the line keeps inspecting when
 * the uplink drops. It also costs nothing per frame.
 */

export const WEB_MODEL_VARIANT = "yolov8n-neu-web";

let sessionPromise: Promise<InferenceSession> | null = null;

export interface WebSessionInfo {
  session: InferenceSession;
  backend: string;
}

let activeBackend = "wasm";

export function edgeBackend(): string {
  return activeBackend;
}

/**
 * A WebGPU warmup slower than this means the browser is emulating the GPU in
 * software. Real hardware finishes a 640x640 YOLOv8n pass in tens of
 * milliseconds; software WebGPU measured ~16 s/frame, which is 30x SLOWER than
 * plain WASM. Anything past this bound is not a GPU worth using.
 */
const WEBGPU_WARMUP_BUDGET_MS = 1500;

/**
 * Minimal structural types for the bits of the WebGPU adapter API we read.
 * Declared locally rather than pulling in @webgpu/types, since this is the
 * only place in the app that touches WebGPU directly.
 */
interface MinimalAdapterInfo {
  vendor?: string;
  architecture?: string;
  description?: string;
}

interface MinimalAdapter {
  isFallbackAdapter?: boolean;
  info?: MinimalAdapterInfo;
}

interface MinimalGpu {
  requestAdapter(): Promise<MinimalAdapter | null>;
}

/**
 * Cheap pre-check for a real GPU.
 *
 * Timing a warmup is the reliable test, but on a software adapter that probe
 * itself costs ~26 s — precisely on the low-end tablet least able to afford
 * it. Asking the adapter what it is costs microseconds and skips the probe in
 * the common bad case, cutting startup from ~30 s to ~2.7 s when measured
 * against a software adapter. The timed warmup stays as the backstop for
 * adapters that are slow without announcing themselves.
 */
async function hasUsableGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu;
  if (!gpu) return false;

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;

    // Standard flag for a CPU-backed implementation.
    if (adapter.isFallbackAdapter) return false;

    const info = adapter.info;
    const descriptor = [info?.vendor, info?.architecture, info?.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // Known software rasterisers shipped with browsers and Linux desktops.
    return !/swiftshader|llvmpipe|lavapipe|softwarerasterizer|microsoft basic/.test(
      descriptor,
    );
  } catch {
    return false;
  }
}

async function warmupSession(
  session: InferenceSession,
  ort: typeof OrtWeb,
): Promise<number> {
  const input = new ort.Tensor(
    "float32",
    new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE),
    [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
  );
  const started = performance.now();
  await session.run({ [session.inputNames[0]]: input });
  return performance.now() - started;
}

const WEBGPU_INIT_TIMEOUT_MS = 8_000;
const WASM_INIT_TIMEOUT_MS = 20_000;

async function createSession(modelUrl: string): Promise<InferenceSession> {
  const ort = await loadOrt();

  // Serve the wasm binaries from our own origin. A factory network that
  // blocks public CDNs (common in China) would otherwise fail to start.
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  // Run the WASM backend in a worker. A frame takes a few hundred ms on CPU,
  // which on the main thread would freeze the operator's UI between every
  // inspection. Proxying keeps the page responsive on a low-end factory tablet.
  ort.env.wasm.proxy = true;

  const response = await fetch(modelUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Could not download the model (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  /*
   * `.slice()` a fresh copy for every attempt — this is load-bearing, not
   * defensive. With `wasm.proxy = true`, ORT hands the model bytes to a
   * worker via `postMessage` with the underlying ArrayBuffer in the transfer
   * list, which *detaches* it in this thread: a real hardware limitation of
   * transferable objects, not an ORT quirk. Passing the same `bytes` to a
   * second `InferenceSession.create()` call — exactly what the WebGPU→WASM
   * fallback below does — hands the worker an already-detached buffer, which
   * fails with "An ArrayBuffer is detached and could not be cloned." This
   * reached production on real hardware whose browser actually offers
   * WebGPU: the WebGPU attempt below consumes the one and only buffer, and
   * the WASM fallback then has nothing valid left to send. It went unnoticed
   * in earlier testing because that environment had no WebGPU adapter at
   * all, so the fallback was always the *only* attempt made — never a
   * second one on an already-spent buffer.
   */
  const build = (provider: string) =>
    ort.InferenceSession.create(bytes.slice(), {
      executionProviders: [provider as never],
      graphOptimizationLevel: "all",
    });

  // Try WebGPU, but only keep it if it is actually fast. Selecting purely on
  // "did it initialise" is the trap: a software-emulated adapter initialises
  // happily and then runs far slower than WASM, which on a production line
  // means a stalled inspection rather than a real-time one.
  if (await hasUsableGpu()) try {
    const candidate = await withTimeout(build("webgpu"), WEBGPU_INIT_TIMEOUT_MS, "WebGPU session creation");
    const warmupMs = await withTimeout(warmupSession(candidate, ort), WEBGPU_INIT_TIMEOUT_MS, "WebGPU warmup");
    if (warmupMs <= WEBGPU_WARMUP_BUDGET_MS) {
      activeBackend = "webgpu";
      return candidate;
    }
    console.warn(
      `[zemainspect] WebGPU warmup took ${Math.round(warmupMs)}ms ` +
        `(budget ${WEBGPU_WARMUP_BUDGET_MS}ms) — likely software emulation. Using WASM.`,
    );
    await candidate.release?.();
  } catch (err) {
    // Timed out, threw, or there is no WebGPU at all — WASM is the answer
    // either way, but a silent hang here is exactly the bug this guards
    // against, so it is worth a trace even though we recover from it.
    console.warn("[zemainspect] WebGPU backend unavailable, falling back to WASM:", err);
  }

  let fallback: InferenceSession;
  try {
    fallback = await withTimeout(build("wasm"), WASM_INIT_TIMEOUT_MS, "WASM session creation");
  } catch (err) {
    throw new Error(
      "Could not start the detection model in this browser. Try Chrome or Edge, " +
        "disable strict tracking-protection or ad-blocking extensions for this site, " +
        `and check that the network allows .wasm downloads. (${
          err instanceof Error ? err.message : String(err)
        })`,
    );
  }
  // Pay the one-off warmup here rather than on the operator's first frame. A
  // failed or hung warmup does not fail startup — the session already works,
  // it is just measured cold on the first real frame instead.
  await withTimeout(warmupSession(fallback, ort), WASM_INIT_TIMEOUT_MS, "WASM warmup").catch(() => undefined);
  activeBackend = "wasm";
  return fallback;
}

export function loadWebSession(modelUrl: string): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = createSession(modelUrl).catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

/**
 * Capture a video frame and letterbox it into the model's NCHW input.
 *
 * The canvas is used only to read pixels at the frame's native size —
 * `drawImage` scaling is deliberately avoided because its resampling is
 * browser-dependent and matches neither OpenCV nor sharp. `letterboxToTensor`
 * then does the resize, the same function the server uses, so the same frame
 * yields the same detections whether it was inspected in the browser or
 * through the API.
 */
export function preprocessFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  size = MODEL_INPUT_SIZE,
) {
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(source, 0, 0);
  const { data } = ctx.getImageData(0, 0, sourceWidth, sourceHeight);

  // Canvas gives RGBA, hence a stride of 4.
  return letterboxToTensor(data, sourceWidth, sourceHeight, size, 4);
}

export interface WebInferenceResult {
  detections: Detection[];
  processingTimeMs: number;
}

export async function runWebInference(
  session: InferenceSession,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  confidenceThreshold?: number,
): Promise<WebInferenceResult> {
  const ort = await loadOrt();
  const started = performance.now();

  const { data, box } = preprocessFrame(source, sourceWidth, sourceHeight, canvas);
  const tensor = new ort.Tensor("float32", data, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);

  const output = await session.run({ [session.inputNames[0]]: tensor });
  const head = output[session.outputNames[0]];

  const detections = decodeYolov8(
    head.data as Float32Array,
    head.dims,
    box,
    confidenceThreshold ? { confidenceThreshold } : undefined,
  );

  return { detections, processingTimeMs: Math.round(performance.now() - started) };
}
