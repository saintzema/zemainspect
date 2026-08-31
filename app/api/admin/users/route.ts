import { NextResponse } from "next/server";
import { z } from "zod";

import { provisionNewUser, requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["OWNER", "ADMIN", "VIEWER", "SUPER_ADMIN"]).default("VIEWER"),
  // Omit to give the user a brand-new organization of their own, which is what
  // a self-serve signup would have done.
  organizationId: z.string().trim().min(1).optional(),
});

/**
 * Create an account on someone's behalf.
 *
 * This is the path for a factory whose staff cannot receive our email at all:
 * the admin creates the account, reads the temporary password off the screen,
 * and hands it over. The password is returned exactly once and never stored in
 * plaintext, so it cannot be recovered from the audit log later.
 */
export async function POST(request: Request) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { email, role } and optionally { name, organizationId }" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();

  // Unlike self-serve signup, an admin creating a duplicate is a mistake worth
  // naming plainly: they are already authenticated, so there is nothing to
  // enumerate.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
  }

  if (parsed.data.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name || null,
      passwordHash,
      role: parsed.data.role,
      organizationId: parsed.data.organizationId ?? null,
    },
    select: { id: true, email: true, name: true },
  });

  // No organization given: give them their own on a trial, exactly as a
  // self-serve signup would. provisionNewUser also sets the role, so re-apply
  // the admin's choice afterwards rather than letting it be overwritten.
  if (!parsed.data.organizationId) {
    await provisionNewUser(user.id, user.email, user.name);
    await prisma.user.update({
      where: { id: user.id },
      data: { role: parsed.data.role },
    });
  }

  await prisma.adminAuditLog.create({
    data: {
      adminUserId: session.user.id,
      action: "create_user",
      details: { userId: user.id, email: user.email, role: parsed.data.role },
    },
  });

  return NextResponse.json({ ok: true, id: user.id, temporaryPassword }, { status: 201 });
}
