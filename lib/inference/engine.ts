import type { PlanTier } from "@/lib/generated/prisma";
import { runInference, type InferenceOutcome } from "@/lib/inference/onnx-node";
import {
  externalInferenceConfigured,
  runExternalInference,
} from "@/lib/inference/external-client";
import type { Detection } from "@/lib/inference/postprocess";
import type { ProductCategory } from "@/lib/inference/labels";
import { categoryIsConfigured, ModelUnavailableError } from "@/lib/inference/model-source";
import { assessUploadedFrame } from "@/lib/inference/server-guard";
import type { SuitabilityVerdict } from "@/lib/inference/frame-suitability";

export type { Detection, InferenceOutcome };
export { ModelUnavailableError };

/** A frame the API declined to run inference on. See FrameUnsuitableError. */
export class FrameUnsuitableError extends Error {
  constructor(public readonly verdict: SuitabilityVerdict) {
    super(`Frame rejected before inference: ${verdict.reason}`);
    this.name = "FrameUnsuitableError";
  }
}

/**
 * Choose where an inspection runs.
 *
 * Pro and Enterprise get the high-accuracy external model when one is
 * deployed; everyone else runs the nano model in-process, which costs nothing
 * beyond the function invocation itself. The external service only ever runs
 * the larger steel weights — a customer-supplied model for another category
 * always runs locally, since there is nothing hosted for it to call.
 */
export function shouldUseExternal(tier: PlanTier, category: ProductCategory): boolean {
  if (category !== "steel") return false;
  if (!externalInferenceConfigured()) return false;
  if (process.env.INFERENCE_FORCE_EXTERNAL === "true") return true;
  return tier === "PRO" || tier === "ENTERPRISE";
}

export interface InspectOptions {
  tier: PlanTier;
  category: ProductCategory;
  filename?: string;
  contentType?: string;
  confidenceThreshold?: number;
}

/**
 * Run one inspection, falling back to the local model if the external service
 * is unreachable — a factory line should not stop because a GPU host blipped.
 *
 * Two checks happen before any inference runs, in this order:
 *
 *   1. Is a model even deployed for this category? "general" and
 *      "automotive" ship with no weights on a default deployment; running
 *      the steel model against them anyway and reporting steel defect
 *      classes on whatever was actually submitted is the failure this
 *      guards against — throws ModelUnavailableError (503) rather than
 *      guessing.
 *   2. For steel specifically — the one model trained on a narrow,
 *      greyscale distribution — does the frame even look like something it
 *      was trained on? A keyboard, a glare reflection, or a shipping label
 *      reads to this model exactly like a defective coil does; this is the
 *      same check the browser edge inspector runs on-device, run
 *      server-side so a fixed line camera or an MES integration gets the
 *      same protection a phone camera in the dashboard already has — throws
 *      FrameUnsuitableError (422) rather than inventing a verdict.
 */
export async function inspect(
  imageBuffer: Buffer,
  options: InspectOptions,
): Promise<InferenceOutcome & { degraded?: boolean }> {
  const { tier, category, filename = "frame.jpg", contentType = "image/jpeg" } = options;

  if (!categoryIsConfigured(category)) {
    throw new ModelUnavailableError(
      category === "steel"
        ? "No ONNX model available for product_category=\"steel\". " +
            "Commit weights to public/models or set MODEL_URL."
        : `No model deployed for product_category="${category}". Set ` +
            `MODEL_URL_${category.toUpperCase()} and MODEL_CLASSES_${category.toUpperCase()} to enable it.`,
    );
  }

  if (category === "steel") {
    const verdict = await assessUploadedFrame(imageBuffer);
    if (!verdict.suitable) throw new FrameUnsuitableError(verdict);
  }

  if (shouldUseExternal(tier, category)) {
    try {
      return await runExternalInference(imageBuffer, filename, contentType);
    } catch (err) {
      console.error("External inference failed, falling back to local model:", err);
      const local = await runInference(imageBuffer, {
        confidenceThreshold: options.confidenceThreshold,
        category,
      });
      return { ...local, degraded: true };
    }
  }

  return runInference(imageBuffer, {
    confidenceThreshold: options.confidenceThreshold,
    category,
  });
}

/** A frame passes only when nothing was detected above threshold. */
export function verdictFor(detections: Detection[]): "PASS" | "FAIL" {
  return detections.length > 0 ? "FAIL" : "PASS";
}
