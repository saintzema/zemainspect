import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recentInspections, summaryStats } from "@/lib/analytics";
import { usageFor } from "@/lib/usage";
import { effectiveTier } from "@/lib/plans";
import { modelIsConfigured } from "@/lib/inference/model-source";
import { envOr } from "@/lib/env";
import { InspectionFeed } from "@/components/dashboard/inspection-feed";
import { EdgeInspector } from "@/components/dashboard/edge-inspector";
import { StatsRow, PageHeading } from "@/components/dashboard/stats-row";
import { UsageProgressBar } from "@/components/dashboard/usage-progress-bar";
import { TrialBanner } from "@/components/dashboard/trial-banner";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/signin");
  const organizationId = session.user.organizationId;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [organization, stats, items, usage] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    summaryStats(organizationId, since),
    recentInspections(organizationId, 40),
    usageFor(organizationId),
  ]);

  const tier = effectiveTier(organization);

  // Served from our own origin so a plant that blocks public CDNs still works.
  const modelUrl = modelIsConfigured()
    ? `/models/${envOr("MODEL_FILE", "yolov8n-neu.onnx")}`
    : null;

  return (
    <div className="space-y-5">
      <PageHeading titleKey="dashboard.title" subtitleKey="dashboard.subtitle" />

      <TrialBanner
        tier={tier}
        trialEndsAt={organization.trialEndsAt}
        manualAccessUntil={organization.manualAccessUntil}
        manualPlanTier={organization.manualPlanTier}
        remaining={usage.remaining}
      />

      <StatsRow stats={stats} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <InspectionFeed initialItems={items} />
        <UsageProgressBar usage={usage} showUpgrade={tier === "TRIAL" || tier === "STARTER"} />
      </div>

      <EdgeInspector modelUrl={modelUrl} />
    </div>
  );
}
