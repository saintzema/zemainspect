"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Activity,
  CreditCard,
  FileText,
  KeyRound,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
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

const COLLAPSE_KEY = "zemainspect:sidebar-collapsed";

export function DashboardNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();

  // Collapsed only ever applies at the lg breakpoint, where the sidebar is a
  // fixed-width rail competing with the edge inspector for screen width — on
  // a phone it's already a compact horizontal bar with nothing to reclaim.
  const [collapsed, setCollapsed] = useState(false);

  // Read the saved preference after mount rather than in useState's
  // initialiser: the server has no localStorage, and matching its render
  // (always expanded) on first paint avoids a hydration mismatch.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Private browsing or storage disabled — default expanded is fine.
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to persist to; the toggle still works for this session.
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "border-b border-white/20 bg-white/35 backdrop-blur-glass dark:border-white/10 dark:bg-black/25",
        "lg:h-dvh lg:shrink-0 lg:border-b-0 lg:border-r",
        "transition-[width] duration-200 ease-out",
        collapsed ? "lg:w-[68px]" : "lg:w-60",
      )}
    >
      <div className="flex h-full flex-col gap-2 p-3 lg:sticky lg:top-0">
        <div className="mb-1 flex items-center gap-2 px-2 py-2">
          <Link
            href="/dashboard"
            className="flex min-w-0 flex-1 items-center gap-2 font-semibold tracking-tight text-ink"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
              <ScanLine className="h-4 w-4" aria-hidden />
            </span>
            {!collapsed && <span className="truncate">{t("common.appName")}</span>}
          </Link>
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            className="hidden shrink-0 rounded-lg p-1.5 text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10 lg:block"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>

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
                title={collapsed ? t(link.key) : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                  collapsed && "lg:justify-center lg:px-2",
                  active
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-ink-muted hover:bg-white/40 hover:text-ink dark:hover:bg-white/10",
                )}
              >
                <link.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
                  {t(link.key)}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden flex-col gap-1 lg:flex">
          {isSuperAdmin && (
            <Link
              href="/admin"
              title={collapsed ? t("nav.adminPanel") : undefined}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10",
                collapsed && "justify-center px-2",
              )}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              <span className={cn(collapsed && "hidden")}>{t("nav.adminPanel")}</span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            title={collapsed ? t("nav.signOut") : undefined}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10",
              collapsed && "justify-center px-2",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            <span className={cn(collapsed && "hidden")}>{t("nav.signOut")}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
