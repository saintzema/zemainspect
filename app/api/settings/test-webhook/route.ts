import { NextResponse } from "next/server";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";

/** Fire a representative payload so the customer can verify their signature check. */
export async function POST() {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId! },
    select: { id: true, webhookUrl: true, webhookSecret: true },
  });

  if (!organization.webhookUrl || !organization.webhookSecret) {
    return NextResponse.json({ error: "No webhook configured" }, { status: 400 });
  }

  const result = await deliverWebhook(organization.webhookUrl, organization.webhookSecret, {
    inspection_id: "insp_test_000000",
    organization_id: organization.id,
    result: "fail",
    defects: [{ type: "scratches", confidence: 0.91, bbox: [120, 64, 88, 32] }],
    product_category: "steel",
    line_id: "test-line",
    image_url: null,
    model_variant: "yolov8n-neu-onnx",
    processing_time_ms: 42,
    processed_at: new Date().toISOString(),
    test: true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? `Endpoint responded ${result.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, status: result.status });
}
