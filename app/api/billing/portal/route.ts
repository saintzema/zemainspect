import { NextResponse } from "next/server";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { billingProvider } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "OWNER" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only an owner can manage billing" }, { status: 403 });
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId! },
  });

  const provider = billingProvider(organization.billingProvider);
  if (!provider.isConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const appUrl = env("NEXT_PUBLIC_APP_URL") ?? new URL(request.url).origin;

  try {
    const url = await provider.createPortalLink({
      organizationId: organization.id,
      email: session.user.email,
      returnUrl: `${appUrl}/billing`,
    });

    if (!url) {
      return NextResponse.json(
        { error: "No active subscription to manage yet" },
        { status: 404 },
      );
    }
    return NextResponse.json({ redirect_url: url });
  } catch (err) {
    console.error("Portal link failed:", err);
    return NextResponse.json({ error: "Could not open the billing portal" }, { status: 502 });
  }
}
