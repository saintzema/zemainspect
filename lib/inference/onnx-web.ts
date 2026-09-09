"use client";

import type * as OrtWeb from "onnxruntime-web";

import {
  MODEL_INPUT_SIZE,
  decodeYolov8,
  type Detection,
} from "@/lib/inference/postprocess";
import { letterboxToTensor } from "@/lib/inference/preprocess";
import { withTimeout } from "@/lib/timeout";
import {
  assessFrame,
  type SuitabilityOptions,
  type SuitabilityVerdict,
} from "@/lib/inference/frame-suitability";
import {
  isFullFrame,
  mapDetectionsToFrame,
  roiToPixels,
  type PixelRect,
  type Roi,
} from "@/lib/inference/roi";

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
/**
 * Bounds `build("webgpu")` itself, not just its warmup.
 *
 * This did not exist until a real factory laptop hit it: `create()` had no
 * timeout at all — only the warmup after it did — on the theory that a
 * hung `create()` could not be safely abandoned anyway (see the big comment
 * below on why a second `create()` call collides with ORT's single-init
 * guard). That reasoning is correct for a still-*pending* `create()`, but it
 * does not cover the call actually settling this slowly on a real, if weak,
 * GPU — nothing was there to catch it, so "loading" ran forever with no
 * error and no way to recover short of a reload the UI never told anyone to
 * do. This does not change what happens once the timeout fires — a timed-out
 * webgpu attempt still cannot safely fall back to WASM in the same page
 * load, for the same collision reason as always — it only turns an
 * unbounded, silent hang into a bounded, visible failure.
 */
const WEBGPU_CREATE_TIMEOUT_MS = 60_000;
/**
 * onnxruntime-web's published "webgpu" bundle hardcodes its WASM binary
 * choice at the LIBRARY'S OWN build time — literally
 * `false ? jsep : false ? jspi : true ? asyncify : plain` in the shipped
 * source — to guarantee it runs on any browser without needing
 * cross-origin-isolation headers. That constant means every load pays for
 * the 25.7 MB asyncify build regardless of what this app's own headers or
 * environment offer; there is no runtime condition here to influence.
 *
 * Measured directly (Playwright + CDP network throttling to a realistic
 * ~4 Mbps / 40ms-latency connection, not this sandbox's instant localhost
 * loopback): a genuine cold load — asyncify WASM plus the ~12 MB ONNX model —
 * takes ~39s. That is not a hang; it is the real cost of running a full
 * computer-vision model entirely client-side, paid once per fresh page load
 * (the session is memoised after that — Stop/Start within the same page load
 * is instant). 20s was tuned against localhost and always failed on a real
 * connection; 45s left six seconds of margin over that measurement, which a
 * connection any slower than 4 Mbps would still blow through. 90s gives an
 * actually slow factory link a fair chance while still catching a true hang
 * well short of the 30-minute reports this replaced.
 */
const WASM_INIT_TIMEOUT_MS = 90_000;

