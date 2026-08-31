import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({
  disabled: z.boolean().optional(),
  role: z.enum(["OWNER", "ADMIN", "VIEWER", "SUPER_ADMIN"]).optional(),
});

/**
 * Disable, re-enable, or change the role of an account.
 *
 * Both take effect on the target's very next request: the session callback
 * re-reads role and disabled state from the database rather than trusting the
 * JWT, so there is no window where a revoked account keeps working.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.disabled === undefined && !parsed.data.role)) {
    return NextResponse.json(
      { error: "Provide { disabled } and/or { role }" },
      { status: 400 },
    );
  }

  // Locking yourself out, or demoting yourself out of the admin console, would
  // leave the platform with no way back in short of a database edit.
  if (params.id === session.user.id) {
    return NextResponse.json(
      { error: "You cannot disable or change the role of your own account." },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(parsed.data.disabled === undefined
        ? {}
        : { disabledAt: parsed.data.disabled ? new Date() : null }),
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
    },
    select: { id: true, role: true, disabledAt: true },
  });

  // Database sessions are gone under the JWT strategy, but rows can survive
  // from before the switch or from an OAuth sign-in. Drop them so a disabled
  // account has nothing left to resume.
  if (parsed.data.disabled) {
    await prisma.session.deleteMany({ where: { userId: target.id } }).catch(() => undefined);
  }

  await prisma.adminAuditLog.create({
    data: {
      adminUserId: session.user.id,
      action: parsed.data.disabled === undefined ? "change_role" : "set_user_disabled",
      details: {
        userId: target.id,
        email: target.email,
        disabled: updated.disabledAt !== null,
        role: updated.role,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    disabledAt: updated.disabledAt?.toISOString() ?? null,
    role: updated.role,
  });
}
