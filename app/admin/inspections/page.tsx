import { prisma } from "@/lib/prisma";
import { platformDefectMix, platformVolume } from "@/lib/admin/metrics";
import { CLASS_MAP50, type NeuClass } from "@/lib/inference/labels";
import { PageHeading } from "@/components/dashboard/stats-row";
import { GlassCard, Badge, EmptyState } from "@/components/ui/glass";
import { formatPercent } from "@/lib/utils";
import { colorForDefect } from "@/lib/chart-palette";

export const dynamic = "force-dynamic";

/**
 * Model-performance monitor.
 *
 * Two questions this answers: which defect classes dominate real customer
 * traffic (so retraining effort goes where it pays), and which organizations
 * are seeing unusually slow inference (an operational health signal).
 */
export default async function AdminInspectionsPage() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [mix, volume, slowOrgs] = await Promise.all([
    platformDefectMix(),
    platformVolume(30),
    prisma.$queryRaw<
      Array<{ name: string; jobs: bigint; avgms: number; maxms: number }>
    >`
      SELECT o."name" AS name,
             COUNT(*) AS jobs,
             AVG(j."processingTimeMs")::float AS avgms,
             MAX(j."processingTimeMs") AS maxms
        FROM "InspectionJob" j
        JOIN "Organization" o ON o."id" = j."organizationId"
       WHERE j."createdAt" >= ${since}
       GROUP BY o."name"
      HAVING AVG(j."processingTimeMs") > 1000
       ORDER BY avgms DESC
       LIMIT 20
    `,
  ]);

  const totalDefects = mix.reduce((sum, m) => sum + m.count, 0);
  const totalVolume = volume.reduce((sum, v) => sum + v.total, 0);

  return (
    <div className="space-y-5">
      <PageHeading titleKey="admin.inspections" />

      <GlassCard
        title="Platform volume"
        description={`${totalVolume.toLocaleString()} inspections in the last 30 days`}
      />

      <GlassCard title="Defect classes across all customers" flush>
        {mix.length === 0 ? (
          <EmptyState title="No defects recorded yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/25 text-left text-xs uppercase tracking-wide text-ink-muted dark:border-white/10">
                  <th className="px-5 py-2.5 font-medium">Class</th>
                  <th className="px-5 py-2.5 text-right font-medium">Detections</th>
                  <th className="px-5 py-2.5 text-right font-medium">Share</th>
                  <th className="px-5 py-2.5 text-right font-medium">Val mAP@0.5</th>
                </tr>
              </thead>
              <tbody>
                {mix.map((row) => {
                  const map50 = CLASS_MAP50[row.type as NeuClass];
                  return (
                    <tr key={row.type} className="border-b border-white/15 dark:border-white/5">
                      <td className="flex items-center gap-2 px-5 py-2.5 text-ink">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: colorForDefect(row.type) }}
                          aria-hidden
                        />
                        {row.type}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-ink">
                        {row.count.toLocaleString()}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-ink-muted">
                        {totalDefects ? formatPercent(row.count / totalDefects) : "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {map50 === undefined ? (
                          "—"
                        ) : (
                          <Badge tone={map50 < 0.6 ? "warn" : map50 >= 0.84 ? "pass" : "neutral"}>
                            {formatPercent(map50)}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <GlassCard
        title="Organizations with slow inference"
        description="Average over 1000 ms in the last 7 days"
        flush
      >
        {slowOrgs.length === 0 ? (
          <EmptyState title="All organizations healthy" />
        ) : (
          <ul className="divide-y divide-white/25 dark:divide-white/10">
            {slowOrgs.map((org) => (
              <li key={org.name} className="flex items-center gap-3 px-5 py-3">
                <span className="flex-1 text-sm font-medium text-ink">{org.name}</span>
                <span className="text-sm tabular-nums text-warn">
                  {Math.round(org.avgms)} ms avg
                </span>
                <span className="text-xs tabular-nums text-ink-muted">
                  max {org.maxms} ms · {Number(org.jobs).toLocaleString()} jobs
                </span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
