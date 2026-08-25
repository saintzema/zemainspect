import sharp from "sharp";

import { loadModelBytes, modelVariantName } from "@/lib/inference/model-source";
import {
  MODEL_INPUT_SIZE,
  decodeYolov8,
  type Detection,
  type LetterboxInfo,
} from "@/lib/inference/postprocess";
import { letterboxToTensor } from "@/lib/inference/preprocess";

// onnxruntime-node ships native binaries. Import lazily so that merely loading
// this module (e.g. during a build trace) never triggers binding resolution.
type OrtModule = typeof import("onnxruntime-node");
type OrtSession = import("onnxruntime-node").InferenceSession;

let ortPromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;

function ort(): Promise<OrtModule> {
  if (!ortPromise) ortPromise = import("onnxruntime-node");
  return ortPromise;
}

async function session(): Promise<OrtSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const [runtime, bytes] = await Promise.all([ort(), loadModelBytes()]);
    return runtime.InferenceSession.create(bytes, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      // A single inference per request; extra threads only add contention on
      // the 1-2 vCPUs a serverless function gets.
      intraOpNumThreads: 1,
    });
  })().catch((err) => {
    sessionPromise = null;
    throw err;
  });

  return sessionPromise;
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

/** Run the bundled YOLOv8n NEU model over one image buffer. */
export async function runInference(
  imageBuffer: Buffer,
  options: { confidenceThreshold?: number; iouThreshold?: number } = {},
): Promise<InferenceOutcome> {
  const started = Date.now();

  const [runtime, sess, { data, box }] = await Promise.all([
    ort(),
    session(),
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

  const detections = decodeYolov8(
    output.data as Float32Array,
    output.dims,
    box,
    options,
  );

  return {
    detections,
    processingTimeMs: Date.now() - started,
    modelVariant: modelVariantName(),
  };
}

/** Warm the session outside the request path (used by the health endpoint). */
export async function warmup(): Promise<void> {
  await session();
}
