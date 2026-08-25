import { NextResponse } from "next/server";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Detach a teammate from the organization. Owners cannot be removed here. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "OWNER" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only an owner can remove teammates" }, { status: 403 });
  }
  if (params.id === session.user.id) {
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  }

  const { count } = await prisma.user.updateMany({
    where: {
      id: params.id,
      organizationId: session.user.organizationId!,
      role: { in: ["ADMIN", "VIEWER"] },
    },
    data: { organizationId: null },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Member not found or not removable" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
