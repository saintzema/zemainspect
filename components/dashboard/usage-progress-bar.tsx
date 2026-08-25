"use client";

import Link from "next/link";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassButton, GlassPanel } from "@/components/ui/glass";
import { cn } from "@/lib/utils";
import type { UsageSnapshot } from "@/lib/usage";

export function UsageProgressBar({
  usage,
  showUpgrade,
}: {
  usage: UsageSnapshot;
  showUpgrade: boolean;
}) {
  const { t, language } = useTranslation();
  const percent = Math.round(usage.fraction * 100);
  const over = usage.used > usage.limit;

  const barTone = over
    ? "bg-fail"
    : usage.fraction > 0.85
      ? "bg-warn"
      : "bg-accent";

  return (
    <GlassPanel className="animate-fade-up p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {t("dashboard.usageTitle")}
        </p>
        {showUpgrade && (
          <Link href="/billing">
            <GlassButton size="sm" variant="secondary">
              {t("dashboard.upgradeCta")}
            </GlassButton>
          </Link>
        )}
      </div>

      <p className="mt-1.5 text-sm text-ink">
        {t("dashboard.usageOf", {
          used: usage.used.toLocaleString(),
          limit: usage.limit.toLocaleString(),
        })}
      </p>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/40 dark:bg-white/10"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("dashboard.usageTitle")}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", barTone)}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      {usage.periodEnd && (
        <p className="mt-1.5 text-xs text-ink-muted">
          {t("dashboard.usageResets", {
            date: usage.periodEnd.toLocaleDateString(language === "zh" ? "zh-CN" : "en-GB"),
          })}
        </p>
      )}

      {over && (
        <p className="mt-1.5 text-xs font-medium text-warn">
          {t("dashboard.overageWarning", { price: "$0.01" })}
        </p>
      )}
    </GlassPanel>
  );
}
