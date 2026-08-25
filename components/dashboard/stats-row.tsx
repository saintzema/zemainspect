"use client";

import { useTranslation } from "@/lib/i18n/language-context";
import { StatTile } from "@/components/ui/glass";
import { formatPercent } from "@/lib/utils";
import type { SummaryStats } from "@/lib/analytics";

export function StatsRow({ stats }: { stats: SummaryStats }) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t("dashboard.inspections")}
        value={stats.total.toLocaleString()}
        sublabel={t("dashboard.last24h")}
      />
      <StatTile
        label={t("dashboard.passRate")}
        value={stats.total ? formatPercent(stats.passed / stats.total) : "—"}
        tone="pass"
      />
      <StatTile
        label={t("dashboard.defectRate")}
        value={stats.total ? formatPercent(stats.defectRate) : "—"}
        tone={stats.defectRate > 0.05 ? "fail" : undefined}
      />
      <StatTile
        label={t("dashboard.avgLatency")}
        value={stats.avgLatencyMs ? `${stats.avgLatencyMs} ms` : "—"}
      />
    </div>
  );
}

export function PageHeading({
  titleKey,
  subtitleKey,
  action,
}: {
  titleKey: string;
  subtitleKey?: string;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t(titleKey)}</h1>
        {subtitleKey && <p className="mt-0.5 text-sm text-ink-muted">{t(subtitleKey)}</p>}
      </div>
      {action}
    </div>
  );
}
