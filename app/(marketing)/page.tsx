"use client";

import Link from "next/link";
import {
  ArrowRight,
  Cpu,
  Gauge,
  Languages,
  Plug,
  ScanLine,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassButton, GlassCard, GlassPanel } from "@/components/ui/glass";

export default function LandingPage() {
  const { t } = useTranslation();

  const steps = [
    { icon: ScanLine, title: t("marketing.how1Title"), body: t("marketing.how1Body") },
    { icon: Cpu, title: t("marketing.how2Title"), body: t("marketing.how2Body") },
    { icon: Gauge, title: t("marketing.how3Title"), body: t("marketing.how3Body") },
  ];

  const features = [
    { icon: ShieldCheck, title: t("marketing.feature1Title"), body: t("marketing.feature1Body") },
    { icon: Languages, title: t("marketing.feature2Title"), body: t("marketing.feature2Body") },
    { icon: Plug, title: t("marketing.feature3Title"), body: t("marketing.feature3Body") },
    { icon: Wallet, title: t("marketing.feature4Title"), body: t("marketing.feature4Body") },
  ];

  const comparisons = [
    { name: t("marketing.compareManual"), pain: t("marketing.compareManualPain") },
    { name: t("marketing.compareVision"), pain: t("marketing.compareVisionPain") },
    { name: t("marketing.compareNothing"), pain: t("marketing.compareNothingPain") },
  ];

  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/50 px-3 py-1 text-xs font-medium text-ink-muted backdrop-blur-glass dark:border-white/10 dark:bg-white/10">
            <span className="h-1.5 w-1.5 rounded-full bg-pass" aria-hidden />
            {t("common.tagline")}
          </span>

          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            {t("marketing.heroTitle")}
          </h1>

          <p className="mt-5 text-pretty text-lg leading-relaxed text-ink-muted">
            {t("marketing.heroSubtitle")}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signin">
              <GlassButton size="lg">
                {t("marketing.ctaPrimary")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </GlassButton>
            </Link>
            <Link href="/pricing">
              <GlassButton size="lg" variant="secondary">
                {t("nav.pricing")}
              </GlassButton>
            </Link>
          </div>

          <p className="mt-6 text-xs text-ink-muted">{t("marketing.trustLine")}</p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-center text-2xl font-semibold tracking-tight text-ink">
          {t("marketing.howTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <GlassPanel key={step.title} className="animate-fade-up p-6">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <step.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-xs font-semibold tabular-nums text-ink-muted">
                  0{index + 1}
                </span>
              </div>
              <h3 className="font-semibold text-ink">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="mb-6 text-center text-2xl font-semibold tracking-tight text-ink">
          {t("marketing.featuresTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <GlassPanel key={feature.title} className="animate-fade-up p-6">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <feature.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="font-semibold text-ink">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{feature.body}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <GlassCard title={t("marketing.comparisonTitle")} flush>
          <ul className="divide-y divide-white/25 dark:divide-white/10">
            {comparisons.map((row) => (
              <li key={row.name} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
                <span className="w-52 shrink-0 text-sm font-medium text-ink">{row.name}</span>
                <span className="text-sm text-ink-muted">{row.pain}</span>
              </li>
            ))}
            <li className="flex flex-col gap-1 bg-accent/10 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
              <span className="w-52 shrink-0 text-sm font-semibold text-accent">
                {t("marketing.compareUs")}
              </span>
              <span className="text-sm font-medium text-ink">{t("marketing.compareUsWin")}</span>
            </li>
          </ul>
        </GlassCard>
      </section>
    </>
  );
}
