import { createHmac, timingSafeEqual } from "crypto";

import { prisma } from "@/lib/prisma";
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
  return process.env.PAYSTACK_SECRET_KEY ?? "";
}

export function paystackPlanCodeFor(tier: PlanTier): string | undefined {
  if (tier === "STARTER") return process.env.PAYSTACK_PLAN_CODE_STARTER;
  if (tier === "PRO") return process.env.PAYSTACK_PLAN_CODE_PRO;
  return undefined;
}

export function tierForPaystackPlanCode(code: string): PlanTier | null {
  if (!code) return null;
  if (code === process.env.PAYSTACK_PLAN_CODE_STARTER) return "STARTER";
  if (code === process.env.PAYSTACK_PLAN_CODE_PRO) return "PRO";
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
    const planCode = paystackPlanCodeFor(req.tier);
    if (!planCode) {
      throw new BillingNotConfiguredError(`PAYSTACK (no plan code for ${req.tier})`);
    }

    // Read the amount off the plan itself so the initialize call can never
    // disagree with what the plan actually bills.
    const plan = await getPaystackPlan(planCode);

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
