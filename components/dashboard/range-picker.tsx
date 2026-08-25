"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassButton, GlassSelect } from "@/components/ui/glass";

/** Filters sit in one row above the charts, per the dashboard interaction spec. */
export function RangePicker({ range, bucket }: { range: string; bucket: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <GlassSelect
        aria-label={t("trends.range")}
        value={range}
        onChange={(event) => update("range", event.target.value)}
        className="w-auto"
      >
        <option value="7">{t("trends.last7")}</option>
        <option value="30">{t("trends.last30")}</option>
        <option value="90">{t("trends.last90")}</option>
      </GlassSelect>

      <GlassSelect
        aria-label={t("trends.byDay")}
        value={bucket}
        onChange={(event) => update("bucket", event.target.value)}
        className="w-auto"
      >
        <option value="day">{t("trends.byDay")}</option>
        <option value="week">{t("trends.byWeek")}</option>
        <option value="month">{t("trends.byMonth")}</option>
      </GlassSelect>

      <a href="/api/inspections?format=csv" download>
        <GlassButton size="sm" variant="secondary">
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t("common.export")}
        </GlassButton>
      </a>
    </div>
  );
}
