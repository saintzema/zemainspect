import type { PlanTier } from "@/lib/generated/prisma";

export interface PlanDefinition {
  tier: PlanTier;
  /** Monthly price in USD cents. `null` = custom / contact sales. */
  priceUsdCents: number | null;
  /** Monthly price in CNY fen, for the Chinese pricing table. */
  priceCnyFen: number | null;
  /**
   * Monthly price in NGN kobo, for Paystack.
   *
   * Held as its own number rather than converted from USD at request time: a
   * price that drifts with the exchange rate is impossible to quote to a
   * customer, and Paystack bills in whole naira. Adjust deliberately when the
   * rate moves far enough to matter. Overridable per deployment with
   * PAYSTACK_PRICE_STARTER_KOBO / PAYSTACK_PRICE_PRO_KOBO.
   */
  priceNgnKobo: number | null;
  monthlyInspectionLimit: number;
  cameraLines: number | null; // null = unlimited
  apiAccess: boolean;
  complianceExport: boolean;
  prioritySupport: boolean;
  /** Overage charge per inspection beyond the plan limit, in USD cents. */
  overageUsdCents: number;
  stripePriceIdEnv?: string;
}

export const TRIAL_DAYS = 14;
export const TRIAL_INSPECTIONS = 500;

export const PLANS: Record<PlanTier, PlanDefinition> = {
  TRIAL: {
    tier: "TRIAL",
    priceUsdCents: 0,
    priceCnyFen: 0,
    priceNgnKobo: 0,
    monthlyInspectionLimit: TRIAL_INSPECTIONS,
    cameraLines: 1,
    apiAccess: true,
    complianceExport: false,
    prioritySupport: false,
    overageUsdCents: 0,
  },
  STARTER: {
    tier: "STARTER",
    priceUsdCents: 4900,
    priceCnyFen: 35000,
    // ₦75,000/month — set against $49 at roughly ₦1,530/$.
    priceNgnKobo: 7_500_000,
    monthlyInspectionLimit: 5_000,
    cameraLines: 3,
    apiAccess: true,
    complianceExport: false,
    prioritySupport: false,
    overageUsdCents: 1,
    stripePriceIdEnv: "STRIPE_PRICE_ID_STARTER",
  },
  PRO: {
    tier: "PRO",
    priceUsdCents: 14900,
    priceCnyFen: 105000,
    // ₦225,000/month — set against $149 at roughly ₦1,510/$.
    priceNgnKobo: 22_500_000,
    monthlyInspectionLimit: 25_000,
    cameraLines: null,
    apiAccess: true,
    complianceExport: true,
    prioritySupport: true,
    overageUsdCents: 1,
    stripePriceIdEnv: "STRIPE_PRICE_ID_PRO",
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    priceUsdCents: null,
    priceCnyFen: null,
    priceNgnKobo: null,
    monthlyInspectionLimit: Number.MAX_SAFE_INTEGER,
    cameraLines: null,
    apiAccess: true,
    complianceExport: true,
    prioritySupport: true,
    overageUsdCents: 0,
  },
};

export const PLAN_ORDER: PlanTier[] = ["TRIAL", "STARTER", "PRO", "ENTERPRISE"];

export function planFor(tier: PlanTier): PlanDefinition {
  return PLANS[tier];
}

/**
 * The tier an organization is actually entitled to right now.
 *
 * An admin-granted override (the pilot-customer path) wins over the billed
 * tier while it is live, so a factory on a hand-managed free pilot gets Pro
 * behaviour without a Stripe subscription existing at all.
 */
export function effectiveTier(org: {
  planTier: PlanTier;
  manualAccessUntil: Date | null;
  manualPlanTier: PlanTier | null;
  trialEndsAt: Date | null;
}): PlanTier {
  const now = Date.now();
  if (org.manualAccessUntil && org.manualAccessUntil.getTime() > now) {
    return org.manualPlanTier ?? "PRO";
  }
  return org.planTier;
}

/** True when a TRIAL org has run past its trial window with no override. */
export function isTrialExpired(org: {
  planTier: PlanTier;
  manualAccessUntil: Date | null;
  manualPlanTier: PlanTier | null;
  trialEndsAt: Date | null;
}): boolean {
  if (effectiveTier(org) !== "TRIAL") return false;
  return !!org.trialEndsAt && org.trialEndsAt.getTime() < Date.now();
}

export function stripePriceIdFor(tier: PlanTier): string | undefined {
  const key = PLANS[tier].stripePriceIdEnv;
  return key ? process.env[key] : undefined;
}

export function tierForStripePriceId(priceId: string): PlanTier | null {
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_STARTER) return "STARTER";
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_PRO) return "PRO";
  return null;
}
