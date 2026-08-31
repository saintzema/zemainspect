import Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { env, hasEnv } from "@/lib/env";
import { stripePriceIdFor } from "@/lib/plans";
import {
  BillingNotConfiguredError,
  type BillingProvider,
  type CheckoutRequest,
  type CheckoutResult,
  type PortalRequest,
} from "@/lib/billing/types";

let cached: Stripe | null = null;

export function stripeClient(): Stripe {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new BillingNotConfiguredError("STRIPE");
  if (!cached) {
    cached = new Stripe(key, {
      apiVersion: "2026-07-29.dahlia",
      typescript: true,
    });
  }
  return cached;
}

async function ensureCustomer(organizationId: string, email: string, name: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeCustomerId: true },
  });
  if (org?.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripeClient().customers.create({
    email,
    name,
    metadata: { organization_id: organizationId },
  });
  await prisma.organization.update({
    where: { id: organizationId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export const stripeProvider: BillingProvider = {
  id: "STRIPE",

  isConfigured() {
    return hasEnv("STRIPE_SECRET_KEY");
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const priceId = stripePriceIdFor(req.tier);
    if (!priceId) throw new BillingNotConfiguredError(`STRIPE (no price id for ${req.tier})`);

    const customerId = await ensureCustomer(req.organizationId, req.email, req.organizationName);

    const session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.callbackUrl}?status=success`,
      cancel_url: `${req.callbackUrl}?status=cancelled`,
      client_reference_id: req.organizationId,
      subscription_data: { metadata: { organization_id: req.organizationId } },
      metadata: { organization_id: req.organizationId, tier: req.tier },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { redirectUrl: session.url, reference: session.id };
  },

  async createPortalLink(req: PortalRequest): Promise<string | null> {
    const org = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      select: { stripeCustomerId: true },
    });
    if (!org?.stripeCustomerId) return null;

    const portal = await stripeClient().billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: req.returnUrl,
    });
    return portal.url;
  },

  async cancelSubscription(organizationId: string): Promise<void> {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId },
      select: { stripeSubscriptionId: true },
    });
    if (!sub?.stripeSubscriptionId) {
      throw new Error("No Stripe subscription on file for this organization");
    }
    await stripeClient().subscriptions.cancel(sub.stripeSubscriptionId);
  },
};
