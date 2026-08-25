"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Search } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  Badge,
  EmptyState,
  FieldLabel,
  GlassButton,
  GlassCard,
  GlassInput,
  GlassSelect,
} from "@/components/ui/glass";
import type { OrgRow } from "@/lib/admin/metrics";

function defaultGrantDate() {
  // Pilots are pitched as 30 days; pre-fill that.
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function OrgTable({ rows, query }: { rows: OrgRow[]; query: string }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  const [search, setSearch] = useState(query);
  const [granting, setGranting] = useState<OrgRow | null>(null);
  const [tier, setTier] = useState<"STARTER" | "PRO" | "ENTERPRISE">("PRO");
  const [until, setUntil] = useState(defaultGrantDate);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grant = async () => {
    if (!granting) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${granting.id}/grant-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, until }),
      });
      if (res.ok) {
        setGranting(null);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("errors.generic"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(`/admin/organizations?q=${encodeURIComponent(search)}`);
        }}
      >
        <GlassInput
          value={search}
          placeholder={t("common.search")}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <GlassButton type="submit" variant="secondary" size="md">
          <Search className="h-4 w-4" aria-hidden />
        </GlassButton>
      </form>

      {granting && (
        <GlassCard
          title={t("admin.grantAccessTitle")}
          description={t("admin.grantAccessBody")}
        >
          <p className="mb-3 text-sm font-medium text-ink">{granting.name}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <FieldLabel htmlFor="grant-tier">{t("admin.grantTier")}</FieldLabel>
              <GlassSelect
                id="grant-tier"
                value={tier}
                onChange={(event) => setTier(event.target.value as typeof tier)}
              >
                <option value="STARTER">{t("pricing.tierSTARTER")}</option>
                <option value="PRO">{t("pricing.tierPRO")}</option>
                <option value="ENTERPRISE">{t("pricing.tierENTERPRISE")}</option>
              </GlassSelect>
            </div>
            <div>
              <FieldLabel htmlFor="grant-until">{t("admin.grantUntil")}</FieldLabel>
              <GlassInput
                id="grant-until"
                type="date"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
            <GlassButton onClick={() => void grant()} loading={pending}>
              {t("admin.grantConfirm")}
            </GlassButton>
            <GlassButton variant="ghost" onClick={() => setGranting(null)}>
              {t("common.cancel")}
            </GlassButton>
          </div>
          {error && <p className="mt-2 text-sm text-fail">{error}</p>}
        </GlassCard>
      )}

      <GlassCard flush>
        {rows.length === 0 ? (
          <EmptyState title={t("common.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-white/25 text-left text-xs uppercase tracking-wide text-ink-muted dark:border-white/10">
                  <th className="px-5 py-2.5 font-medium">{t("admin.orgName")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.plan")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("billing.status")}</th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    {t("admin.totalInspections")}
                  </th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.signedUp")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.lastActive")}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/15 dark:border-white/5">
                    <td className="px-5 py-2.5 font-medium text-ink">{row.name}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={row.planTier === "TRIAL" ? "neutral" : "accent"}>
                        {t(`pricing.tier${row.planTier}`)}
                      </Badge>
                      {row.manualAccessUntil && (
                        <Badge tone="warn" className="ml-1">
                          <Gift className="h-3 w-3" aria-hidden />
                          {new Date(row.manualAccessUntil).toLocaleDateString(locale)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {t(`billing.status${row.status}`)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-ink">
                      {row.totalInspections.toLocaleString()}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {new Date(row.createdAt).toLocaleDateString(locale)}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {row.lastActiveAt
                        ? new Date(row.lastActiveAt).toLocaleDateString(locale)
                        : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <GlassButton
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setGranting(row);
                          setUntil(defaultGrantDate());
                        }}
                      >
                        {t("admin.grantAccess")}
                      </GlassButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
