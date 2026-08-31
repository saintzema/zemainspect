import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";

export const runtime = "nodejs";

/**
 * Issue a new temporary password for an account.
 *
 * There is no "forgot password" email flow, because the whole reason password
 * sign-in exists here is that email is not dependable for these users. The
 * admin resets it and passes it on by whatever channel actually works — WeChat,
 * a phone call, or in person.
 *
 * The plaintext is returned in this one response and nowhere else: it is not
 * written to the audit log, so the log can be read freely without handing out
 * live credentials.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const temporaryPassword = generateTemporaryPassword();
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(temporaryPassword) },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminUserId: session.user.id,
      action: "reset_password",
      details: { userId: target.id, email: target.email },
    },
  });

  return NextResponse.json({ ok: true, temporaryPassword });
}
