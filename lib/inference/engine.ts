import type { PlanTier } from "@/lib/generated/prisma";
import { runInference, type InferenceOutcome } from "@/lib/inference/onnx-node";
import {
  externalInferenceConfigured,
  runExternalInference,
} from "@/lib/inference/external-client";
import type { Detection } from "@/lib/inference/postprocess";

export type { Detection, InferenceOutcome };

/**
 * Choose where an inspection runs.
 *
 * Pro and Enterprise get the high-accuracy external model when one is
 * deployed; everyone else runs the nano model in-process, which costs nothing
 * beyond the function invocation itself.
 */
export function shouldUseExternal(tier: PlanTier): boolean {
  if (!externalInferenceConfigured()) return false;
  if (process.env.INFERENCE_FORCE_EXTERNAL === "true") return true;
  return tier === "PRO" || tier === "ENTERPRISE";
}

export interface InspectOptions {
  tier: PlanTier;
  filename?: string;
  contentType?: string;
  confidenceThreshold?: number;
}

/**
 * Run one inspection, falling back to the local model if the external service
 * is unreachable — a factory line should not stop because a GPU host blipped.
 */
export async function inspect(
  imageBuffer: Buffer,
  options: InspectOptions,
): Promise<InferenceOutcome & { degraded?: boolean }> {
  const { tier, filename = "frame.jpg", contentType = "image/jpeg" } = options;

  if (shouldUseExternal(tier)) {
    try {
      return await runExternalInference(imageBuffer, filename, contentType);
    } catch (err) {
      console.error("External inference failed, falling back to local model:", err);
      const local = await runInference(imageBuffer, {
        confidenceThreshold: options.confidenceThreshold,
      });
      return { ...local, degraded: true };
    }
  }

  return runInference(imageBuffer, {
    confidenceThreshold: options.confidenceThreshold,
  });
}

/** A frame passes only when nothing was detected above threshold. */
export function verdictFor(detections: Detection[]): "PASS" | "FAIL" {
  return detections.length > 0 ? "FAIL" : "PASS";
}
