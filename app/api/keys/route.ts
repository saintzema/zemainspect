import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/api-key";

export const runtime = "nodejs";

const createSchema = z.object({ label: z.string().trim().max(80).optional() });

export async function GET() {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await prisma.apiKey.findMany({
    where: { organizationId: session.user.organizationId! },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      keyPrefix: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });

  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "VIEWER") {
    return NextResponse.json({ error: "Viewers cannot create API keys" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }

  const generated = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      organizationId: session.user.organizationId!,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      label: parsed.data.label || null,
    },
    select: { id: true, keyPrefix: true, label: true, createdAt: true },
  });

  // The only moment the plaintext exists outside the caller's request.
  return NextResponse.json({ ...key, plaintext: generated.plaintext }, { status: 201 });
}
