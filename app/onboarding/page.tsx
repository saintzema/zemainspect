"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  FieldLabel,
  GlassButton,
  GlassInput,
  GlassPanel,
  GlassSelect,
} from "@/components/ui/glass";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";
import { PRODUCT_CATEGORIES } from "@/lib/inference/labels";

const TOTAL_STEPS = 3;

export default function OnboardingPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [lineName, setLineName] = useState("");
  const [category, setCategory] = useState<(typeof PRODUCT_CATEGORIES)[number]>("steel");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const createKey = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: lineName || "First line" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { plaintext: string };
        setApiKey(data.plaintext);
        setStep(3);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <GlassPanel className="w-full max-w-lg animate-fade-up p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {t("onboarding.step", { current: step, total: TOTAL_STEPS })}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
          {t("onboarding.title")}
        </h1>

        <div
          className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/40 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>

        <div className="mt-6">
          {step === 1 && (
            <>
              <h2 className="font-medium text-ink">{t("onboarding.step1Title")}</h2>
              <p className="mb-3 mt-0.5 text-sm text-ink-muted">
                {t("onboarding.step1Body")}
              </p>
              <FieldLabel htmlFor="line-name">{t("onboarding.lineNameLabel")}</FieldLabel>
              <GlassInput
                id="line-name"
                value={lineName}
                placeholder={t("onboarding.lineNamePlaceholder")}
                onChange={(event) => setLineName(event.target.value)}
              />
              <GlassButton className="mt-5 w-full" onClick={() => setStep(2)}>
                {t("common.next")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </GlassButton>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="font-medium text-ink">{t("onboarding.step2Title")}</h2>
              <p className="mb-3 mt-0.5 text-sm text-ink-muted">
                {t("onboarding.step2Body")}
              </p>
              <FieldLabel htmlFor="category">{t("dashboard.category")}</FieldLabel>
              <GlassSelect
                id="category"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as (typeof PRODUCT_CATEGORIES)[number])
                }
              >
                {PRODUCT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`categories.${value}`)}
                  </option>
                ))}
              </GlassSelect>
              <div className="mt-5 flex gap-2">
                <GlassButton variant="ghost" onClick={() => setStep(1)}>
                  {t("common.back")}
                </GlassButton>
                <GlassButton
                  className="flex-1"
                  loading={pending}
                  onClick={() => void createKey()}
                >
                  {t("common.next")}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </GlassButton>
              </div>
            </>
          )}

          {step === 3 && apiKey && (
            <>
              <h2 className="font-medium text-ink">{t("onboarding.step3Title")}</h2>
              <p className="mb-3 mt-0.5 text-sm text-ink-muted">
                {t("onboarding.step3Body")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-black/70 px-3 py-2 font-mono text-xs text-white">
                  {apiKey}
                </code>
                <GlassButton
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(apiKey);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {copied ? t("common.copied") : t("common.copy")}
                </GlassButton>
              </div>

              <pre className="mt-4 overflow-x-auto rounded-xl bg-black/70 p-3 text-[11px] leading-relaxed text-white">
{`curl -X POST ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/inspect \\
  -H "Authorization: Bearer ${apiKey.slice(0, 12)}…" \\
  -F "image=@frame.jpg" \\
  -F "product_category=${category}"${lineName ? ` \\\n  -F "line_id=${lineName}"` : ""}`}
              </pre>

              <GlassButton
                className="mt-5 w-full"
                onClick={() => router.push("/dashboard")}
              >
                {t("onboarding.finishAndOpen")}
              </GlassButton>
            </>
          )}
        </div>
      </GlassPanel>
      <LanguageToggleFAB />
    </div>
  );
}
