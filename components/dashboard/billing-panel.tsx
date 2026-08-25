"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, TriangleAlert } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { Badge, GlassButton, GlassCard } from "@/components/ui/glass";
import type { PaymentProvider, PlanTier, SubscriptionStatus } from "@/lib/generated/prisma";

export function BillingPanel({
  tier,
  billedTier,
  status,
  currentPeriodEnd,
  manualAccessUntil,
  manualPlanTier,
  availableProviders,
  isOwner,
}: {
  tier: PlanTier;
  billedTier: PlanTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  manualAccessUntil: Date | null;
  manualPlanTier: PlanTier | null;
  availableProviders: PaymentProvider[];
  isOwner: boolean;
}) {
  const { t, language } = useTranslation();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onManualPilot =
    !!manualAccessUntil && manualAccessUntil.getTime() > Date.now();

  const checkout = async (upgradeTo: "STARTER" | "PRO", provider: PaymentProvider) => {
    setPending(`${upgradeTo}-${provider}`);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: upgradeTo, provider }),
      });
      const data = (await res.json()) as { redirect_url?: string; error?: string };
      if (!res.ok || !data.redirect_url) {
        setError(data.error ?? t("errors.generic"));
        return;
      }
      window.location.href = data.redirect_url;
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(null);
    }
  };

  const openPortal = async () => {
    setPending("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { redirect_url?: string; error?: string };
      if (!res.ok || !data.redirect_url) {
        setError(data.error ?? t("errors.generic"));
        return;
      }
      window.location.href = data.redirect_url;
    } finally {
      setPending(null);
    }
  };

  if (availableProviders.length === 0) {
    return (
      <GlassCard title={t("billing.currentPlan")}>
        <p className="text-sm text-ink-muted">{t("billing.noBilling")}</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard title={t("billing.currentPlan")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold tracking-tight text-ink">
          {t(`pricing.tier${tier}`)}
        </span>
        <Badge
          tone={
            status === "ACTIVE" ? "pass" : status === "PAST_DUE" ? "fail" : "neutral"
          }
        >
          {t(`billing.status${status}`)}
        </Badge>
      </div>

      {onManualPilot && (
        <p className="mt-2 text-sm text-accent">
          {t("billing.manualAccess", {
            tier: t(`pricing.tier${manualPlanTier ?? "PRO"}`),
            date: manualAccessUntil!.toLocaleDateString(locale),
          })}
        </p>
      )}

      {currentPeriodEnd && status === "ACTIVE" && (
        <p className="mt-1 text-sm text-ink-muted">
          {t("billing.renews")} {currentPeriodEnd.toLocaleDateString(locale)}
        </p>
      )}

      {status === "PAST_DUE" && (
        <p className="mt-2 flex items-start gap-2 text-sm text-fail">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("billing.pastDueWarning")}
        </p>
      )}

      {!isOwner ? (
        <p className="mt-4 text-sm text-ink-muted">{t("team.onlyOwner")}</p>
      ) : (
        <div className="mt-5 space-y-4">
          {(["STARTER", "PRO"] as const)
            .filter((candidate) => candidate !== billedTier)
            .map((candidate) => (
              <div key={candidate}>
                <p className="mb-2 text-sm font-medium text-ink">
                  {t("pricing.choosePlan")} — {t(`pricing.tier${candidate}`)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableProviders.includes("PAYSTACK") && (
                    <GlassButton
                      size="sm"
                      loading={pending === `${candidate}-PAYSTACK`}
                      onClick={() => void checkout(candidate, "PAYSTACK")}
                    >
                      <CreditCard className="h-3.5 w-3.5" aria-hidden />
                      {t("billing.payWithPaystack")}
                    </GlassButton>
                  )}
                  {availableProviders.includes("STRIPE") && (
                    <GlassButton
                      size="sm"
                      variant="secondary"
                      loading={pending === `${candidate}-STRIPE`}
                      onClick={() => void checkout(candidate, "STRIPE")}
                    >
                      <CreditCard className="h-3.5 w-3.5" aria-hidden />
                      {t("billing.payWithStripe")}
                    </GlassButton>
                  )}
                </div>
              </div>
            ))}

          <p className="text-xs text-ink-muted">
            {availableProviders.includes("PAYSTACK") && t("billing.paystackNote")}{" "}
            {availableProviders.includes("STRIPE") && t("billing.stripeNote")}
          </p>

          {billedTier !== "TRIAL" && (
            <GlassButton
              variant="secondary"
              size="sm"
              loading={pending === "portal"}
              onClick={() => void openPortal()}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("billing.managePayment")}
            </GlassButton>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-fail">{error}</p>}
    </GlassCard>
  );
}
