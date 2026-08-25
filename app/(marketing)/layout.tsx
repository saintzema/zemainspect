import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <LanguageToggleFAB />
    </div>
  );
}
