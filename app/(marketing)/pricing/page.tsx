"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Minus } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassButton, GlassPanel, Badge } from "@/components/ui/glass";
import { PLANS, PLAN_ORDER } from "@/lib/plans";
import { cn } from "@/lib/utils";
import type { PlanTier } from "@/lib/generated/prisma";

type Currency = "USD" | "CNY" | "NGN";

/**
 * NGN is shown as an approximate conversion for orientation only — the amount
 * actually charged comes from the Paystack plan, which is the source of truth.
 */
const NGN_PER_USD = 1600;

function priceLabel(tier: PlanTier, currency: Currency): string | null {
  const plan = PLANS[tier];
  if (plan.priceUsdCents === null) return null;
  if (plan.priceUsdCents === 0) return "0";

  if (currency === "CNY" && plan.priceCnyFen !== null) {
    return `¥${(plan.priceCnyFen / 100).toLocaleString()}`;
  }
  if (currency === "NGN") {
    const naira = Math.round((plan.priceUsdCents / 100) * NGN_PER_USD);
    return `₦${naira.toLocaleString()}`;
  }
  return `$${plan.priceUsdCents / 100}`;
}

export default function PricingPage() {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState<Currency>("USD");

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t("pricing.title")}
        </h1>
        <p className="mt-3 text-ink-muted">{t("pricing.subtitle")}</p>

        <div className="mt-6 inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/50 p-1 backdrop-blur-glass dark:border-white/10 dark:bg-white/10">
          <span className="sr-only">{t("pricing.currencyToggle")}</span>
          {(["USD", "CNY", "NGN"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setCurrency(code)}
              aria-pressed={currency === code}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                currency === code
                  ? "bg-accent text-white shadow"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-4">
        {PLAN_ORDER.map((tier) => {
          const plan = PLANS[tier];
          const price = priceLabel(tier, currency);
          const highlighted = tier === "PRO";

          const bullets: Array<{ label: string; included: boolean }> = [
            {
              label:
                tier === "ENTERPRISE"
                  ? t("common.unlimited")
                  : t("pricing.inspectionsPerMonth", {
                      count: plan.monthlyInspectionLimit.toLocaleString(),
                    }),
              included: true,
            },
            {
              label:
                plan.cameraLines === null
                  ? t("pricing.unlimitedLines")
                  : t("pricing.cameraLines", { count: plan.cameraLines }),
              included: true,
            },
            { label: t("pricing.trendDashboard"), included: tier !== "TRIAL" },
            { label: t("pricing.apiAccess"), included: plan.apiAccess },
            { label: t("pricing.complianceExport"), included: plan.complianceExport },
            { label: t("pricing.prioritySupport"), included: plan.prioritySupport },
          ];

          if (tier === "ENTERPRISE") {
            bullets.push(
              { label: t("pricing.onPrem"), included: true },
              { label: t("pricing.customModel"), included: true },
              { label: t("pricing.accountManager"), included: true },
            );
          }

          return (
            <GlassPanel
              key={tier}
              className={cn(
                "animate-fade-up flex flex-col p-6",
                highlighted && "ring-2 ring-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-ink">{t(`pricing.tier${tier}`)}</h2>
                {highlighted && <Badge tone="accent">{t("pricing.mostPopular")}</Badge>}
              </div>

              <p className="mt-4 flex items-baseline gap-1">
                {price === null ? (
                  <span className="text-2xl font-semibold text-ink">{t("pricing.custom")}</span>
                ) : (
                  <>
                    <span className="text-3xl font-semibold tabular-nums text-ink">
                      {price === "0" ? t("pricing.tierTRIAL") : price}
                    </span>
                    {price !== "0" && (
                      <span className="text-sm text-ink-muted">{t("common.perMonth")}</span>
                    )}
                  </>
                )}
              </p>

              {tier === "TRIAL" && (
                <p className="mt-1 text-xs text-ink-muted">{t("pricing.trialLength")}</p>
              )}

              <ul className="mt-5 flex-1 space-y-2">
                {bullets.map((bullet) => (
                  <li key={bullet.label} className="flex items-start gap-2 text-sm">
                    {bullet.included ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-pass" aria-hidden />
                    ) : (
                      <Minus className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted/50" aria-hidden />
                    )}
                    <span className={bullet.included ? "text-ink" : "text-ink-muted/60"}>
                      {bullet.label}
                    </span>
                  </li>
                ))}
              </ul>

              {plan.overageUsdCents > 0 && (
                <p className="mt-4 text-xs text-ink-muted">
                  {t("pricing.overage", { price: `$${(plan.overageUsdCents / 100).toFixed(2)}` })}
                </p>
              )}

              <Link
                href={tier === "ENTERPRISE" ? "mailto:sales@zemaai.com" : "/signin"}
                className="mt-5 block"
              >
                <GlassButton
                  className="w-full"
                  variant={highlighted ? "primary" : "secondary"}
                >
                  {tier === "ENTERPRISE"
                    ? t("pricing.contactSales")
                    : tier === "TRIAL"
                      ? t("marketing.ctaPrimary")
                      : t("pricing.choosePlan")}
                </GlassButton>
              </Link>
            </GlassPanel>
          );
        })}
      </div>
    </section>
  );
}
