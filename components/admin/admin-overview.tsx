"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTranslation } from "@/lib/i18n/language-context";
import { EmptyState, GlassCard, StatTile } from "@/components/ui/glass";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type {
  DailyVolumePoint,
  MrrPoint,
  PlatformMetrics,
} from "@/lib/admin/metrics";

const AXIS_TICK = { fontSize: 12 };

function Card({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-xl border border-white/40 bg-white/90 px-3 py-2 text-xs shadow-glass backdrop-blur-glass dark:border-white/15 dark:bg-black/85">
      {rows.map((row) => (
        <p key={row.label} className="flex gap-3 text-ink">
          <span className="text-ink-muted">{row.label}</span>
          <span className="ml-auto font-medium tabular-nums">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

export function AdminOverview({
  metrics,
  mrr,
  volume,
}: {
  metrics: PlatformMetrics;
  mrr: MrrPoint[];
  volume: DailyVolumePoint[];
}) {
  const { t, language } = useTranslation();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  const mrrData = mrr.map((p) => ({ ...p, usd: p.mrrUsdCents / 100 }));
  const volumeData = volume.map((p) => ({
    ...p,
    label: new Date(p.day).toLocaleDateString(locale, { month: "short", day: "numeric" }),
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label={t("admin.totalOrgs")} value={metrics.totalOrgs.toLocaleString()} />
        <StatTile
          label={t("admin.activeSubs")}
          value={metrics.activeSubscriptions.toLocaleString()}
        />
        <StatTile label={t("admin.mrr")} value={formatCurrency(metrics.mrrUsdCents)} />
        <StatTile
          label={t("admin.churn")}
          value={metrics.churnedThisMonth.toLocaleString()}
          tone={metrics.churnedThisMonth > 0 ? "warn" : undefined}
        />
        <StatTile
          label={t("admin.conversion")}
          value={formatPercent(metrics.trialToPaidRate)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title={t("admin.mrrGrowth")} flush>
          {mrrData.length === 0 ? (
            <EmptyState title={t("common.empty")} />
          ) : (
            <div className="h-60 w-full px-2 pb-3 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mrrData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={20}
                  />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} />
                  <Tooltip
                    cursor={{ stroke: "var(--grid-line)", strokeWidth: 1 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as (typeof mrrData)[number];
                      return (
                        <Card
                          rows={[
                            { label: t("admin.mrr"), value: formatCurrency(point.mrrUsdCents) },
                            {
                              label: t("admin.activeSubs"),
                              value: String(point.activeSubscriptions),
                            },
                          ]}
                        />
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="usd"
                    stroke="var(--series-1)"
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 0, fill: "var(--series-1)" }}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>

        <GlassCard title={t("admin.inspectionsPerDay")} flush>
          {volumeData.length === 0 ? (
            <EmptyState title={t("common.empty")} />
          ) : (
            <div className="h-60 w-full px-2 pb-3 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    cursor={{ fill: "var(--grid-line)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as (typeof volumeData)[number];
                      return (
                        <Card
                          rows={[
                            { label: t("dashboard.when"), value: point.label },
                            {
                              label: t("dashboard.inspections"),
                              value: point.total.toLocaleString(),
                            },
                            {
                              label: t("dashboard.fail"),
                              value: point.failed.toLocaleString(),
                            },
                          ]}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="total" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>
      </div>
    </>
  );
}
