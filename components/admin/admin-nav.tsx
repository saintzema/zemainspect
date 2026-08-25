"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  Gauge,
  LayoutDashboard,
  Share2,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", key: "admin.overview", icon: LayoutDashboard },
  { href: "/admin/organizations", key: "admin.organizations", icon: Building2 },
  { href: "/admin/subscriptions", key: "admin.subscriptions", icon: CreditCard },
  { href: "/admin/inspections", key: "admin.inspections", icon: Gauge },
  { href: "/admin/referrals", key: "admin.referrals", icon: Share2 },
] as const;

export function AdminNav() {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <aside className="border-b border-white/20 bg-white/35 backdrop-blur-glass dark:border-white/10 dark:bg-black/25 lg:h-dvh lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col gap-2 p-3 lg:sticky lg:top-0">
        <Link
          href="/admin"
          className="mb-1 flex items-center gap-2 px-2 py-2 font-semibold tracking-tight text-ink"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white text-xs font-bold">
            ZI
          </span>
          {t("admin.title")}
        </Link>

        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {LINKS.map((link) => {
            const active =
              link.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(link.href);
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
      </div>
    </aside>
  );
}
