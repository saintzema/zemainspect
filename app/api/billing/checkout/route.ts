import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { billingProvider, configuredProviders, defaultProviderFor } from "@/lib/billing";
import { BillingNotConfiguredError } from "@/lib/billing/types";

export const runtime = "nodejs";

const schema = z.object({
  tier: z.enum(["STARTER", "PRO"]),
  provider: z.enum(["PAYSTACK", "STRIPE"]).optional(),
});

export async function POST(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "OWNER" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only an owner can change billing" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId! },
  });

  if (configuredProviders().length === 0) {
    return NextResponse.json({ error: "No payment provider is configured" }, { status: 503 });
  }

  const providerId =
    parsed.data.provider ?? defaultProviderFor(organization.billingCurrency);
  const provider = billingProvider(providerId);

  if (!provider.isConfigured()) {
    return NextResponse.json(
      { error: `${providerId} is not configured on this deployment` },
      { status: 503 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  try {
    const checkout = await provider.createCheckout({
      organizationId: organization.id,
      organizationName: organization.name,
      email: session.user.email,
      tier: parsed.data.tier,
      callbackUrl: `${appUrl}/billing`,
    });

    // Remember which rail this org is on so webhooks and the portal agree.
    await prisma.organization.update({
      where: { id: organization.id },
      data: { billingProvider: providerId },
    });

    return NextResponse.json({ redirect_url: checkout.redirectUrl });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("Checkout failed:", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
}
