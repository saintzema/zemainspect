import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { usageFor } from "@/lib/usage";
import { effectiveTier } from "@/lib/plans";
import { configuredProviders } from "@/lib/billing";
import { alipayConfig, alipayPriceFor, alipayReference } from "@/lib/billing/alipay";
import { PageHeading } from "@/components/dashboard/stats-row";
import { UsageProgressBar } from "@/components/dashboard/usage-progress-bar";
import { BillingPanel } from "@/components/dashboard/billing-panel";
import { AlipayPanel, type AlipayOffer } from "@/components/dashboard/alipay-panel";

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

  const alipay = alipayConfig();
  const isOwner = session.user.role === "OWNER" || session.user.role === "SUPER_ADMIN";

  // Only tiers that are an actual change from what they are billed for, and
  // only ones we have a yuan price for.
  const alipayOffers: AlipayOffer[] = (["STARTER", "PRO"] as const)
    .filter((tier) => tier !== organization.planTier)
    .flatMap((tier) => {
      const price = alipayPriceFor(tier);
      if (!price) return [];
      return [{ tier, price, reference: alipayReference(organization.id, tier) }];
    });

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
          isOwner={isOwner}
        />
        <UsageProgressBar usage={usage} showUpgrade={false} />
      </div>

      {alipay && isOwner && (
        <AlipayPanel
          qrUrl={alipay.qrUrl}
          contact={alipay.contact}
          accountName={alipay.accountName}
          offers={alipayOffers}
        />
      )}
    </div>
  );
}
