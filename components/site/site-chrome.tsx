"use client";

import Link from "next/link";
import { ScanLine } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { GlassButton } from "@/components/ui/glass";

export function SiteHeader() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b border-white/20 bg-white/40 backdrop-blur-glass dark:border-white/10 dark:bg-black/25">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white">
            <ScanLine className="h-4.5 w-4.5" aria-hidden />
          </span>
          <span className="text-ink">{t("common.appName")}</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/pricing"
            className="rounded-full px-3 py-2 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
          >
            {t("nav.pricing")}
          </Link>
          <Link
            href="/docs"
            className="hidden rounded-full px-3 py-2 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink sm:block dark:hover:bg-white/10"
          >
            {t("nav.docs")}
          </Link>
          <Link href="/signin">
            <GlassButton variant="secondary" size="sm">
              {t("nav.signIn")}
            </GlassButton>
          </Link>
          <Link href="/signin" className="hidden sm:block">
            <GlassButton size="sm">{t("marketing.ctaPrimary")}</GlassButton>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="mt-24 border-t border-white/20 py-10 dark:border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center text-sm text-ink-muted sm:px-6">
        <p className="font-medium text-ink">{t("common.appName")}</p>
        <p>{t("common.tagline")}</p>
        <p className="text-xs">
          © {new Date().getFullYear()} Zema AI Labs. {t("marketing.footerRights")}
        </p>
      </div>
    </footer>
  );
}
