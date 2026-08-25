import { prisma } from "@/lib/prisma";
import { PageHeading } from "@/components/dashboard/stats-row";
import { Badge, EmptyState, GlassCard } from "@/components/ui/glass";

export const dynamic = "force-dynamic";

export default async function AdminReferralsPage() {
  const credits = await prisma.referralCredit.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Resolve both sides in one round trip rather than N per row.
  const orgIds = Array.from(
    new Set(credits.flatMap((c) => [c.referrerOrgId, c.referredOrgId])),
  );
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true, referralCode: true },
  });
  const nameOf = new Map(orgs.map((o) => [o.id, o]));

  return (
    <div className="space-y-5">
      <PageHeading titleKey="admin.referrals" />

      <GlassCard flush>
        {credits.length === 0 ? (
          <EmptyState title="No referral credits yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/25 text-left text-xs uppercase tracking-wide text-ink-muted dark:border-white/10">
                  <th className="px-5 py-2.5 font-medium">Referrer</th>
                  <th className="px-5 py-2.5 font-medium">Code</th>
                  <th className="px-5 py-2.5 font-medium">Referred</th>
                  <th className="px-5 py-2.5 text-right font-medium">Months</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {credits.map((credit) => (
                  <tr key={credit.id} className="border-b border-white/15 dark:border-white/5">
                    <td className="px-5 py-2.5 font-medium text-ink">
                      {nameOf.get(credit.referrerOrgId)?.name ?? credit.referrerOrgId}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-ink-muted">
                      {nameOf.get(credit.referrerOrgId)?.referralCode.slice(0, 12) ?? "—"}
                    </td>
                    <td className="px-5 py-2.5 text-ink">
                      {nameOf.get(credit.referredOrgId)?.name ?? credit.referredOrgId}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink">
                      {credit.creditMonths}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={credit.status === "applied" ? "pass" : "warn"}>
                        {credit.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {credit.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
