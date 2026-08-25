import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({
  tier: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  until: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

/**
 * Grant an organization complimentary access to a paid tier.
 *
 * This is the pilot-customer path: a factory being managed by hand gets full
 * Pro behaviour without any subscription existing. Every grant is written to
 * the audit log with the admin who made it.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { tier, until } where until is a date" },
      { status: 400 },
    );
  }

  const until = new Date(parsed.data.until);
  if (Number.isNaN(until.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (until.getTime() <= Date.now()) {
    return NextResponse.json({ error: "The grant must end in the future" }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organization.id },
      data: { manualAccessUntil: until, manualPlanTier: parsed.data.tier },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminUserId: session.user.id,
        action: "grant_access",
        targetOrgId: organization.id,
        details: {
          tier: parsed.data.tier,
          until: until.toISOString(),
          organizationName: organization.name,
        },
      },
    }),
  ]);

  return NextResponse.json({ ok: true, until: until.toISOString() });
}

/** Revoke a complimentary grant early. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: params.id },
      data: { manualAccessUntil: null, manualPlanTier: null },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminUserId: session.user.id,
        action: "revoke_access",
        targetOrgId: params.id,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
