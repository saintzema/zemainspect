import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { syncSubscription } from "@/lib/billing/sync";
import {
  tierForPaystackPlanCode,
  verifyPaystackSignature,
} from "@/lib/billing/paystack";

export const runtime = "nodejs";

/**
 * Paystack subscription lifecycle.
 *
 * The raw body must be read as text and verified before parsing — Paystack
 * signs the exact bytes it sent, so re-serialising the JSON would break the
 * HMAC.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyPaystackSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: {
    event: string;
    data: Record<string, unknown>;
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const data = event.data ?? {};

  try {
    switch (event.event) {
      case "charge.success":
      case "subscription.create": {
        const organizationId = await resolveOrganizationId(data);
        if (!organizationId) break;

        const planCode = readPlanCode(data);
        const tier = planCode ? tierForPaystackPlanCode(planCode) : null;
        if (!tier) break;

        await syncSubscription({
          organizationId,
          provider: "PAYSTACK",
          tier,
          status: "ACTIVE",
          currentPeriodEnd: readNextPaymentDate(data),
          paystackSubscriptionCode: (data.subscription_code as string) ?? null,
          paystackEmailToken: (data.email_token as string) ?? null,
          paystackPlanCode: planCode,
          resetCycle: true,
        });
        break;
      }

      case "invoice.payment_failed": {
        const organizationId = await resolveOrganizationId(data);
        if (organizationId) {
          await prisma.subscription.updateMany({
            where: { organizationId },
            data: { status: "PAST_DUE" },
          });
        }
        break;
      }

      case "subscription.disable":
      case "subscription.not_renew": {
        const organizationId = await resolveOrganizationId(data);
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

      default:
        // Unhandled event types are acknowledged so Paystack stops retrying.
        break;
    }
  } catch (err) {
    console.error(`Paystack webhook ${event.event} failed:`, err);
    // 500 makes Paystack retry, which is what we want for a transient fault.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function readPlanCode(data: Record<string, unknown>): string | null {
  const plan = data.plan;
  if (typeof plan === "string") return plan;
  if (plan && typeof plan === "object" && "plan_code" in plan) {
    return String((plan as { plan_code: unknown }).plan_code);
  }
  return null;
}

function readNextPaymentDate(data: Record<string, unknown>): Date {
  const raw = data.next_payment_date;
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // Default to a month out so the org is never left with a past period end.
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Find the organization behind an event, preferring the metadata we set at
 * checkout and falling back to the stored customer code or subscription code.
 */
async function resolveOrganizationId(
  data: Record<string, unknown>,
): Promise<string | null> {
  const metadata = data.metadata as { organization_id?: string } | undefined;
  if (metadata?.organization_id) return metadata.organization_id;

  const customer = data.customer as { customer_code?: string } | undefined;
  if (customer?.customer_code) {
    const org = await prisma.organization.findUnique({
      where: { paystackCustomerCode: customer.customer_code },
      select: { id: true },
    });
    if (org) return org.id;
  }

  if (typeof data.subscription_code === "string") {
    const sub = await prisma.subscription.findUnique({
      where: { paystackSubscriptionCode: data.subscription_code },
      select: { organizationId: true },
    });
    if (sub) return sub.organizationId;
  }

  return null;
}
