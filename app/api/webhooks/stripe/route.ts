import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { stripeClient } from "@/lib/billing/stripe";
import { syncSubscription } from "@/lib/billing/sync";
import { tierForStripePriceId } from "@/lib/plans";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Stripe webhooks not configured" }, { status: 503 });
  }

  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("Stripe signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const organizationId =
          session.client_reference_id ?? session.metadata?.organization_id;
        if (!organizationId || !session.subscription) break;

        const subscription = await stripeClient().subscriptions.retrieve(
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id,
        );
        await applyStripeSubscription(organizationId, subscription, true);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const organizationId = await resolveOrganizationId(subscription);
        if (organizationId) await applyStripeSubscription(organizationId, subscription, false);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const organizationId = await resolveOrganizationId(subscription);
        if (organizationId) {
          await prisma.$transaction([
            prisma.subscription.updateMany({
              where: { organizationId },
              data: { status: "CANCELLED" },
            }),
            prisma.organization.update({
              where: { id: organizationId },
              data: { planTier: "TRIAL" },
            }),
          ]);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const org = await prisma.organization.findUnique({
            where: { stripeCustomerId: customerId },
            select: { id: true },
          });
          if (org) {
            await prisma.subscription.updateMany({
              where: { organizationId: org.id },
              data: { status: "PAST_DUE" },
            });
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook ${event.type} failed:`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

const STATUS_MAP: Record<string, "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED"> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  unpaid: "PAST_DUE",
  incomplete: "PAST_DUE",
  incomplete_expired: "CANCELLED",
  canceled: "CANCELLED",
  paused: "CANCELLED",
};

async function applyStripeSubscription(
  organizationId: string,
  subscription: Stripe.Subscription,
  resetCycle: boolean,
) {
  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const tier = priceId ? tierForStripePriceId(priceId) : null;
  if (!tier) {
    console.warn(`Stripe price ${priceId} does not map to a known tier; ignoring.`);
    return;
  }

  // current_period_end lives on the subscription item in recent API versions.
  const periodEndSeconds = item?.current_period_end;
  const currentPeriodEnd = periodEndSeconds
    ? new Date(periodEndSeconds * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await syncSubscription({
    organizationId,
    provider: "STRIPE",
    tier,
    status: STATUS_MAP[subscription.status] ?? "ACTIVE",
    currentPeriodEnd,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    resetCycle,
  });
}

async function resolveOrganizationId(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  if (subscription.metadata?.organization_id) return subscription.metadata.organization_id;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId) return null;

  const org = await prisma.organization.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return org?.id ?? null;
}
