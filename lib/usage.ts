import { prisma } from "@/lib/prisma";

/**
 * Count one inspection against the org's cycle.
 *
 * Increments are done in a single atomic UPDATE so concurrent frames from the
 * same line cannot lose counts to a read-modify-write race.
 */
export async function recordInspectionUsage(
  organizationId: string,
  count = 1,
): Promise<void> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { id: true, monthlyInspectionLimit: true, inspectionsUsedThisCycle: true },
  });
  if (!sub) return;

  const overBy = Math.max(
    0,
    sub.inspectionsUsedThisCycle + count - sub.monthlyInspectionLimit,
  );

  await prisma.subscription.update({
    where: { organizationId },
    data: {
      inspectionsUsedThisCycle: { increment: count },
      ...(overBy > 0 ? { overageInspections: { increment: Math.min(count, overBy) } } : {}),
    },
  });
}

/** Reset a cycle's counters — called from the billing webhooks on renewal. */
export async function resetUsageCycle(
  organizationId: string,
  currentPeriodEnd: Date,
): Promise<void> {
  await prisma.subscription.updateMany({
    where: { organizationId },
    data: {
      inspectionsUsedThisCycle: 0,
      overageInspections: 0,
      currentPeriodEnd,
    },
  });
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  remaining: number;
  fraction: number;
  overage: number;
  periodEnd: Date | null;
}

export async function usageFor(organizationId: string): Promise<UsageSnapshot> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: {
      inspectionsUsedThisCycle: true,
      monthlyInspectionLimit: true,
      overageInspections: true,
      currentPeriodEnd: true,
    },
  });

  const used = sub?.inspectionsUsedThisCycle ?? 0;
  const limit = sub?.monthlyInspectionLimit ?? 0;

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    fraction: limit > 0 ? Math.min(1, used / limit) : 0,
    overage: sub?.overageInspections ?? 0,
    periodEnd: sub?.currentPeriodEnd ?? null,
  };
}
