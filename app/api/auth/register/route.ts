import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { provisionNewUser } from "@/lib/auth";
import { hashPassword, validatePassword } from "@/lib/password";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  name: z.string().trim().max(120).optional(),
});

/**
 * Create an account with an email and password.
 *
 * Deliberately does NOT sign the user in — the client calls signIn() with the
 * same credentials afterwards, so there is exactly one code path that issues a
 * session and one place where the password is checked.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid email and password are required." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const problem = validatePassword(parsed.data.password);
  if (problem) {
    return NextResponse.json({ error: problem.message }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (existing) {
    /*
     * An account already exists. Two cases, and neither may reveal itself:
     *
     *  - It has a password: this is someone trying to find out whether an
     *    address is registered, or a user who forgot they signed up.
     *  - It has none (Google-only): letting an anonymous caller attach a
     *    password would be full account takeover of that Google account.
     *
     * So both return the same generic message. A legitimate owner of a
     * Google-only account signs in with Google and can set a password from
     * settings, where they are already authenticated.
     */
    return NextResponse.json(
      { error: "That email cannot be registered. Try signing in instead." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name || null,
      passwordHash,
      // emailVerified stays null: we have not proven they own this address.
      // Nothing in the product is gated on it today, but leaving it honest
      // means a future verification step has something truthful to flip.
    },
    select: { id: true, email: true, name: true },
  });

  await provisionNewUser(user.id, user.email, user.name);

  return NextResponse.json({ ok: true }, { status: 201 });
}
