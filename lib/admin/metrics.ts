import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/plans";
import type { PlanTier } from "@/lib/generated/prisma";

export interface PlatformMetrics {
  totalOrgs: number;
  activeSubscriptions: number;
  trialOrgs: number;
  mrrUsdCents: number;
  churnedThisMonth: number;
  trialToPaidRate: number;
}

/** MRR is summed from the tier prices of currently-ACTIVE subscriptions. */
export async function platformMetrics(): Promise<PlatformMetrics> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [totalOrgs, active, trialOrgs, churned, everPaid] = await Promise.all([
    prisma.organization.count(),
    prisma.subscription.groupBy({
      by: ["planTier"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.organization.count({ where: { planTier: "TRIAL" } }),
    prisma.subscription.count({
      where: { status: "CANCELLED", updatedAt: { gte: monthStart } },
    }),
    prisma.subscription.count({
      where: { planTier: { in: ["STARTER", "PRO", "ENTERPRISE"] } },
    }),
  ]);

  const activeSubscriptions = active.reduce((sum, row) => sum + row._count._all, 0);
  const mrrUsdCents = active.reduce(
    (sum, row) => sum + (PLANS[row.planTier].priceUsdCents ?? 0) * row._count._all,
    0,
  );

  return {
    totalOrgs,
    activeSubscriptions,
    trialOrgs,
    mrrUsdCents,
    churnedThisMonth: churned,
    trialToPaidRate: totalOrgs > 0 ? everPaid / totalOrgs : 0,
  };
}

export interface MrrPoint {
  month: string;
  activeSubscriptions: number;
  mrrUsdCents: number;
}

/**
 * MRR by month, approximated from when each subscription started billing.
 * A subscription counts toward every month from its start until it cancelled.
 */
export async function mrrOverTime(months = 12): Promise<MrrPoint[]> {
  const subs = await prisma.subscription.findMany({
    where: { planTier: { in: ["STARTER", "PRO", "ENTERPRISE"] } },
    select: {
      planTier: true,
      status: true,
      updatedAt: true,
      organization: { select: { createdAt: true } },
    },
  });

  const points: MrrPoint[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));

    let count = 0;
    let cents = 0;
    for (const sub of subs) {
      const started = sub.organization.createdAt;
      if (started >= monthEnd) continue;
      // Treat a cancellation as ending the month it was recorded.
      if (sub.status === "CANCELLED" && sub.updatedAt < monthStart) continue;
      count += 1;
      cents += PLANS[sub.planTier].priceUsdCents ?? 0;
    }

    points.push({
      month: monthStart.toISOString().slice(0, 7),
      activeSubscriptions: count,
      mrrUsdCents: cents,
    });
  }

  return points;
}

export interface DailyVolumePoint {
  day: string;
  total: number;
  failed: number;
}

export async function platformVolume(days = 30): Promise<DailyVolumePoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; total: bigint; failed: bigint }>
  >`
    SELECT date_trunc('day', "createdAt") AS day,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE "result" = 'FAIL') AS failed
      FROM "InspectionJob"
     WHERE "createdAt" >= ${since}
     GROUP BY 1
     ORDER BY 1 ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString(),
    total: Number(r.total),
    failed: Number(r.failed),
  }));
}

/** Defect-class mix across every customer — shows where the model needs work. */
export async function platformDefectMix(): Promise<Array<{ type: string; count: number }>> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
    SELECT d->>'type' AS type, COUNT(*) AS count
      FROM "InspectionJob" j
      CROSS JOIN LATERAL jsonb_array_elements(j."defects"::jsonb) AS d
     WHERE j."createdAt" >= ${since}
     GROUP BY 1
     ORDER BY count DESC
  `;
  return rows.map((r) => ({ type: r.type, count: Number(r.count) }));
}

export interface OrgRow {
  id: string;
  name: string;
  planTier: PlanTier;
  status: string;
  createdAt: string;
  lastActiveAt: string | null;
  totalInspections: number;
  manualAccessUntil: string | null;
}

export async function organizationRows(search?: string): Promise<OrgRow[]> {
  const orgs = await prisma.organization.findMany({
    where: search
      ? { name: { contains: search, mode: "insensitive" } }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      subscription: { select: { status: true } },
      users: { orderBy: { lastActiveAt: "desc" }, take: 1, select: { lastActiveAt: true } },
      _count: { select: { inspectionJobs: true } },
    },
  });

  return orgs.map((org) => ({
    id: org.id,
    name: org.name,
    planTier: org.planTier,
    status: org.subscription?.status ?? "TRIALING",
    createdAt: org.createdAt.toISOString(),
    lastActiveAt: org.users[0]?.lastActiveAt.toISOString() ?? null,
    totalInspections: org._count.inspectionJobs,
    manualAccessUntil: org.manualAccessUntil?.toISOString() ?? null,
  }));
}
