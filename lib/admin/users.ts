import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/generated/prisma";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  organizationId: string | null;
  organizationName: string | null;
  /** Whether the account can sign in with a password at all (vs Google only). */
  hasPassword: boolean;
  disabledAt: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface AdminOrgOption {
  id: string;
  name: string;
}

/**
 * Every account that can sign in, newest first.
 *
 * `passwordHash` is selected only to derive the boolean — the hash itself
 * never leaves this function, so it cannot end up serialised into the page.
 */
export async function userRows(search?: string): Promise<AdminUserRow[]> {
  const term = search?.trim();

  const users = await prisma.user.findMany({
    where: term
      ? {
          OR: [
            { email: { contains: term, mode: "insensitive" } },
            { name: { contains: term, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
      disabledAt: true,
      createdAt: true,
      lastActiveAt: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
    hasPassword: user.passwordHash !== null,
    disabledAt: user.disabledAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
  }));
}

/** Organizations an admin can drop a new user into. */
export async function organizationOptions(): Promise<AdminOrgOption[]> {
  return prisma.organization.findMany({
    orderBy: { name: "asc" },
    take: 500,
    select: { id: true, name: true },
  });
}
