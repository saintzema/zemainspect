"use client";

import Link from "next/link";
import { Clock, Gift, TriangleAlert } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassButton, GlassPanel } from "@/components/ui/glass";
import type { PlanTier } from "@/lib/generated/prisma";

export function TrialBanner({
  tier,
  trialEndsAt,
  manualAccessUntil,
  manualPlanTier,
  remaining,
}: {
  tier: PlanTier;
  trialEndsAt: Date | null;
  manualAccessUntil: Date | null;
  manualPlanTier: PlanTier | null;
  remaining: number;
}) {
  const { t, language } = useTranslation();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  // A hand-granted pilot takes precedence — that org is not "on trial".
  if (manualAccessUntil && manualAccessUntil.getTime() > Date.now()) {
    return (
      <GlassPanel className="flex items-center gap-3 p-4">
        <Gift className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <p className="text-sm text-ink">
          {t("billing.manualAccess", {
            tier: t(`pricing.tier${manualPlanTier ?? "PRO"}`),
            date: manualAccessUntil.toLocaleDateString(locale),
          })}
        </p>
      </GlassPanel>
    );
  }

  if (tier !== "TRIAL" || !trialEndsAt) return null;

  const expired = trialEndsAt.getTime() < Date.now();

  return (
    <GlassPanel className="flex flex-wrap items-center gap-3 p-4">
      {expired ? (
        <TriangleAlert className="h-5 w-5 shrink-0 text-fail" aria-hidden />
      ) : (
        <Clock className="h-5 w-5 shrink-0 text-warn" aria-hidden />
      )}
      <p className="flex-1 text-sm text-ink">
        {expired
          ? t("dashboard.trialExpired")
          : t("dashboard.trialBanner", {
              date: trialEndsAt.toLocaleDateString(locale),
              count: remaining.toLocaleString(),
            })}
      </p>
      <Link href="/billing">
        <GlassButton size="sm">{t("dashboard.upgradeCta")}</GlassButton>
      </Link>
    </GlassPanel>
  );
}
