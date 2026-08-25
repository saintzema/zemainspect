import type { NextAuthOptions, Session } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import type { Adapter } from "next-auth/adapters";
import { getServerSession } from "next-auth/next";

import { prisma } from "@/lib/prisma";
import { TRIAL_DAYS, TRIAL_INSPECTIONS } from "@/lib/plans";
import type { Role } from "@/lib/generated/prisma";

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

  // Magic-link email. Requires SMTP; omitted when unconfigured so the app
  // still boots in environments that only use OAuth.
  if (process.env.EMAIL_SERVER_HOST && process.env.EMAIL_FROM) {
    providers.push(
      EmailProvider({
        server: {
          host: process.env.EMAIL_SERVER_HOST,
          port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
          auth:
            process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
              ? {
                  user: process.env.EMAIL_SERVER_USER,
                  pass: process.env.EMAIL_SERVER_PASSWORD,
                }
              : undefined,
        },
        from: process.env.EMAIL_FROM,
      }),
    );
  }

  return providers;
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
