import sharp from "sharp";

import {
  classNamesFor,
  loadModelBytes,
  loadModelBytesFor,
  modelVariantNameFor,
} from "@/lib/inference/model-source";
import {
  MODEL_INPUT_SIZE,
  decodeYolov8,
  type Detection,
  type LetterboxInfo,
} from "@/lib/inference/postprocess";
import { letterboxToTensor } from "@/lib/inference/preprocess";
import type { ProductCategory } from "@/lib/inference/labels";

// onnxruntime-node ships native binaries. Import lazily so that merely loading
// this module (e.g. during a build trace) never triggers binding resolution.
type OrtModule = typeof import("onnxruntime-node");
type OrtSession = import("onnxruntime-node").InferenceSession;

let ortPromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;
/** Sessions for a category other than steel — kept separate so a second
 * category's weights never evict steel's already-warm session. */
const categorySessions = new Map<ProductCategory, Promise<OrtSession>>();

function ort(): Promise<OrtModule> {
  if (!ortPromise) ortPromise = import("onnxruntime-node");
  return ortPromise;
}

function buildSession(bytes: Uint8Array): Promise<OrtSession> {
  return ort().then((runtime) =>
    runtime.InferenceSession.create(bytes, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      // A single inference per request; extra threads only add contention on
      // the 1-2 vCPUs a serverless function gets.
      intraOpNumThreads: 1,
    }),
  );
}

async function session(): Promise<OrtSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = loadModelBytes()
    .then(buildSession)
    .catch((err) => {
      sessionPromise = null;
      throw err;
    });

  return sessionPromise;
}

/** The session for `category` — the existing single-session cache for
 * steel, a separate memoised session per other category. */
function sessionFor(category: ProductCategory): Promise<OrtSession> {
  if (category === "steel") return session();

  const inflight = categorySessions.get(category);
  if (inflight) return inflight;

  const promise = loadModelBytesFor(category)
    .then(buildSession)
    .catch((err) => {
      categorySessions.delete(category);
      throw err;
    });
  categorySessions.set(category, promise);
  return promise;
}

export interface PreprocessResult {
  data: Float32Array;
  box: LetterboxInfo;
}

/**
 * Decode an image to raw RGB at its native size, then letterbox it with our
 * own resampler.
 *
 * sharp is deliberately used only as a decoder here. Its resize ignores the
 * `kernel` option when enlarging and does not reproduce OpenCV's INTER_LINEAR,
 * which the model was trained and benchmarked against; letting it resample
 * shifted detection confidence by up to 0.10 against the reference
 * implementation. `letterboxToTensor` is shared with the browser path, so both
 * runtimes produce identical input for the same frame.
 */
export async function preprocessImage(
  input: Buffer,
  size = MODEL_INPUT_SIZE,
): Promise<PreprocessResult> {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate() // honour EXIF orientation
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) throw new Error("Could not read image dimensions");

  return letterboxToTensor(data, info.width, info.height, size, info.channels);
}

export interface InferenceOutcome {
  detections: Detection[];
  processingTimeMs: number;
  modelVariant: string;
}

/** Run the model for `category` (steel by default) over one image buffer. */
export async function runInference(
  imageBuffer: Buffer,
  options: {
    confidenceThreshold?: number;
    iouThreshold?: number;
    category?: ProductCategory;
  } = {},
): Promise<InferenceOutcome> {
  const category = options.category ?? "steel";
  const started = Date.now();

  const [runtime, sess, { data, box }] = await Promise.all([
    ort(),
    sessionFor(category),
    preprocessImage(imageBuffer),
  ]);

  const tensor = new runtime.Tensor("float32", data, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);

  const inputName = sess.inputNames[0];
  const outputName = sess.outputNames[0];
  const result = await sess.run({ [inputName]: tensor });
  const output = result[outputName];

  const detections = decodeYolov8(output.data as Float32Array, output.dims, box, {
    ...options,
    classNames: classNamesFor(category),
  });

  return {
    detections,
    processingTimeMs: Date.now() - started,
    modelVariant: modelVariantNameFor(category),
  };
}

/** Warm the session outside the request path (used by the health endpoint). */
export async function warmup(): Promise<void> {
  await session();
}
