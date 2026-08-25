import { NextResponse } from "next/server";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Revoke a key. Kept as a soft delete so the audit trail survives. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "VIEWER") {
    return NextResponse.json({ error: "Viewers cannot revoke API keys" }, { status: 403 });
  }

  // updateMany scopes by org, so one tenant cannot revoke another's key.
  const { count } = await prisma.apiKey.updateMany({
    where: {
      id: params.id,
      organizationId: session.user.organizationId!,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
