import type { NextAuthOptions, Session } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import type { Adapter } from "next-auth/adapters";
import { getServerSession } from "next-auth/next";

import { randomInt } from "crypto";

import { prisma } from "@/lib/prisma";
import { TRIAL_DAYS, TRIAL_INSPECTIONS } from "@/lib/plans";
import type { Role } from "@/lib/generated/prisma";
import {
  OTP_LENGTH,
  OTP_TTL_MINUTES,
  otpHtml,
  otpSubject,
  otpText,
} from "@/lib/email/otp-template";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      organizationId: string | null;
      preferredLanguage: string;
    };
  }
}

function buildProviders() {
  const providers: NextAuthOptions["providers"] = [];

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    );
  }

  /*
   * Email sign-in, delivered as a one-time CODE rather than a magic link.
   *
   * A link is the NextAuth default, but it fails the actual usage pattern
   * here: an operator reads mail on a phone and works on a shared shop-floor
   * terminal, so a link opens the session on the wrong device. A code can be
   * carried across devices by hand. Corporate mail scanners that pre-fetch
   * URLs also silently consume single-use magic links before the human
   * clicks, which a code is immune to.
   *
   * Mechanically this is still NextAuth's email flow — the code IS the
   * verification token, so it is hashed with NEXTAUTH_SECRET at rest and
   * consumed exactly once by the standard callback. Only its shape and
   * delivery change.
   *
   * Omitted entirely when SMTP is unconfigured, so the app still boots on
   * OAuth alone rather than presenting a form that silently does nothing.
   */
  if (process.env.EMAIL_SERVER_HOST && process.env.EMAIL_FROM) {
    providers.push(
      EmailProvider({
        server: {
          host: process.env.EMAIL_SERVER_HOST,
          port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
          // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
          secure: Number(process.env.EMAIL_SERVER_PORT ?? 587) === 465,
          auth:
            process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
              ? {
                  user: process.env.EMAIL_SERVER_USER,
                  pass: process.env.EMAIL_SERVER_PASSWORD,
                }
              : undefined,
        },
        from: process.env.EMAIL_FROM,

        // Short-lived because the code is short. A 24-hour default (NextAuth's)
        // would leave a 6-digit secret guessable for a whole day.
        maxAge: OTP_TTL_MINUTES * 60,

        // randomInt is the CSPRNG-backed generator; Math.random must never be
        // used for a credential.
        generateVerificationToken() {
          const max = 10 ** OTP_LENGTH;
          return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
        },

        async sendVerificationRequest({ identifier, token, provider }) {
          const nodemailer = await import("nodemailer");
          const transport = nodemailer.createTransport(provider.server);
          const result = await transport.sendMail({
            to: identifier,
            from: provider.from,
            subject: otpSubject(token),
            text: otpText(token),
            html: otpHtml(token),
          });

          const rejected = result.rejected ?? [];
          if (rejected.length) {
            throw new Error(`Email rejected for: ${rejected.join(", ")}`);
          }
        },
      }),
    );
  }

  return providers;
}

/** True when email sign-in is actually available on this deployment. */
export function emailSignInEnabled(): boolean {
  return !!(process.env.EMAIL_SERVER_HOST && process.env.EMAIL_FROM);
}

/** True when Google sign-in is actually available on this deployment. */
export function googleSignInEnabled(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Give a brand-new user their own organization on a 14-day trial, and make the
 * configured founder address a SUPER_ADMIN.
 */
async function provisionNewUser(userId: string, email: string, name?: string | null) {
  const isFounder =
    !!process.env.ADMIN_EMAIL &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

  const orgName = name?.trim() || email.split("@")[0] || "My factory";
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      planTier: "TRIAL",
      trialEndsAt,
      subscription: {
        create: {
          status: "TRIALING",
          planTier: "TRIAL",
          currentPeriodEnd: trialEndsAt,
          monthlyInspectionLimit: TRIAL_INSPECTIONS,
        },
      },
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      organizationId: org.id,
      role: isFounder ? "SUPER_ADMIN" : "OWNER",
    },
  });
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: buildProviders(),
  session: { strategy: "database" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
    // Send failures back to the sign-in page rather than NextAuth's own error
    // screen, so a wrong or expired code shows a readable message next to the
    // input the user is already looking at — and in their chosen language.
    error: "/signin",
  },
  events: {
    async createUser({ user }) {
      if (!user.email) return;
      await provisionNewUser(user.id, user.email, user.name);
    },
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.user
        .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
        .catch(() => undefined);
    },
  },
  callbacks: {
    async session({ session, user }) {
      const record = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          role: true,
          organizationId: true,
          preferredLanguage: true,
        },
      });
      if (record) {
        session.user = {
          ...session.user,
          id: record.id,
          email: record.email,
          role: record.role,
          organizationId: record.organizationId,
          preferredLanguage: record.preferredLanguage,
        };
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export function auth(): Promise<Session | null> {
  return getServerSession(authOptions);
}

/** Session guaranteed to have an organization, or null. */
export async function requireOrgSession() {
  const session = await auth();
  if (!session?.user?.organizationId) return null;
  return session;
}

export async function requireSuperAdmin() {
  const session = await auth();
  if (session?.user?.role !== "SUPER_ADMIN") return null;
  return session;
}
