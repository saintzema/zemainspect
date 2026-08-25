"use client";

import { MailCheck } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassPanel } from "@/components/ui/glass";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";

export default function CheckEmailPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <GlassPanel className="w-full max-w-md animate-fade-up p-8 text-center">
        <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-pass/15 text-pass">
          <MailCheck className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("auth.checkEmailTitle")}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{t("auth.checkEmailBody")}</p>
      </GlassPanel>
      <LanguageToggleFAB />
    </div>
  );
}
