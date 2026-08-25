import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApiRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { recordInspectionUsage } from "@/lib/usage";
import { inspect, verdictFor } from "@/lib/inference/engine";
import { detectionsAsJson } from "@/lib/inference/postprocess";
import { ModelUnavailableError } from "@/lib/inference/model-source";
import { PRODUCT_CATEGORIES } from "@/lib/inference/labels";
import { buildInspectionPayload, deliverWebhook } from "@/lib/webhooks";
import { storeInspectionImage } from "@/lib/storage";

export const runtime = "nodejs";
// Inference is CPU-bound; give it the longest window the platform allows.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const bodySchema = z.object({
  line_id: z.string().trim().max(120).optional(),
  product_category: z.enum(PRODUCT_CATEGORIES).default("steel"),
  /** Skip blob upload — useful for high-volume lines that keep their own frames. */
  store_image: z.coerce.boolean().default(true),
  confidence: z.coerce.number().min(0.01).max(0.99).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { organization, tier } = auth.ctx;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: "Send multipart/form-data with an `image` field.",
        },
      },
      { status: 400 },
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "missing_image", message: "The `image` field is required." } },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: { code: "empty_image", message: "The uploaded image is empty." } },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "image_too_large",
          message: `Images must be under ${MAX_IMAGE_BYTES / (1024 * 1024)}MB.`,
        },
      },
      { status: 413 },
    );
  }

  const parsed = bodySchema.safeParse({
    line_id: form.get("line_id") ?? undefined,
    product_category: form.get("product_category") ?? undefined,
    store_image: form.get("store_image") ?? undefined,
    confidence: form.get("confidence") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_parameters",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      },
      { status: 400 },
    );
  }
  const params = parsed.data;

  const buffer = Buffer.from(await file.arrayBuffer());

  let outcome;
  try {
    outcome = await inspect(buffer, {
      tier,
      filename: file.name || "frame.jpg",
      contentType: file.type || "image/jpeg",
      confidenceThreshold: params.confidence,
    });
  } catch (err) {
    if (err instanceof ModelUnavailableError) {
      return NextResponse.json(
        { error: { code: "model_unavailable", message: err.message } },
        { status: 503 },
      );
    }
    console.error("Inference failed:", err);
    return NextResponse.json(
      {
        error: {
          code: "inference_failed",
          message: "The image could not be processed. Check that it is a valid image file.",
        },
      },
      { status: 422 },
    );
  }

  const imageUrl = params.store_image
    ? await storeInspectionImage(organization.id, buffer, file.type || "image/jpeg")
    : null;

  const result = verdictFor(outcome.detections);

  const job = await prisma.inspectionJob.create({
    data: {
      organizationId: organization.id,
      imageUrl,
      productCategory: params.product_category,
      lineId: params.line_id ?? null,
      result,
      defects: detectionsAsJson(outcome.detections),
      modelVariant: outcome.modelVariant,
      inferenceSource: "server",
      processingTimeMs: outcome.processingTimeMs,
    },
  });

  await recordInspectionUsage(organization.id);

  // Push to the customer's MES/ERP without making them poll.
  if (organization.webhookUrl && organization.webhookSecret) {
    const payload = buildInspectionPayload({
      ...job,
      defects: outcome.detections,
      result,
    });
    void deliverWebhook(organization.webhookUrl, organization.webhookSecret, payload).catch(
      () => undefined,
    );
  }

  return NextResponse.json(
    {
      inspection_id: job.id,
      result: result === "PASS" ? "pass" : "fail",
      defects: outcome.detections.map((d) => ({
        type: d.type,
        confidence: Number(d.confidence.toFixed(4)),
        bbox: d.bbox,
      })),
      model_variant: outcome.modelVariant,
      processing_time_ms: outcome.processingTimeMs,
      ...(outcome.degraded ? { degraded: true } : {}),
      processed_at: job.createdAt.toISOString(),
    },
    { status: 200 },
  );
}
