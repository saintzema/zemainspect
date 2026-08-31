import type { NextAuthOptions, Session } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import type { Adapter } from "next-auth/adapters";
import { getServerSession } from "next-auth/next";

import { randomInt } from "crypto";

import { prisma } from "@/lib/prisma";
import { TRIAL_DAYS, TRIAL_INSPECTIONS } from "@/lib/plans";
import type { Role } from "@/lib/generated/prisma";
import { verifyPassword } from "@/lib/password";
import { env, envOr, hasEnv } from "@/lib/env";
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

  /*
   * Email + password — the primary way factory staff sign in.
   *
   * Chosen over a one-time code as the default because it does not depend on
   * email reaching the user at all. Deliverability to Chinese corporate hosts
   * is genuinely unreliable, and a QC lead who cannot receive mail on the shop
   * floor still needs to get into the dashboard at the start of a shift.
   */
  providers.push(
    CredentialsProvider({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
            disabledAt: true,
          },
        });

        // verifyPassword runs a real bcrypt comparison even when there is no
        // hash, so a missing account, an OAuth-only account and a wrong
        // password all take the same time and return the same answer. Never
        // tell the caller which of the three it was.
        const valid = await verifyPassword(password, user?.passwordHash);
        if (!user || !valid) return null;

        // A disabled account is refused after the password check, so
        // "disabled" is not observable without valid credentials.
        if (user.disabledAt) return null;

        await prisma.user
          .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
          .catch(() => undefined);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  );

  const googleId = env("GOOGLE_CLIENT_ID");
  const googleSecret = env("GOOGLE_CLIENT_SECRET");
  if (googleId && googleSecret) {
    providers.push(GoogleProvider({ clientId: googleId, clientSecret: googleSecret }));
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
  if (hasEnv("EMAIL_SERVER_HOST") && hasEnv("EMAIL_FROM")) {
    providers.push(
      EmailProvider({
        server: {
          host: env("EMAIL_SERVER_HOST"),
          port: Number(envOr("EMAIL_SERVER_PORT", "587")),
          // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
          secure: Number(envOr("EMAIL_SERVER_PORT", "587")) === 465,
          auth:
            hasEnv("EMAIL_SERVER_USER") && hasEnv("EMAIL_SERVER_PASSWORD")
              ? {
                  user: env("EMAIL_SERVER_USER"),
                  pass: env("EMAIL_SERVER_PASSWORD"),
                }
              : undefined,
        },
        from: env("EMAIL_FROM"),

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
  return hasEnv("EMAIL_SERVER_HOST") && hasEnv("EMAIL_FROM");
}

/** True when Google sign-in is actually available on this deployment. */
export function googleSignInEnabled(): boolean {
  return hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET");
}

/**
 * Give a brand-new user their own organization on a 14-day trial, and make the
 * configured founder address a SUPER_ADMIN.
 */
export async function provisionNewUser(userId: string, email: string, name?: string | null) {
  const adminEmail = env("ADMIN_EMAIL");
  const isFounder = !!adminEmail && email.toLowerCase() === adminEmail.toLowerCase();

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
  /*
   * JWT rather than database sessions: NextAuth's Credentials provider does
   * not support database sessions at all. The adapter still persists users and
   * OAuth accounts — only the session itself moves into a signed cookie.
   *
   * Role and organization are deliberately NOT trusted from the token. They
   * are re-read from the database on every session lookup (see the session
   * callback), so an admin disabling an account or changing a role takes
   * effect immediately instead of waiting for a stale token to expire.
   */
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
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
    /**
     * Carry only the user id in the token. Everything authorisation depends on
     * is re-read from the database in `session` below.
     */
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },

    /**
     * Resolve the session from the database on every lookup.
     *
     * Role, organization and disabled state are deliberately not read from the
     * JWT. A signed token is tamper-proof but it is a *snapshot*: if an admin
     * demotes someone or disables an account, a token-derived session would
     * keep the old privileges until it expired. Paying one indexed primary-key
     * lookup per request buys immediate revocation, which is the behaviour an
     * admin reasonably expects from a "disable user" button.
     *
     * Returning a session with no user id makes every `requireOrgSession` /
     * `requireSuperAdmin` guard fail closed.
     */
    async session({ session, token }) {
      const userId = token.sub;
      if (!userId) return session;

      const record = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          organizationId: true,
          preferredLanguage: true,
          disabledAt: true,
        },
      });

      // Deleted or disabled since the token was issued: hand back a session
      // with no identity rather than a privileged one.
      if (!record || record.disabledAt) {
        return { ...session, user: undefined } as unknown as Session;
      }

      session.user = {
        ...session.user,
        id: record.id,
        email: record.email,
        name: record.name,
        image: record.image,
        role: record.role,
        organizationId: record.organizationId,
        preferredLanguage: record.preferredLanguage,
      };
      return session;
    },
  },
  secret: env("NEXTAUTH_SECRET"),
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
