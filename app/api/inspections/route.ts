import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recentInspections } from "@/lib/analytics";
import { toCsv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dashboard feed. Polled by the live view; also serves the CSV export that
 * factories running an Excel-based QC log depend on.
 */
export async function GET(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;
  const lineId = url.searchParams.get("lineId") ?? undefined;
  const unreviewed = url.searchParams.get("unreviewed") === "true";

  const items = await recentInspections(session.user.organizationId!, {
    limit: format === "csv" ? 1000 : limit,
    before: before && !Number.isNaN(before.getTime()) ? before : undefined,
    lineId,
    onlyUnreviewedFails: unreviewed,
  });

  if (format === "csv") {
    const csv = toCsv(
      items.map((i) => ({
        inspection_id: i.id,
        processed_at: i.createdAt,
        result: i.result,
        defect_count: i.defects.length,
        defect_types: i.defects.map((d) => d.type).join(" | "),
        max_confidence: i.defects.length
          ? Math.max(...i.defects.map((d) => d.confidence)).toFixed(4)
          : "",
        product_category: i.productCategory,
        line_id: i.lineId ?? "",
        model_variant: i.modelVariant,
        inference_source: i.inferenceSource,
        processing_time_ms: i.processingTimeMs,
        image_url: i.imageUrl ?? "",
        reviewed_at: i.reviewedAt ?? "",
        reviewed_by: i.reviewedByName ?? "",
      })),
    );

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="zemainspect-inspections-${
          new Date().toISOString().slice(0, 10)
        }.csv"`,
      },
    });
  }

  return NextResponse.json({ items });
}

const patchSchema = z.object({
  reviewed: z.boolean(),
});

/**
 * Mark one inspection reviewed (or un-reviewed, to undo a mis-click) — the
 * action behind "which FAILs has nobody looked at yet" across several lines
 * and shifts. Body carries the inspection id rather than a path segment
 * because the feed already batches several of these per click on a
 * multi-select; a single route handles both shapes without duplicating the
 * ownership check.
 */
export async function PATCH(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "?id=<inspection id> is required" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { reviewed: boolean }" }, { status: 400 });
  }

  // Scoped by organizationId in the WHERE, not just checked after the fact:
  // an update matching zero rows (wrong org) and one matching the right row
  // must not be distinguishable by timing or response shape.
  const result = await prisma.inspectionJob.updateMany({
    where: { id, organizationId: session.user.organizationId! },
    data: parsed.data.reviewed
      ? { reviewedAt: new Date(), reviewedById: session.user.id }
      : { reviewedAt: null, reviewedById: null },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
