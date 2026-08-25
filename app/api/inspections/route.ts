import { NextResponse } from "next/server";

import { requireOrgSession } from "@/lib/auth";
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

  const items = await recentInspections(
    session.user.organizationId!,
    format === "csv" ? 1000 : limit,
    before && !Number.isNaN(before.getTime()) ? before : undefined,
  );

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
