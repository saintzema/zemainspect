"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import en from "@/lib/i18n/en.json";
import zh from "@/lib/i18n/zh.json";

export type Language = "en" | "zh";

const DICTIONARIES = { en, zh } as const;
const STORAGE_KEY = "zemainspect.language";

/** Milliseconds the shimmer stays up during a swap, per the FAB spec. */
const SWAP_SHIMMER_MS = 200;

type Dictionary = typeof en;

export interface LanguageContextValue {
  language: Language;
  setLanguage: (next: Language) => void;
  toggleLanguage: () => void;
  isTranslating: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Walk a dotted path through the dictionary. */
function lookup(dict: Dictionary, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined,
      dict,
    );
  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function LanguageProvider({
  children,
  initialLanguage = "en",
}: {
  children: ReactNode;
  /** Server-known preference (User.preferredLanguage), used before hydration. */
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const [isTranslating, setIsTranslating] = useState(false);

  // Restore the local choice on mount. localStorage wins over the server value
  // only until the next successful sync, which keeps an offline factory tablet
  // on the language its operator picked.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") {
        setLanguageState((current) => (current === stored ? current : stored));
      }
    } catch {
      // Private mode or blocked storage — the server value stands.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setIsTranslating(true);
    setLanguageState(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice just won't survive a reload.
    }

    // Persist to the profile so the choice follows the user across devices.
    // A signed-out visitor gets a 401 here, which is fine and ignored.
    void fetch("/api/preferences/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: next }),
    }).catch(() => undefined);

    window.setTimeout(() => setIsTranslating(false), SWAP_SHIMMER_MS);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "en" ? "zh" : "en");
  }, [language, setLanguage]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTIONARIES[language];
      // Fall back to English, then to the key itself, so a missing translation
      // degrades to readable text instead of a blank screen.
      const template = lookup(dict, key) ?? lookup(DICTIONARIES.en, key) ?? key;
      return interpolate(template, vars);
    },
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, toggleLanguage, isTranslating, t }),
    [language, setLanguage, toggleLanguage, isTranslating, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside a LanguageProvider");
  return ctx;
}

export function useTranslation() {
  const { t, language } = useLanguage();
  return { t, language };
}
