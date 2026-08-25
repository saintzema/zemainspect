"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  Badge,
  EmptyState,
  FieldLabel,
  GlassButton,
  GlassCard,
  GlassInput,
  GlassPanel,
} from "@/components/ui/glass";
import { PageHeading } from "@/components/dashboard/stats-row";

interface ApiKeyRow {
  id: string;
  keyPrefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function ApiKeysPage() {
  const { t, language } = useTranslation();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys", { cache: "no-store" });
    if (res.ok) setKeys(((await res.json()) as { keys: ApiKeyRow[] }).keys);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      if (res.ok) {
        const data = (await res.json()) as { plaintext: string };
        setFreshKey(data.plaintext);
        setLabel("");
        await load();
      }
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm(t("apiKeys.confirmRevoke"))) return;
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="space-y-5">
      <PageHeading titleKey="apiKeys.title" subtitleKey="apiKeys.subtitle" />

      {freshKey && (
        <GlassPanel className="animate-fade-up border-accent/40 p-5">
          <p className="font-medium text-ink">{t("apiKeys.newKeyTitle")}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{t("apiKeys.newKeyBody")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-black/70 px-3 py-2 font-mono text-xs text-white">
              {freshKey}
            </code>
            <GlassButton
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(freshKey);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  {t("common.copied")}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {t("common.copy")}
                </>
              )}
            </GlassButton>
            <GlassButton size="sm" variant="ghost" onClick={() => setFreshKey(null)}>
              {t("common.close")}
            </GlassButton>
          </div>
        </GlassPanel>
      )}

      <GlassCard title={t("apiKeys.create")}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <FieldLabel htmlFor="key-label">{t("apiKeys.label")}</FieldLabel>
            <GlassInput
              id="key-label"
              value={label}
              placeholder={t("apiKeys.labelPlaceholder")}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <GlassButton onClick={() => void create()} loading={creating}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("apiKeys.create")}
          </GlassButton>
        </div>
      </GlassCard>

      <GlassCard flush>
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-6 w-6" />} title={t("apiKeys.noKeys")} />
        ) : (
          <ul className="divide-y divide-white/25 dark:divide-white/10">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <code className="font-mono text-xs">{key.keyPrefix}…</code>
                    {key.label && <span className="text-ink-muted">{key.label}</span>}
                    {key.revokedAt ? (
                      <Badge tone="fail">{t("apiKeys.revoked")}</Badge>
                    ) : (
                      <Badge tone="pass">{t("apiKeys.active")}</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t("apiKeys.created")}{" "}
                    {new Date(key.createdAt).toLocaleDateString(locale)} ·{" "}
                    {t("apiKeys.lastUsed")}{" "}
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString(locale)
                      : t("apiKeys.never")}
                  </p>
                </div>
                {!key.revokedAt && (
                  <GlassButton size="sm" variant="ghost" onClick={() => void revoke(key.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t("apiKeys.revoke")}
                  </GlassButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