async function createSession(modelUrl: string): Promise<InferenceSession> {
  const ort = await loadOrt();

  // Serve the wasm binaries from our own origin. A factory network that
  // blocks public CDNs (common in China) would otherwise fail to start.
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";

  /*
   * Default OFF. Running the WASM backend in a worker keeps the UI
   * responsive between frames — that is a real benefit — but the worker is
   * also a failure surface this app cannot recover from in-page: a worker
   * that fails to load surfaces as "no available backend found. ERR: [wasm]
   * [object Event]" (an Event, not an Error — a script-load failure, not
   * anything our code threw), and separately, this exact worker handoff is
   * what produced "Failed to execute 'postMessage' on 'Worker': An
   * ArrayBuffer is detached and could not be cloned" on real factory
   * hardware — an antivirus product, a locked-down corporate network policy,
   * or a browser security setting blocking or interfering with worker
   * scripts in a way a normal page load never exercises. ORT's own
   * single-init guard means neither failure can be retried without a full
   * page reload.
   *
   * A live, one-shot demo in front of a factory's QA lead cannot afford
   * either failure mode. Main-thread inference costs a visible stutter of a
   * second or so per frame on a slow machine — worse UX, but it degrades,
   * it never hangs and never throws a worker error there is no recovery
   * from. Set NEXT_PUBLIC_ORT_PROXY=true only once the proxy path has been
   * verified end to end on the specific hardware it will run on.
   */
  ort.env.wasm.proxy = process.env.NEXT_PUBLIC_ORT_PROXY === "true";

  /*
   * A dropped connection mid-download throws rather than returning a non-ok
   * response, and that raw error ("Failed to fetch", "net::ERR_FAILED")
   * reached the operator verbatim. On a factory link that drops — the exact
   * network this feature exists to survive — the most likely failure gave the
   * least usable message. Both paths now say the same actionable thing.
   */
  let response: Response;
  try {
    response = await fetch(modelUrl, { cache: "force-cache" });
  } catch (err) {
    throw new Error(
      `Could not download the detection model — the connection failed. Check the ` +
        `network and try again. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!response.ok) {
    throw new Error(`Could not download the detection model (HTTP ${response.status}).`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    // The body can still fail partway through, after headers looked fine.
    throw new Error(
      `The detection model download was interrupted. Check the network and try ` +
        `again. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

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

  /*
   * Exactly ONE InferenceSession.create() call per page load. This is a hard
   * constraint, not a preference.
   *
   * ORT's WASM runtime is a per-page singleton, and both execution providers
   * go through it — the WebGPU EP is layered on the same WASM module, not a
   * separate runtime. A second `create()` that begins while a first is still
   * initialising trips ORT's own guard: "multiple calls to 'initWasm()'
   * detected", and no backend comes up at all.
   *
   * The old code did exactly that. It raced the WebGPU `create()` against a
   * timeout and, when the timeout won, immediately started the WASM one — but
   * `withTimeout` only stops *awaiting* a promise, it cannot cancel the work
   * behind it, so the abandoned WebGPU init was still running when the WASM
   * init began. In production that surfaced as a dead ~22s wait (an 8s WebGPU
   * timeout, then the collision partway through the WASM attempt).
   *
   * So the provider is now chosen up front and committed to. `hasUsableGpu()`
   * already screens out the software rasterisers that motivated the original
   * try-and-measure dance, and it does so without touching the runtime.
   *
   * WebGPU is additionally opt-in per deployment. It has caused two separate
   * production incidents here, and no sandbox available to this project has a
   * GPU to regression-test it against — shipping it on by default would mean
   * every operator runs a path that has never been verified end to end on
   * real hardware. WASM is slower per frame but is the path that is actually
   * tested. Set NEXT_PUBLIC_ENABLE_WEBGPU=true to try it once you can verify
   * it on the target hardware.
   */
  const webgpuEnabled = process.env.NEXT_PUBLIC_ENABLE_WEBGPU === "true";

  if (webgpuEnabled && (await hasUsableGpu())) {
    /*
     * Tracks whether create()+warmup actually settled on their own, versus
     * this code giving up on them via a timeout. That distinction is the
     * whole safety argument for falling through to a second, WASM
     * `create()` call below: it is only safe once nothing WebGPU-related
     * can still be mid-flight. A rejection the promise reached by itself
     * proves that; a timeout proves the opposite — the underlying call is
     * still running, unobserved, and starting a second `create()` on top of
     * it is exactly what trips ORT's "multiple calls to 'initWasm()'
     * detected" guard (see the big comment above). So a timeout here must
     * end this page's session attempt entirely, the same as a WASM timeout
     * already does — never fall through underneath one.
     */
    let settledOnItsOwn = false;
    try {
      const candidate = await withTimeout(
        build("webgpu").finally(() => {
          settledOnItsOwn = true;
        }),
        WEBGPU_CREATE_TIMEOUT_MS,
        "WebGPU session creation",
      );
      const warmupMs = await withTimeout(
        warmupSession(candidate, ort).finally(() => {
          settledOnItsOwn = true;
        }),
        WEBGPU_INIT_TIMEOUT_MS,
        "WebGPU warmup",
      );
      if (warmupMs > WEBGPU_WARMUP_BUDGET_MS) {
        console.warn(
          `[zemainspect] WebGPU warmup took ${Math.round(warmupMs)}ms ` +
            `(budget ${WEBGPU_WARMUP_BUDGET_MS}ms) — likely software emulation, but ` +
            `keeping it: creating a second session to fall back would trip ORT's ` +
            `initWasm() guard and leave no backend at all.`,
        );
      }
      activeBackend = "webgpu";
      return candidate;
    } catch (err) {
      if (!settledOnItsOwn) {
        // create() or warmup is still running somewhere behind this
        // abandoned timeout. A second create() call now would collide with
        // it, not recover from it — the only safe move is to stop here,
        // exactly as a WASM timeout already does, and say so plainly rather
        // than hang forever with a spinner nobody can act on.
        throw new Error(
          "The detection engine did not respond while starting on this device's GPU. " +
            "Reload the page and press Start camera again.",
        );
      }
      // create() (or warmup) rejected on its own — nothing is mid-init — so
      // the WASM attempt below is safe to make.
      console.warn("[zemainspect] WebGPU backend failed, using WASM:", err);
    }
  }

  let session: InferenceSession;
  try {
    session = await withTimeout(build("wasm"), WASM_INIT_TIMEOUT_MS, "WASM session creation");
  } catch (err) {
    throw new Error(
      "Could not start the detection model in this browser. Try Chrome or Edge, " +
        "disable strict tracking-protection or ad-blocking extensions for this site, " +
        `and check that the network allows .wasm downloads. (${
          err instanceof Error ? err.message : String(err)
        })`,
    );
  }
  const fallback = session;
  // Pay the one-off warmup here rather than on the operator's first frame. A
  // failed or hung warmup does not fail startup — the session already works,
  // it is just measured cold on the first real frame instead.
  await withTimeout(warmupSession(fallback, ort), WASM_INIT_TIMEOUT_MS, "WASM warmup").catch(() => undefined);
  activeBackend = "wasm";
  return fallback;
}

/**
 * Whether a session build has ever been started in this page.
 *
 * Retrying after a failure used to clear `sessionPromise` and call
 * `createSession()` again, which issues another `InferenceSession.create()`
 * and therefore another `initWasm()`. But our timeout only stops *awaiting*
 * the failed attempt — ORT's init may still be running behind it — so the
 * retry collides with it and trips "multiple calls to 'initWasm()' detected",
 * turning a slow first load into a permanently broken one. And clicking Start
 * again after an error is precisely what an operator does.
 *
 * ORT gives no way to reset that singleton, so a reload is genuinely the only
 * clean recovery. Saying so plainly beats a retry that quietly makes things
 * worse.
 */
let wasmInitAttempted = false;

export function loadWebSession(modelUrl: string): Promise<InferenceSession> {
  if (!sessionPromise) {
    if (wasmInitAttempted) {
      return Promise.reject(
        new Error(
          "The detection engine already failed to start in this tab and cannot be " +
            "restarted without reloading. Refresh the page and press Start camera again.",
        ),
      );
    }
    wasmInitAttempted = true;
    sessionPromise = createSession(modelUrl).catch((err) => {
      // Deliberately NOT clearing wasmInitAttempted: the runtime is
      // single-init per page, so a second attempt cannot succeed here.
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
  /**
   * Optional sub-rectangle of the source to inspect. When given, only these
   * pixels reach the model — everything outside is never seen, rather than
   * being seen and then argued with.
   */
  crop?: PixelRect,
) {
  const region: PixelRect = crop ?? {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };

  canvas.width = region.width;
  canvas.height = region.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  /*
   * The 9-argument drawImage copies the crop 1:1 — same source and
   * destination size — so no resampling happens here. That matters: the
   * letterbox below is the single resize step the server also performs, and
   * putting a second, browser-defined interpolation in front of it would make
   * browser and API disagree about the same frame.
   */
  ctx.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  const { data } = ctx.getImageData(0, 0, region.width, region.height);

  // Canvas gives RGBA, hence a stride of 4.
  return {
    ...letterboxToTensor(data, region.width, region.height, size, 4),
    /** Kept so the caller can gate on frame statistics without re-reading pixels. */
    rgba: data,
    region,
  };
}

export interface WebInferenceResult {
  detections: Detection[];
  processingTimeMs: number;
  /**
   * Why the frame was skipped, when it was. Null means it was inspected
   * normally. The caller shows this instead of a defect verdict — an
   * unsuitable frame has no verdict to give.
   */
  unsuitable: SuitabilityVerdict | null;
}

export interface WebInferenceOptions {
  confidenceThreshold?: number;
  /** Inspect only this region of the frame, in normalised 0-1 coordinates. */
  roi?: Roi;
  /**
   * Skip inference entirely on frames that do not resemble the training
   * distribution. On by default: answering "Patches 76%" about a human face
   * is worse than answering nothing.
   */
  guardFrames?: boolean;
  suitability?: SuitabilityOptions;
}

export async function runWebInference(
  session: InferenceSession,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  options: WebInferenceOptions = {},
): Promise<WebInferenceResult> {
  const ort = await loadOrt();
  const started = performance.now();

  const { confidenceThreshold, roi, guardFrames = true, suitability } = options;

  const crop = roi && !isFullFrame(roi) ? roiToPixels(roi, sourceWidth, sourceHeight) : undefined;

  const { data, box, rgba, region } = preprocessFrame(
    source,
    sourceWidth,
    sourceHeight,
    canvas,
    MODEL_INPUT_SIZE,
    crop,
  );

  /*
   * Gate before inference, not after. Filtering the model's output would
   * still have paid the full inference cost on a frame we were never going to
   * trust, and — more importantly — a detector asked an off-distribution
   * question always answers it. The only way not to get a wrong answer is not
   * to ask.
   *
   * The statistics come from the ROI's pixels, not the whole frame: with a
   * tight ROI on a steel part, a colourful factory background is irrelevant
   * and should not veto an otherwise good inspection.
   */
  if (guardFrames) {
    // region, not sourceWidth/sourceHeight: with a tight ROI, the grid and
    // glare checks must judge the cropped part, not the full camera frame.
    const verdict = assessFrame(rgba, suitability, region);
    if (!verdict.suitable) {
      return {
        detections: [],
        processingTimeMs: Math.round(performance.now() - started),
        unsuitable: verdict,
      };
    }
  }

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

  return {
    // Boxes come back in crop-local coordinates; the overlay and the stored
    // result both speak full-frame, so shift them before anyone sees them.
    detections: crop ? mapDetectionsToFrame(detections, region) : detections,
    processingTimeMs: Math.round(performance.now() - started),
    unsuitable: null,
  };
}
