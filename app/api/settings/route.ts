import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWebhookSecret } from "@/lib/webhooks";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  webhookUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
  notificationThreshold: z.number().min(0).max(1).nullable().optional(),
  notifyEmail: z.union([z.string().trim().email(), z.literal("")]).optional(),
  regenerateSecret: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "VIEWER") {
    return NextResponse.json({ error: "Viewers cannot change settings" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const existing = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId! },
    select: { webhookSecret: true },
  });

  // Setting a webhook URL for the first time mints a signing secret, so a
  // customer can never end up with an unsigned endpoint.
  const needsSecret =
    body.regenerateSecret || (body.webhookUrl && !existing.webhookSecret);

  const organization = await prisma.organization.update({
    where: { id: session.user.organizationId! },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.webhookUrl !== undefined
        ? { webhookUrl: body.webhookUrl === "" ? null : body.webhookUrl }
        : {}),
      ...(body.notificationThreshold !== undefined
        ? { notificationThreshold: body.notificationThreshold }
        : {}),
      ...(body.notifyEmail !== undefined
        ? { notifyEmail: body.notifyEmail === "" ? null : body.notifyEmail }
        : {}),
      ...(needsSecret ? { webhookSecret: generateWebhookSecret() } : {}),
    },
    select: {
      name: true,
      webhookUrl: true,
      webhookSecret: true,
      notificationThreshold: true,
      notifyEmail: true,
    },
  });

  return NextResponse.json({ organization });
}
