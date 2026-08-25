"use client";

import { useState } from "react";
import { FileDown, Lock } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  FieldLabel,
  GlassButton,
  GlassCard,
  GlassInput,
  StatTile,
} from "@/components/ui/glass";
import { formatPercent } from "@/lib/utils";
import type { SummaryStats } from "@/lib/analytics";

export function ReportBuilder({
  allowed,
  defaultFrom,
  defaultTo,
  stats,
  capability,
}: {
  allowed: boolean;
  defaultFrom: string;
  defaultTo: string;
  stats: SummaryStats;
  defectClasses: number;
  capability: number | null;
}) {
  const { t, language } = useTranslation();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const href = `/api/reports?from=${from}&to=${to}&lang=${language}`;

  return (
    <div className="space-y-4">
      <GlassCard title={t("reports.summaryTitle")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("reports.totalInspections")}
            value={stats.total.toLocaleString()}
          />
          <StatTile
            label={t("reports.totalDefects")}
            value={stats.failed.toLocaleString()}
          />
          <StatTile
            label={t("reports.defectRate")}
            value={stats.total ? formatPercent(stats.defectRate, 2) : "—"}
          />
          <StatTile
            label={t("reports.processCapability")}
            value={capability === null ? "—" : capability.toFixed(2)}
          />
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t("reports.cpkNote")}</p>
      </GlassCard>

      <GlassCard title={t("reports.generate")}>
        {!allowed ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Lock className="h-4 w-4 shrink-0" aria-hidden />
            {t("reports.proOnly")}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <FieldLabel htmlFor="report-from">{t("reports.from")}</FieldLabel>
              <GlassInput
                id="report-from"
                type="date"
                value={from}
                max={to}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="report-to">{t("reports.to")}</FieldLabel>
              <GlassInput
                id="report-to"
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <a href={href} download>
              <GlassButton>
                <FileDown className="h-4 w-4" aria-hidden />
                {t("reports.generate")}
              </GlassButton>
            </a>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
