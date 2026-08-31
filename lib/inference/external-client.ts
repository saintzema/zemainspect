import { env, hasEnv } from "@/lib/env";
import type { Detection } from "@/lib/inference/postprocess";
import type { InferenceOutcome } from "@/lib/inference/onnx-node";

/**
 * Path B — a GPU-backed FastAPI service (Modal / RunPod / Fly GPU) running the
 * larger YOLOv8m/l weights. Only worth its hosting cost for customers who need
 * the extra accuracy; everyone else is served by the in-process nano model.
 */

export function externalInferenceConfigured(): boolean {
  return hasEnv("INFERENCE_SERVICE_URL");
}

interface ExternalResponse {
  detections?: Array<{
    type?: string;
    class_name?: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
  model_variant?: string;
  processing_time_ms?: number;
}

export async function runExternalInference(
  imageBuffer: Buffer,
  filename: string,
  contentType: string,
): Promise<InferenceOutcome> {
  const baseUrl = env("INFERENCE_SERVICE_URL");
  if (!baseUrl) throw new Error("INFERENCE_SERVICE_URL is not set");

  const started = Date.now();

  const form = new FormData();
  form.append(
    "image",
    new Blob([new Uint8Array(imageBuffer)], { type: contentType }),
    filename,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/predict`, {
      method: "POST",
      body: form,
      headers: process.env.INFERENCE_SERVICE_API_KEY
        ? { Authorization: `Bearer ${process.env.INFERENCE_SERVICE_API_KEY}` }
        : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(
      `Inference service responded ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }

  const payload = (await res.json()) as ExternalResponse;
  const detections: Detection[] = (payload.detections ?? []).map((d) => ({
    type: d.type ?? d.class_name ?? "unknown",
    confidence: d.confidence,
    bbox: d.bbox,
  }));

  return {
    detections,
    processingTimeMs: payload.processing_time_ms ?? Date.now() - started,
    modelVariant: payload.model_variant ?? "yolov8l-neu-external",
  };
}
