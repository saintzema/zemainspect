"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Table2, TrendingUp } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { Badge, EmptyState, GlassButton, GlassCard } from "@/components/ui/glass";
import { colorForDefect } from "@/lib/chart-palette";
import { labelFor, reliabilityOf } from "@/lib/inference/labels";
import { formatPercent } from "@/lib/utils";
import type { DefectCount, TrendPoint } from "@/lib/analytics";

const AXIS_TICK = { fontSize: 12 };

function TooltipCard({ rows }: { rows: Array<{ label: string; value: string }> }) {
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

/**
 * Defect rate over time — one measure, one series, so no legend box: the card
 * title names it. A crosshair tooltip carries the exact values.
 */
export function DefectRateChart({
  points,
  locale,
}: {
  points: TrendPoint[];
  locale: string;
}) {
  const { t } = useTranslation();

  const data = points.map((p) => ({
    ...p,
    label: new Date(p.bucket).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    }),
    ratePercent: p.defectRate * 100,
  }));

  return (
    <GlassCard title={t("trends.defectRateOverTime")} flush>
      {data.length === 0 ? (
        <EmptyState icon={<TrendingUp className="h-6 w-6" />} title={t("common.empty")} />
      ) : (
        <div className="h-64 w-full px-2 pb-3 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={44}
                unit="%"
              />
              <Tooltip
                cursor={{ stroke: "var(--grid-line)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as (typeof data)[number];
                  return (
                    <TooltipCard
                      rows={[
                        { label: t("dashboard.when"), value: point.label },
                        {
                          label: t("dashboard.defectRate"),
                          value: formatPercent(point.defectRate),
                        },
                        {
                          label: t("dashboard.inspections"),
                          value: point.total.toLocaleString(),
                        },
                      ]}
                    />
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="ratePercent"
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
  );
}

/**
 * Defects by class.
 *
 * Horizontal bars, since the class names are long and read better as labels
 * than as rotated ticks. Every bar is directly labelled with its count and a
 * table view is one click away — the relief the light-mode contrast warning
 * requires, and what makes the chart usable for a colourblind QC lead.
 */
export function DefectsByTypeChart({ counts }: { counts: DefectCount[] }) {
  const { t, language } = useTranslation();
  const [asTable, setAsTable] = useState(false);

  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const data = counts.map((c) => ({
    ...c,
    label: labelFor(c.type, language),
    reliability: reliabilityOf(c.type),
  }));

  return (
    <GlassCard
      title={t("trends.byType")}
      action={
        <GlassButton
          size="sm"
          variant="ghost"
          onClick={() => setAsTable((value) => !value)}
          aria-pressed={asTable}
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          {asTable ? t("trends.byType") : t("common.all")}
        </GlassButton>
      }
      flush
    >
      {data.length === 0 ? (
        <EmptyState title={t("common.empty")} />
      ) : asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/25 text-left text-xs uppercase tracking-wide text-ink-muted dark:border-white/10">
                <th className="px-5 py-2 font-medium">{t("trends.byType")}</th>
                <th className="px-5 py-2 text-right font-medium">#</th>
                <th className="px-5 py-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.type} className="border-b border-white/15 dark:border-white/5">
                  <td className="flex items-center gap-2 px-5 py-2 text-ink">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: colorForDefect(row.type) }}
                      aria-hidden
                    />
                    {row.label}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink">
                    {row.count.toLocaleString()}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink-muted">
                    {total ? formatPercent(row.count / total) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="w-full px-2 pt-4" style={{ height: Math.max(180, data.length * 44) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
                barCategoryGap={6}
              >
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={112}
                />
                <Tooltip
                  cursor={{ fill: "var(--grid-line)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as (typeof data)[number];
                    return (
                      <TooltipCard
                        rows={[
                          { label: row.label, value: row.count.toLocaleString() },
                          {
                            label: "%",
                            value: total ? formatPercent(row.count / total) : "—",
                          },
                        ]}
                      />
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  label={{
                    position: "right",
                    fill: "rgb(var(--ink))",
                    fontSize: 12,
                  }}
                >
                  {data.map((row) => (
                    <Cell key={row.type} fill={colorForDefect(row.type)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* The model is materially weaker on two classes; say so next to the
              numbers rather than letting an operator over-trust them. */}
          <div className="flex flex-wrap gap-1.5 px-5 pb-4 pt-2">
            {data
              .filter((row) => row.reliability === "low")
              .map((row) => (
                <Badge key={row.type} tone="warn">
                  {row.label}: {t("trends.reliabilityLow")}
                </Badge>
              ))}
          </div>
        </>
      )}
    </GlassCard>
  );
}

/** Inspection volume per bucket — magnitude over time, so bars not a line. */
export function VolumeChart({
  points,
  locale,
}: {
  points: TrendPoint[];
  locale: string;
}) {
  const { t } = useTranslation();

  const data = points.map((p) => ({
    ...p,
    label: new Date(p.bucket).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <GlassCard title={t("trends.volume")} flush>
      {data.length === 0 ? (
        <EmptyState title={t("common.empty")} />
      ) : (
        <div className="h-56 w-full px-2 pb-3 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
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
                  const point = payload[0].payload as (typeof data)[number];
                  return (
                    <TooltipCard
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
  );
}
