import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { usageFor } from "@/lib/usage";
import { effectiveTier } from "@/lib/plans";
import { configuredProviders } from "@/lib/billing";
import { PageHeading } from "@/components/dashboard/stats-row";
import { UsageProgressBar } from "@/components/dashboard/usage-progress-bar";
import { BillingPanel } from "@/components/dashboard/billing-panel";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/signin");

  const [organization, usage] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: session.user.organizationId },
      include: { subscription: true },
    }),
    usageFor(session.user.organizationId),
  ]);

  return (
    <div className="space-y-5">
      <PageHeading titleKey="billing.title" subtitleKey="billing.subtitle" />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <BillingPanel
          tier={effectiveTier(organization)}
          billedTier={organization.planTier}
          status={organization.subscription?.status ?? "TRIALING"}
          currentPeriodEnd={organization.subscription?.currentPeriodEnd ?? null}
          manualAccessUntil={organization.manualAccessUntil}
          manualPlanTier={organization.manualPlanTier}
          availableProviders={configuredProviders().map((p) => p.id)}
          isOwner={session.user.role === "OWNER" || session.user.role === "SUPER_ADMIN"}
        />
        <UsageProgressBar usage={usage} showUpgrade={false} />
      </div>
    </div>
  );
}
