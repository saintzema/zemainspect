import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApiRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { recordInspectionUsage } from "@/lib/usage";
import { inspect, verdictFor } from "@/lib/inference/engine";
import { detectionsAsJson } from "@/lib/inference/postprocess";
import { ModelUnavailableError } from "@/lib/inference/model-source";
import { PRODUCT_CATEGORIES } from "@/lib/inference/labels";
import { storeInspectionImage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Hard cap per call. End-of-shift QC batches are split client-side. */
const MAX_BATCH_IMAGES = 20;
/** Stop processing with time to spare so the response itself always lands. */
const TIME_BUDGET_MS = 45_000;

const paramsSchema = z.object({
  line_id: z.string().trim().max(120).optional(),
  product_category: z.enum(PRODUCT_CATEGORIES).default("steel"),
  store_images: z.coerce.boolean().default(true),
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
      { error: { code: "invalid_body", message: "Send multipart/form-data with `images`." } },
      { status: 400 },
    );
  }

  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json(
      { error: { code: "missing_images", message: "At least one `images` file is required." } },
      { status: 400 },
    );
  }
  if (files.length > MAX_BATCH_IMAGES) {
    return NextResponse.json(
      {
        error: {
          code: "batch_too_large",
          message: `A batch may contain at most ${MAX_BATCH_IMAGES} images.`,
        },
      },
      { status: 413 },
    );
  }

  const parsed = paramsSchema.safeParse({
    line_id: form.get("line_id") ?? undefined,
    product_category: form.get("product_category") ?? undefined,
    store_images: form.get("store_images") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_parameters", message: parsed.error.message } },
      { status: 400 },
    );
  }
  const params = parsed.data;

  const batch = await prisma.inspectionBatch.create({
    data: {
      organizationId: organization.id,
      status: "PROCESSING",
      productCategory: params.product_category,
      lineId: params.line_id ?? null,
      totalImages: files.length,
    },
  });

  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;
  let timedOut = false;

  for (const file of files) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const outcome = await inspect(buffer, {
        tier,
        filename: file.name || "frame.jpg",
        contentType: file.type || "image/jpeg",
      });

      const imageUrl = params.store_images
        ? await storeInspectionImage(organization.id, buffer, file.type || "image/jpeg")
        : null;

      await prisma.inspectionJob.create({
        data: {
          organizationId: organization.id,
          batchId: batch.id,
          imageUrl,
          productCategory: params.product_category,
          lineId: params.line_id ?? null,
          result: verdictFor(outcome.detections),
          defects: detectionsAsJson(outcome.detections),
          modelVariant: outcome.modelVariant,
          inferenceSource: "server",
          processingTimeMs: outcome.processingTimeMs,
        },
      });
      processed += 1;
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        await prisma.inspectionBatch.update({
          where: { id: batch.id },
          data: { status: "FAILED", error: err.message, completedAt: new Date() },
        });
        return NextResponse.json(
          { error: { code: "model_unavailable", message: err.message } },
          { status: 503 },
        );
      }
      console.error(`Batch ${batch.id}: image failed`, err);
      failed += 1;
    }
  }

  if (processed > 0) await recordInspectionUsage(organization.id, processed);

  const complete = processed + failed === files.length;
  await prisma.inspectionBatch.update({
    where: { id: batch.id },
    data: {
      processedImages: processed,
      failedImages: failed,
      status: complete ? "COMPLETED" : "QUEUED",
      completedAt: complete ? new Date() : null,
      error: timedOut
        ? "Time budget reached; resubmit the remaining images as a new batch."
        : null,
    },
  });

  return NextResponse.json(
    {
      batch_id: batch.id,
      status: complete ? "completed" : "partial",
      total: files.length,
      processed,
      failed,
      status_url: `/api/v1/inspect/batch/${batch.id}`,
    },
    { status: 202 },
  );
}
