"use client";

import type { InferenceSession, Tensor } from "onnxruntime-web";

import { MODEL_INPUT_SIZE } from "@/lib/inference/model-source";
import {
  decodeYolov8,
  letterboxInfo,
  type Detection,
} from "@/lib/inference/postprocess";

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

async function createSession(modelUrl: string): Promise<InferenceSession> {
  const ort = await import("onnxruntime-web");

  // Serve the wasm binaries from our own origin. A factory network that
  // blocks public CDNs (common in China) would otherwise fail to start.
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";

  const response = await fetch(modelUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Could not download the model (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Prefer WebGPU where the browser has it; fall back to WASM everywhere else.
  const providers: string[][] = [["webgpu"], ["wasm"]];
  let lastError: unknown;

  for (const executionProviders of providers) {
    try {
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: executionProviders as never,
        graphOptimizationLevel: "all",
      });
      activeBackend = executionProviders[0];
      return session;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No usable ONNX execution provider in this browser");
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
 * Draw a video frame letterboxed into a square canvas and return NCHW float32.
 * Mirrors `preprocessImage` on the server so both paths agree on geometry.
 */
export function preprocessFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  size = MODEL_INPUT_SIZE,
) {
  const box = letterboxInfo(sourceWidth, sourceHeight, size);
  const drawW = Math.round(sourceWidth * box.scale);
  const drawH = Math.round(sourceHeight * box.scale);

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(source, box.padX, box.padY, drawW, drawH);

  const { data } = ctx.getImageData(0, 0, size, size);
  const plane = size * size;
  const out = new Float32Array(3 * plane);

  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 4] / 255;
    out[plane + i] = data[i * 4 + 1] / 255;
    out[2 * plane + i] = data[i * 4 + 2] / 255;
  }

  return { data: out, box };
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
  const ort = await import("onnxruntime-web");
  const started = performance.now();

  const { data, box } = preprocessFrame(source, sourceWidth, sourceHeight, canvas);
  const tensor = new ort.Tensor("float32", data, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]) as Tensor;

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
