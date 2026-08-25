"use client";

import { useState } from "react";
import { RefreshCw, Send } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  FieldLabel,
  GlassButton,
  GlassCard,
  GlassInput,
} from "@/components/ui/glass";

interface OrgSettings {
  name: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  notificationThreshold: number | null;
  notifyEmail: string | null;
  referralCode: string;
}

export function SettingsForm({
  initial,
  readOnly,
  appUrl,
}: {
  initial: OrgSettings;
  readOnly: boolean;
  appUrl: string;
}) {
  const { t } = useTranslation();

  const [org, setOrg] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testState, setTestState] = useState<string | null>(null);

  // Stored as a 0-1 fraction; shown as a percentage because that is how a QC
  // lead thinks about a defect rate.
  const [thresholdPercent, setThresholdPercent] = useState(
    initial.notificationThreshold !== null
      ? String(initial.notificationThreshold * 100)
      : "",
  );

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const percent = Number.parseFloat(thresholdPercent);
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: org.name,
          webhookUrl: org.webhookUrl ?? "",
          notifyEmail: org.notifyEmail ?? "",
          notificationThreshold:
            thresholdPercent.trim() === "" || Number.isNaN(percent)
              ? null
              : Math.min(1, Math.max(0, percent / 100)),
          ...extra,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { organization: OrgSettings };
        setOrg((current) => ({ ...current, ...data.organization }));
        setSavedAt(Date.now());
      }
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTestState(null);
    const res = await fetch("/api/settings/test-webhook", { method: "POST" });
    if (res.ok) {
      setTestState(t("settings.testWebhookSent"));
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setTestState(t("settings.testWebhookFailed", { error: data.error ?? "" }));
    }
  };

  const disabled = readOnly || saving;

  return (
    <div className="space-y-4">
      <GlassCard title={t("settings.orgName")}>
        <GlassInput
          value={org.name}
          disabled={disabled}
          onChange={(event) => setOrg({ ...org, name: event.target.value })}
        />
      </GlassCard>

      <GlassCard title={t("settings.webhookTitle")} description={t("settings.webhookBody")}>
        <div className="space-y-3">
          <div>
            <FieldLabel htmlFor="webhook-url">{t("settings.webhookUrl")}</FieldLabel>
            <GlassInput
              id="webhook-url"
              type="url"
              placeholder="https://mes.factory.com/hooks/zemainspect"
              value={org.webhookUrl ?? ""}
              disabled={disabled}
              onChange={(event) => setOrg({ ...org, webhookUrl: event.target.value })}
            />
          </div>

          {org.webhookSecret && (
            <div>
              <FieldLabel htmlFor="webhook-secret" hint={t("settings.webhookSecretHint")}>
                {t("settings.webhookSecret")}
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <GlassInput
                  id="webhook-secret"
                  readOnly
                  value={org.webhookSecret}
                  className="min-w-56 flex-1 font-mono text-xs"
                />
                <GlassButton
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => void save({ regenerateSecret: true })}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {t("settings.regenerateSecret")}
                </GlassButton>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <GlassButton
              size="sm"
              variant="secondary"
              disabled={disabled || !org.webhookUrl}
              onClick={() => void sendTest()}
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {t("settings.testWebhook")}
            </GlassButton>
            {testState && <span className="text-xs text-ink-muted">{testState}</span>}
          </div>
        </div>
      </GlassCard>

      <GlassCard title={t("settings.alertsTitle")} description={t("settings.alertsBody")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="threshold" hint={t("settings.thresholdHint")}>
              {t("settings.threshold")} (%)
            </FieldLabel>
            <GlassInput
              id="threshold"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={thresholdPercent}
              disabled={disabled}
              onChange={(event) => setThresholdPercent(event.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="notify-email">{t("settings.notifyEmail")}</FieldLabel>
            <GlassInput
              id="notify-email"
              type="email"
              value={org.notifyEmail ?? ""}
              disabled={disabled}
              onChange={(event) => setOrg({ ...org, notifyEmail: event.target.value })}
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard title={t("admin.referrals")}>
        <p className="text-sm text-ink-muted">
          {t("admin.referralCode")}:{" "}
          <code className="font-mono text-xs text-ink">{org.referralCode}</code>
        </p>
        <GlassInput
          readOnly
          className="mt-2 font-mono text-xs"
          value={`${appUrl}/signin?ref=${org.referralCode}`}
        />
      </GlassCard>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <GlassButton onClick={() => void save()} loading={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </GlassButton>
          {savedAt && <span className="text-sm text-ink-muted">{t("common.saved")}</span>}
        </div>
      )}
    </div>
  );
}
