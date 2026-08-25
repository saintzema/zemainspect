import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordInspectionUsage } from "@/lib/usage";
import { effectiveTier, isTrialExpired, planFor } from "@/lib/plans";
import { PRODUCT_CATEGORIES } from "@/lib/inference/labels";
import { buildInspectionPayload, deliverWebhook } from "@/lib/webhooks";
import { storeInspectionImage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Ingest a result produced by the in-browser edge model.
 *
 * The frame itself stays in the plant; only the detections and an optional
 * small thumbnail are uploaded. This is what makes real-time inspection work
 * over a slow or intermittent link — the round trip is a few hundred bytes,
 * not a megapixel image.
 */
const schema = z.object({
  result: z.enum(["PASS", "FAIL"]),
  defects: z
    .array(
      z.object({
        type: z.string().max(64),
        confidence: z.number().min(0).max(1),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      }),
    )
    .max(100),
  product_category: z.enum(PRODUCT_CATEGORIES).default("steel"),
  line_id: z.string().trim().max(120).optional(),
  processing_time_ms: z.number().int().min(0).max(600_000),
  model_variant: z.string().max(64).default("yolov8n-neu-web"),
  /** Optional data: URL thumbnail, capped well below the body limit. */
  thumbnail: z.string().max(400_000).optional(),
});

export async function POST(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const organization = await prisma.organization.findUnique({
    where: { id: session.user.organizationId! },
    include: { subscription: true },
  });
  if (!organization) return NextResponse.json({ error: "No organization" }, { status: 404 });

  if (isTrialExpired(organization)) {
    return NextResponse.json({ error: "Trial expired" }, { status: 402 });
  }

  const tier = effectiveTier(organization);
  const limit =
    organization.subscription?.monthlyInspectionLimit ?? planFor(tier).monthlyInspectionLimit;
  const used = organization.subscription?.inspectionsUsedThisCycle ?? 0;
  if (tier === "TRIAL" && used >= limit) {
    return NextResponse.json({ error: "Quota exceeded" }, { status: 429 });
  }

  let imageUrl: string | null = null;
  if (body.thumbnail?.startsWith("data:image/")) {
    const commaAt = body.thumbnail.indexOf(",");
    const meta = body.thumbnail.slice(5, commaAt);
    const contentType = meta.split(";")[0] || "image/jpeg";
    const buffer = Buffer.from(body.thumbnail.slice(commaAt + 1), "base64");
    imageUrl = await storeInspectionImage(organization.id, buffer, contentType);
  }

  const job = await prisma.inspectionJob.create({
    data: {
      organizationId: organization.id,
      imageUrl,
      productCategory: body.product_category,
      lineId: body.line_id ?? null,
      result: body.result,
      defects: body.defects,
      modelVariant: body.model_variant,
      inferenceSource: "edge",
      processingTimeMs: body.processing_time_ms,
    },
  });

  await recordInspectionUsage(organization.id);

  if (organization.webhookUrl && organization.webhookSecret) {
    const payload = buildInspectionPayload({ ...job, defects: body.defects, result: body.result });
    void deliverWebhook(organization.webhookUrl, organization.webhookSecret, payload).catch(
      () => undefined,
    );
  }

  return NextResponse.json({ inspection_id: job.id }, { status: 201 });
}
