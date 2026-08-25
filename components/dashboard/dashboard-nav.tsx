"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Activity,
  CreditCard,
  FileText,
  KeyRound,
  LogOut,
  ScanLine,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", key: "nav.dashboard", icon: Activity },
  { href: "/trends", key: "nav.trends", icon: TrendingUp },
  { href: "/reports", key: "nav.reports", icon: FileText },
  { href: "/api-keys", key: "nav.apiKeys", icon: KeyRound },
  { href: "/billing", key: "nav.billing", icon: CreditCard },
  { href: "/team", key: "nav.team", icon: Users },
  { href: "/settings", key: "nav.settings", icon: Settings },
] as const;

export function DashboardNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <aside className="border-b border-white/20 bg-white/35 backdrop-blur-glass dark:border-white/10 dark:bg-black/25 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col gap-2 p-3 lg:sticky lg:top-0">
        <Link
          href="/dashboard"
          className="mb-1 flex items-center gap-2 px-2 py-2 font-semibold tracking-tight text-ink"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white">
            <ScanLine className="h-4 w-4" aria-hidden />
          </span>
          {t("common.appName")}
        </Link>

        {/* Horizontal scroll on phones, vertical rail from lg up. */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                  active
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-ink-muted hover:bg-white/40 hover:text-ink dark:hover:bg-white/10",
                )}
              >
                <link.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{t(link.key)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden flex-col gap-1 lg:flex">
          {isSuperAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {t("nav.adminPanel")}
            </Link>
          )}
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t("nav.signOut")}
          </button>
        </div>
      </div>
    </aside>
  );
}
