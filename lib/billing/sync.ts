import { prisma } from "@/lib/prisma";
import { planFor } from "@/lib/plans";
import type { PlanTier, PaymentProvider, SubscriptionStatus } from "@/lib/generated/prisma";

export interface SubscriptionSyncInput {
  organizationId: string;
  provider: PaymentProvider;
  tier: PlanTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackEmailToken?: string | null;
  paystackPlanCode?: string | null;
  /** Reset usage counters — set on a genuine new billing period. */
  resetCycle?: boolean;
}

/**
 * Apply a provider event to our own subscription state.
 *
 * Both webhook handlers funnel through here so Stripe and Paystack can never
 * drift into different shapes of truth, and so Organization.planTier always
 * matches the Subscription row.
 */
export async function syncSubscription(input: SubscriptionSyncInput) {
  const limit = planFor(input.tier).monthlyInspectionLimit;

  await prisma.$transaction([
    prisma.subscription.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        provider: input.provider,
        planTier: input.tier,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd,
        monthlyInspectionLimit: limit,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripePriceId: input.stripePriceId ?? null,
        paystackSubscriptionCode: input.paystackSubscriptionCode ?? null,
        paystackEmailToken: input.paystackEmailToken ?? null,
        paystackPlanCode: input.paystackPlanCode ?? null,
      },
      update: {
        provider: input.provider,
        planTier: input.tier,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd,
        monthlyInspectionLimit: limit,
        ...(input.stripeSubscriptionId
          ? { stripeSubscriptionId: input.stripeSubscriptionId }
          : {}),
        ...(input.stripePriceId ? { stripePriceId: input.stripePriceId } : {}),
        ...(input.paystackSubscriptionCode
          ? { paystackSubscriptionCode: input.paystackSubscriptionCode }
          : {}),
        ...(input.paystackEmailToken
          ? { paystackEmailToken: input.paystackEmailToken }
          : {}),
        ...(input.paystackPlanCode ? { paystackPlanCode: input.paystackPlanCode } : {}),
        ...(input.resetCycle
          ? { inspectionsUsedThisCycle: 0, overageInspections: 0 }
          : {}),
      },
    }),
    prisma.organization.update({
      where: { id: input.organizationId },
      data: { planTier: input.tier, billingProvider: input.provider },
    }),
  ]);

  if (input.status === "ACTIVE") {
    await applyReferralCreditIfAny(input.organizationId);
  }
}

/**
 * When a referred organization first becomes ACTIVE, record the free month
 * owed to whoever referred them. Unique on (referrer, referred) so repeated
 * webhooks cannot mint duplicate credits.
 */
export async function applyReferralCreditIfAny(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { referredByCode: true },
  });
  if (!org?.referredByCode) return;

  const referrer = await prisma.organization.findUnique({
    where: { referralCode: org.referredByCode },
    select: { id: true },
  });
  if (!referrer || referrer.id === organizationId) return;

  await prisma.referralCredit
    .create({
      data: {
        referrerOrgId: referrer.id,
        referredOrgId: organizationId,
        creditMonths: 1,
        status: "pending",
      },
    })
    .catch(() => undefined); // Unique constraint — credit already recorded.
}
