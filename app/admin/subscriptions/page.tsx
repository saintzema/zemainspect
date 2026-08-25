import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/plans";
import { formatCurrency } from "@/lib/utils";
import { PageHeading } from "@/components/dashboard/stats-row";
import { GlassCard, Badge, EmptyState } from "@/components/ui/glass";

export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const subscriptions = await prisma.subscription.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { organization: { select: { name: true } } },
  });

  const byTier = subscriptions
    .filter((s) => s.status === "ACTIVE")
    .reduce<Record<string, { count: number; cents: number }>>((acc, s) => {
      const entry = acc[s.planTier] ?? { count: 0, cents: 0 };
      entry.count += 1;
      entry.cents += PLANS[s.planTier].priceUsdCents ?? 0;
      acc[s.planTier] = entry;
      return acc;
    }, {});

  return (
    <div className="space-y-5">
      <PageHeading titleKey="admin.subscriptions" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(byTier).map(([tier, entry]) => (
          <GlassCard key={tier} title={tier}>
            <p className="text-2xl font-semibold tabular-nums text-ink">
              {formatCurrency(entry.cents)}
            </p>
            <p className="text-xs text-ink-muted">{entry.count} active</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard flush>
        {subscriptions.length === 0 ? (
          <EmptyState title="No subscriptions yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-white/25 text-left text-xs uppercase tracking-wide text-ink-muted dark:border-white/10">
                  <th className="px-5 py-2.5 font-medium">Organization</th>
                  <th className="px-5 py-2.5 font-medium">Provider</th>
                  <th className="px-5 py-2.5 font-medium">Tier</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Used / limit</th>
                  <th className="px-5 py-2.5 font-medium">Period end</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-white/15 dark:border-white/5">
                    <td className="px-5 py-2.5 font-medium text-ink">
                      {sub.organization.name}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">{sub.provider}</td>
                    <td className="px-5 py-2.5 text-ink-muted">{sub.planTier}</td>
                    <td className="px-5 py-2.5">
                      <Badge
                        tone={
                          sub.status === "ACTIVE"
                            ? "pass"
                            : sub.status === "PAST_DUE"
                              ? "fail"
                              : "neutral"
                        }
                      >
                        {sub.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink">
                      {sub.inspectionsUsedThisCycle.toLocaleString()} /{" "}
                      {sub.monthlyInspectionLimit.toLocaleString()}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {sub.currentPeriodEnd.toISOString().slice(0, 10)}
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
