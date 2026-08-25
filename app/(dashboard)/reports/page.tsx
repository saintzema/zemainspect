import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capabilityIndex, defectsByType, summaryStats } from "@/lib/analytics";
import { effectiveTier, planFor } from "@/lib/plans";
import { PageHeading } from "@/components/dashboard/stats-row";
import { ReportBuilder } from "@/components/dashboard/report-builder";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/signin");

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
  });

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [stats, byType] = await Promise.all([
    summaryStats(organization.id, from),
    defectsByType(organization.id, from, to),
  ]);

  const tier = effectiveTier(organization);

  return (
    <div className="space-y-5">
      <PageHeading titleKey="reports.title" subtitleKey="reports.subtitle" />
      <ReportBuilder
        allowed={planFor(tier).complianceExport}
        defaultFrom={from.toISOString().slice(0, 10)}
        defaultTo={to.toISOString().slice(0, 10)}
        stats={stats}
        defectClasses={byType.length}
        capability={capabilityIndex(stats.defectRate)}
      />
    </div>
  );
}
