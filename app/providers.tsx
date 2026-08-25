"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

import { LanguageProvider, type Language } from "@/lib/i18n/language-context";

export function Providers({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage: Language;
}) {
  return (
    <SessionProvider>
      <LanguageProvider initialLanguage={initialLanguage}>{children}</LanguageProvider>
    </SessionProvider>
  );
}
