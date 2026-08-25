import sharp from "sharp";

import {
  MODEL_INPUT_SIZE,
  loadModelBytes,
  modelVariantName,
} from "@/lib/inference/model-source";
import {
  decodeYolov8,
  letterboxInfo,
  type Detection,
  type LetterboxInfo,
} from "@/lib/inference/postprocess";

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
 * Letterbox to a square model input and produce NCHW float32 RGB in [0,1].
 *
 * The resize and pad are computed from `letterboxInfo` rather than delegated
 * to sharp's `fit: contain`, so the exact same numbers are used to invert the
 * transform during decode. Any drift here shifts every bounding box.
 */
export async function preprocessImage(
  input: Buffer,
  size = MODEL_INPUT_SIZE,
): Promise<PreprocessResult> {
  const image = sharp(input, { failOn: "none" }).rotate(); // honour EXIF orientation
  const meta = await image.metadata();
  const srcW = meta.width;
  const srcH = meta.height;
  if (!srcW || !srcH) throw new Error("Could not read image dimensions");

  const box = letterboxInfo(srcW, srcH, size);
  const drawW = Math.round(srcW * box.scale);
  const drawH = Math.round(srcH * box.scale);

  const { data } = await image
    .resize(drawW, drawH, { fit: "fill" })
    .extend({
      top: box.padY,
      left: box.padX,
      bottom: size - drawH - box.padY,
      right: size - drawW - box.padX,
      background: { r: 114, g: 114, b: 114 }, // YOLO's canonical pad colour
    })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Interleaved RGB -> planar RGB, normalised.
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 3] / 255;
    out[plane + i] = data[i * 3 + 1] / 255;
    out[2 * plane + i] = data[i * 3 + 2] / 255;
  }

  return { data: out, box };
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
