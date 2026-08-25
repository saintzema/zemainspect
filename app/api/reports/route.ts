import { NextResponse } from "next/server";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capabilityIndex, defectsByType, summaryStats } from "@/lib/analytics";
import { effectiveTier, planFor } from "@/lib/plans";
import { renderComplianceReport } from "@/lib/reports/compliance-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId! },
  });

  const tier = effectiveTier(organization);
  if (!planFor(tier).complianceExport) {
    return NextResponse.json(
      { error: "Compliance export requires the Pro or Enterprise plan" },
      { status: 402 },
    );
  }

  const url = new URL(request.url);
  const to = parseDate(url.searchParams.get("to")) ?? new Date();
  const from =
    parseDate(url.searchParams.get("from")) ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (from > to) {
    return NextResponse.json({ error: "`from` must precede `to`" }, { status: 400 });
  }

  const language = url.searchParams.get("lang") === "zh" ? "zh" : "en";

  const [stats, byType] = await Promise.all([
    summaryStats(organization.id, from),
    defectsByType(organization.id, from, to),
  ]);

  const pdf = await renderComplianceReport({
    organizationName: organization.name,
    from,
    to,
    stats,
    byType,
    capability: capabilityIndex(stats.defectRate),
    language,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="zemainspect-report-${
        from.toISOString().slice(0, 10)
      }-to-${to.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
