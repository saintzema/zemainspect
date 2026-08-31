"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Search, UserPlus } from "lucide-react";

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
import type { AdminOrgOption, AdminUserRow } from "@/lib/admin/users";

type RoleValue = "OWNER" | "ADMIN" | "VIEWER" | "SUPER_ADMIN";
const ROLES: RoleValue[] = ["OWNER", "ADMIN", "VIEWER", "SUPER_ADMIN"];

export function UserTable({
  rows,
  organizations,
  query,
  currentUserId,
}: {
  rows: AdminUserRow[];
  organizations: AdminOrgOption[];
  query: string;
  currentUserId: string;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  const [search, setSearch] = useState(query);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleValue>("VIEWER");
  const [organizationId, setOrganizationId] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown once, then discarded — the server cannot produce it again.
  const [temporary, setTemporary] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const call = async (key: string, url: string, init: RequestInit) => {
    setPending(key);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        temporaryPassword?: string;
      };
      if (!res.ok) {
        setError(data.error ?? t("errors.generic"));
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError(t("errors.generic"));
      return null;
    } finally {
      setPending(null);
    }
  };

  const createUser = async () => {
    const data = await call("create", "/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim(),
        name: name.trim() || undefined,
        role,
        organizationId: organizationId || undefined,
      }),
    });
    if (!data?.temporaryPassword) return;
    setTemporary({ email: email.trim(), password: data.temporaryPassword });
    setCopied(false);
    setCreating(false);
    setEmail("");
    setName("");
  };

  const resetPassword = async (user: AdminUserRow) => {
    const data = await call(`reset:${user.id}`, `/api/admin/users/${user.id}/password`, {
      method: "POST",
    });
    if (!data?.temporaryPassword) return;
    setTemporary({ email: user.email, password: data.temporaryPassword });
    setCopied(false);
  };

  const setDisabled = (user: AdminUserRow, disabled: boolean) => {
    if (disabled && !window.confirm(t("admin.confirmDisable"))) return;
    void call(`disable:${user.id}`, `/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled }),
    });
  };

  const changeRole = (user: AdminUserRow, next: RoleValue) => {
    void call(`role:${user.id}`, `/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: next }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(`/admin/users?q=${encodeURIComponent(search)}`);
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
        <GlassButton className="ml-auto" onClick={() => setCreating((open) => !open)}>
          <UserPlus className="h-4 w-4" aria-hidden />
          {t("admin.createUser")}
        </GlassButton>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-fail/10 px-3 py-2 text-sm text-fail">
          {error}
        </p>
      )}

      {temporary && (
        <GlassCard title={t("admin.tempPasswordTitle")} description={t("admin.tempPasswordBody")}>
          <p className="text-sm text-ink-muted">{temporary.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-xl bg-white/60 px-3 py-2 font-mono text-base tracking-wide text-ink dark:bg-white/10">
              {temporary.password}
            </code>
            <GlassButton
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(temporary.password)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {copied ? t("common.copied") : t("common.copy")}
            </GlassButton>
            <GlassButton size="sm" variant="ghost" onClick={() => setTemporary(null)}>
              {t("common.close")}
            </GlassButton>
          </div>
        </GlassCard>
      )}

      {creating && (
        <GlassCard title={t("admin.createUser")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="new-email">{t("admin.userEmail")}</FieldLabel>
              <GlassInput
                id="new-email"
                type="email"
                value={email}
                placeholder={t("auth.emailPlaceholder")}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="new-name">{t("auth.nameLabel")}</FieldLabel>
              <GlassInput
                id="new-name"
                value={name}
                placeholder={t("auth.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="new-role">{t("admin.userRole")}</FieldLabel>
              <GlassSelect
                id="new-role"
                value={role}
                onChange={(event) => setRole(event.target.value as RoleValue)}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {t(`team.role${value}`)}
                  </option>
                ))}
              </GlassSelect>
            </div>
            <div>
              <FieldLabel
                htmlFor="new-org"
                hint={organizationId ? undefined : t("admin.newOrgHint")}
              >
                {t("admin.userOrg")}
              </FieldLabel>
              <GlassSelect
                id="new-org"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                <option value="">{t("admin.newOrgOption")}</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </GlassSelect>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <GlassButton
              loading={pending === "create"}
              disabled={!email.trim() || pending !== null}
              onClick={() => void createUser()}
            >
              {t("admin.createUser")}
            </GlassButton>
            <GlassButton variant="ghost" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </GlassButton>
          </div>
        </GlassCard>
      )}

      <GlassCard flush>
        {rows.length === 0 ? (
          <EmptyState title={t("common.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-white/25 text-left text-xs uppercase tracking-wide text-ink-muted dark:border-white/10">
                  <th className="px-5 py-2.5 font-medium">{t("admin.userEmail")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.userOrg")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.userRole")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.userStatus")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("admin.lastActive")}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => {
                  const isSelf = user.id === currentUserId;
                  const disabled = user.disabledAt !== null;
                  return (
                    <tr key={user.id} className="border-b border-white/15 dark:border-white/5">
                      <td className="px-5 py-2.5">
                        <span className="font-medium text-ink">{user.email}</span>
                        {user.name && (
                          <span className="block text-xs text-ink-muted">{user.name}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {user.organizationName ?? "—"}
                      </td>
                      <td className="px-5 py-2.5">
                        <GlassSelect
                          aria-label={t("admin.userRole")}
                          value={user.role}
                          // Changing your own role could lock you out of this
                          // console, so the server refuses it and so does this.
                          disabled={isSelf || pending !== null}
                          onChange={(event) =>
                            changeRole(user, event.target.value as RoleValue)
                          }
                          className="w-36"
                        >
                          {ROLES.map((value) => (
                            <option key={value} value={value}>
                              {t(`team.role${value}`)}
                            </option>
                          ))}
                        </GlassSelect>
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={disabled ? "fail" : "pass"}>
                          {disabled ? t("admin.userDisabled") : t("admin.userActive")}
                        </Badge>
                        <Badge tone="neutral" className="ml-1">
                          {user.hasPassword
                            ? t("admin.userHasPassword")
                            : t("admin.userNoPassword")}
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {user.lastActiveAt
                          ? new Date(user.lastActiveAt).toLocaleDateString(locale)
                          : "—"}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex justify-end gap-2">
                          <GlassButton
                            size="sm"
                            variant="secondary"
                            loading={pending === `reset:${user.id}`}
                            disabled={pending !== null}
                            onClick={() => void resetPassword(user)}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.resetPassword")}
                          </GlassButton>
                          <GlassButton
                            size="sm"
                            variant="ghost"
                            loading={pending === `disable:${user.id}`}
                            disabled={isSelf || pending !== null}
                            onClick={() => setDisabled(user, !disabled)}
                          >
                            {disabled ? t("admin.enableUser") : t("admin.disableUser")}
                          </GlassButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
