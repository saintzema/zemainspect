import { createHmac, timingSafeEqual } from "crypto";

import { prisma } from "@/lib/prisma";
import { env, envOr } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import type { PlanTier } from "@/lib/generated/prisma";
import {
  BillingNotConfiguredError,
  type BillingProvider,
  type CheckoutRequest,
  type CheckoutResult,
  type PortalRequest,
} from "@/lib/billing/types";

const PAYSTACK_API = "https://api.paystack.co";

function secretKey() {
  return env("PAYSTACK_SECRET_KEY") ?? "";
}

/**
 * The currency Paystack charges in.
 *
 * A Nigerian Paystack account is enabled for NGN out of the box; USD and other
 * currencies have to be switched on per account, so defaulting to anything
 * else would make checkout fail on a brand-new account.
 */
export function paystackCurrency(): string {
  return envOr("PAYSTACK_CURRENCY", "NGN").toUpperCase();
}

/**
 * The amount to bill for a tier, in Paystack's minor unit (kobo for NGN).
 *
 * Read from the plan table so the number matches the published price, with a
 * per-deployment override for anyone running different pricing.
 */
export function paystackAmountFor(tier: PlanTier): number | null {
  const override = env(`PAYSTACK_PRICE_${tier}_KOBO`);
  if (override && /^\d+$/.test(override)) return Number(override);

  const currency = paystackCurrency();
  const plan = PLANS[tier];
  if (currency === "NGN") return plan.priceNgnKobo;
  if (currency === "USD") return plan.priceUsdCents;
  // Any other currency has no published price, so refuse rather than guess.
  return null;
}

/** A stable, human-readable name we can find the plan by on the account. */
export function paystackPlanNameFor(tier: PlanTier): string {
  return `ZemaInspect ${tier} (${paystackCurrency()})`;
}

/** An explicitly configured plan code, if the deployment pins one. */
export function paystackPlanCodeFor(tier: PlanTier): string | undefined {
  if (tier === "STARTER") return env("PAYSTACK_PLAN_CODE_STARTER");
  if (tier === "PRO") return env("PAYSTACK_PLAN_CODE_PRO");
  return undefined;
}

export function tierForPaystackPlanCode(code: string): PlanTier | null {
  if (!code) return null;
  if (code === env("PAYSTACK_PLAN_CODE_STARTER")) return "STARTER";
  if (code === env("PAYSTACK_PLAN_CODE_PRO")) return "PRO";
  return null;
}

const BILLABLE_TIERS = ["STARTER", "PRO"] as const;

/**
 * Work out which tier a webhook is about.
 *
 * Three sources, most trustworthy first:
 *
 *  1. The plan code, when the deployment pins PAYSTACK_PLAN_CODE_*.
 *  2. The `tier` we put in metadata when we initialised the transaction. This
 *     is our own value coming back, and it is the only source that works for a
 *     one-off charge with no plan attached.
 *  3. The plan's name on the Paystack account, for plans this app created.
 *     Requires an API call, so it is the last resort.
 *
 * Returning null here means a real payment would be dropped on the floor, so
 * the fallbacks matter: with auto-created plans there is no configured code to
 * match against, and step 1 alone would never fire.
 */
