import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import type { Detection } from "@/lib/inference/postprocess";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const batch = await prisma.inspectionBatch.findFirst({
    // Scoped to the caller's org so a valid key cannot read another tenant's batch.
    where: { id: params.id, organizationId: auth.ctx.organization.id },
    include: {
      jobs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          result: true,
          defects: true,
          imageUrl: true,
          processingTimeMs: true,
          createdAt: true,
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No such batch." } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    batch_id: batch.id,
    status: batch.status.toLowerCase(),
    product_category: batch.productCategory,
    line_id: batch.lineId,
    total: batch.totalImages,
    processed: batch.processedImages,
    failed: batch.failedImages,
    error: batch.error,
    created_at: batch.createdAt.toISOString(),
    completed_at: batch.completedAt?.toISOString() ?? null,
    results: batch.jobs.map((job) => ({
      inspection_id: job.id,
      result: job.result === "PASS" ? "pass" : "fail",
      defects: (job.defects as unknown as Detection[]) ?? [],
      image_url: job.imageUrl,
      processing_time_ms: job.processingTimeMs,
      processed_at: job.createdAt.toISOString(),
    })),
  });
}
