"use client";

import { Languages } from "lucide-react";

import { useLanguage } from "@/lib/i18n/language-context";
import { cn } from "@/lib/utils";

/**
 * Persistent language switch, bottom-right on every page.
 *
 * The swap is a live re-render of the string dictionary — no navigation, no
 * reload — so an operator mid-shift never loses their place on the screen.
 */
export function LanguageToggleFAB({ className }: { className?: string }) {
  const { language, toggleLanguage, isTranslating, t } = useLanguage();
  const nextLanguage = language === "en" ? "中文" : "EN";

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={t("language.toggle")}
      title={t("language.toggle")}
      className={cn(
        "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center",
        "rounded-full border border-white/25 bg-white/15 shadow-glass backdrop-blur-xl",
        "transition-all duration-150 ease-out hover:scale-[1.08] hover:shadow-glass-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "dark:border-white/15 dark:bg-white/10",
        className,
      )}
    >
      <Languages className="h-6 w-6 text-slate-900 dark:text-white/90" aria-hidden />

      <span
        className={cn(
          "absolute -bottom-1 -right-1 rounded-full bg-accent px-1.5 py-0.5",
          "text-[10px] font-bold leading-none text-white shadow",
        )}
        aria-hidden
      >
        {nextLanguage}
      </span>

      {isTranslating && (
        <span
          className="pointer-events-none absolute inset-0 animate-pulse rounded-full bg-white/20"
          aria-hidden
        />
      )}
    </button>
  );
}