export async function resolveTierFromEvent(
  planCode: string | null,
  metadata: Record<string, unknown> | undefined,
): Promise<PlanTier | null> {
  if (planCode) {
    const pinned = tierForPaystackPlanCode(planCode);
    if (pinned) return pinned;
  }

  const fromMetadata = metadata?.tier;
  if (typeof fromMetadata === "string") {
    const match = BILLABLE_TIERS.find((tier) => tier === fromMetadata.toUpperCase());
    if (match) return match;
  }

  if (planCode) {
    // The plan may have been created by an earlier release at a different
    // price, so match on name alone rather than name + amount.
    const plan = await getPaystackPlan(planCode).catch(() => null);
    if (plan) {
      const match = BILLABLE_TIERS.find(
        (tier) => plan.name === paystackPlanNameFor(tier),
      );
      if (match) return match;
    }
  }

  return null;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

async function paystackFetch<T>(
  path: string,
  init?: RequestInit & { body?: string },
): Promise<T> {
  if (!secretKey()) throw new BillingNotConfiguredError("PAYSTACK");

  const res = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await res.text();
  let payload: PaystackEnvelope<T>;
  try {
    payload = JSON.parse(text) as PaystackEnvelope<T>;
  } catch {
    throw new Error(`Paystack ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || !payload.status) {
    throw new Error(`Paystack ${path} failed (${res.status}): ${payload.message ?? text.slice(0, 200)}`);
  }
  return payload.data;
}

export interface PaystackPlan {
  id: number;
  name: string;
  plan_code: string;
  /** Minor units (kobo for NGN, cents for USD). */
  amount: number;
  interval: string;
  currency: string;
}

export function getPaystackPlan(planCode: string) {
  return paystackFetch<PaystackPlan>(`/plan/${encodeURIComponent(planCode)}`);
}

/**
 * Find or create the subscription plan for a tier.
 *
 * Paystack has no concept of a price you can quote inline on a subscription —
 * it needs a Plan object that exists on the account. Requiring the operator to
 * hand-create those in the dashboard and paste the PLN_ codes into environment
 * variables is the single most common way this integration ends up broken: the
 * codes get pasted from the live account into a test deployment, or the plan
 * is deleted, and every checkout fails with an opaque error.
 *
 * So do it ourselves. A pinned PAYSTACK_PLAN_CODE_* still wins if set, for
 * anyone who wants to manage plans by hand. Otherwise we look for a plan we
 * previously created (matched on name, amount and currency together, so a
 * price change makes a new plan rather than silently billing the old amount)
 * and create one if there is none. Both paths are idempotent, so a brand-new
 * Paystack account works with nothing configured but the secret key.
 */
export async function resolvePaystackPlan(tier: PlanTier): Promise<PaystackPlan> {
  const pinned = paystackPlanCodeFor(tier);
  if (pinned) {
    // Do not let a stale pin take checkout down. A code pasted from the live
    // account into a test deployment (or from an account that no longer has
    // the plan) resolves to a 404 here, and hard-failing on it would mean no
    // customer can pay until someone edits an environment variable. Warn, then
    // fall through to the plan we manage ourselves.
    const plan = await getPaystackPlan(pinned).catch((err: unknown) => {
      console.warn(
        `Paystack plan code "${pinned}" for ${tier} did not resolve; falling back to a managed plan.`,
        err,
      );
      return null;
    });
    if (plan) return plan;
  }

  const amount = paystackAmountFor(tier);
  if (amount === null) {
    throw new BillingNotConfiguredError(
      `PAYSTACK (no ${paystackCurrency()} price for ${tier}; set PAYSTACK_PRICE_${tier}_KOBO)`,
    );
  }

  const currency = paystackCurrency();
  const name = paystackPlanNameFor(tier);

  const existing = await paystackFetch<PaystackPlan[]>("/plan?perPage=100&status=active");
  const match = existing.find(
    (plan) =>
      plan.name === name &&
      plan.amount === amount &&
      plan.currency === currency &&
      plan.interval === "monthly",
  );
  if (match) return match;

  return paystackFetch<PaystackPlan>("/plan", {
    method: "POST",
    body: JSON.stringify({ name, amount, currency, interval: "monthly" }),
  });
}

/**
 * Verify a Paystack webhook. The signature is an HMAC-SHA512 of the raw
 * request body keyed with the secret key, so the caller must pass the body
 * exactly as received — not a re-serialised object.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !secretKey()) return false;
  const expected = createHmac("sha512", secretKey()).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export const paystackProvider: BillingProvider = {
  id: "PAYSTACK",

  isConfigured() {
    return !!secretKey();
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    // Read the amount off the plan itself so the initialize call can never
    // disagree with what the plan actually bills.
    const plan = await resolvePaystackPlan(req.tier);
    const planCode = plan.plan_code;

    const data = await paystackFetch<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: req.email,
        amount: plan.amount,
        currency: plan.currency,
        plan: planCode,
        callback_url: req.callbackUrl,
        metadata: {
          organization_id: req.organizationId,
          organization_name: req.organizationName,
          tier: req.tier,
          // Surfaced on the Paystack dashboard transaction view.
          custom_fields: [
            {
              display_name: "Organization",
              variable_name: "organization",
              value: req.organizationName,
            },
          ],
        },
      }),
    });

    return { redirectUrl: data.authorization_url, reference: data.reference };
  },

  async createPortalLink(req: PortalRequest): Promise<string | null> {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId: req.organizationId },
      select: { paystackSubscriptionCode: true },
    });
    if (!sub?.paystackSubscriptionCode) return null;

    const data = await paystackFetch<{ link: string }>(
      `/subscription/${encodeURIComponent(sub.paystackSubscriptionCode)}/manage/link`,
    );
    return data.link;
  },

  async cancelSubscription(organizationId: string): Promise<void> {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId },
      select: { paystackSubscriptionCode: true, paystackEmailToken: true },
    });
    if (!sub?.paystackSubscriptionCode || !sub.paystackEmailToken) {
      throw new Error("No Paystack subscription on file for this organization");
    }

    await paystackFetch("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({
        code: sub.paystackSubscriptionCode,
        token: sub.paystackEmailToken,
      }),
    });
  },
};

export { paystackFetch };
