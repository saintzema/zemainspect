import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({ language: z.enum(["en", "zh"]) });

/** Persist the language choice so it follows the user to their next device. */
export async function POST(request: Request) {
  const session = await auth();
  // Signed-out visitors keep their choice in localStorage only.
  if (!session?.user?.id) return new NextResponse(null, { status: 204 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { language: 'en' | 'zh' }" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { preferredLanguage: parsed.data.language },
  });

  return NextResponse.json({ ok: true });
}
