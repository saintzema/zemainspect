import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["ADMIN", "VIEWER"]),
});

/**
 * Add a teammate to the organization.
 *
 * The user record is created (or attached) immediately with the chosen role;
 * they then sign in through the normal magic-link/Google flow, which matches
 * on email. There is deliberately no separate invitation token to expire.
 */
export async function POST(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "OWNER" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only an owner can invite" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid email and role are required" }, { status: 400 });
  }
  const { email, role } = parsed.data;
  const normalised = email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalised },
    select: { id: true, organizationId: true },
  });

  if (existing?.organizationId && existing.organizationId !== session.user.organizationId) {
    return NextResponse.json(
      { error: "That email already belongs to another organization" },
      { status: 409 },
    );
  }

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { organizationId: session.user.organizationId!, role },
    });
  } else {
    await prisma.user.create({
      data: { email: normalised, organizationId: session.user.organizationId!, role },
    });
  }

  return NextResponse.json({ ok: true });
}
