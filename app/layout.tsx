import type { Metadata, Viewport } from "next";

import "./globals.css";
import { Providers } from "@/app/providers";
import { auth } from "@/lib/auth";
import type { Language } from "@/lib/i18n/language-context";

export const metadata: Metadata = {
  title: {
    default: "ZemaInspect — AI defect detection for manufacturing",
    template: "%s · ZemaInspect",
  },
  description:
    "Real-time surface defect detection that runs on the cameras you already own. Live in 15 minutes, bilingual EN/中文.",
  applicationName: "ZemaInspect",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0c12" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Seed the language from the signed-in profile so the first paint is already
  // correct; the client then reconciles with localStorage.
  const session = await auth().catch(() => null);
  const initialLanguage: Language =
    session?.user?.preferredLanguage === "zh" ? "zh" : "en";

  return (
    <html
      lang={initialLanguage === "zh" ? "zh-Hans" : "en"}
      className="dark"
      suppressHydrationWarning
    >
      <body className="font-sans">
        <Providers initialLanguage={initialLanguage}>{children}</Providers>
      </body>
    </html>
  );
}
