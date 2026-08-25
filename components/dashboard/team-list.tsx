"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  Badge,
  FieldLabel,
  GlassButton,
  GlassCard,
  GlassInput,
  GlassSelect,
} from "@/components/ui/glass";
import type { Role } from "@/lib/generated/prisma";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}

export function TeamList({
  members,
  currentUserId,
  canManage,
}: {
  members: Member[];
  currentUserId: string;
  canManage: boolean;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const locale = language === "zh" ? "zh-CN" : "en-GB";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const invite = async () => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMessage(t("team.inviteSent", { email: email.trim() }));
        setEmail("");
        router.refresh();
      } else {
        setMessage(data.error ?? t("errors.generic"));
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("team.confirmRemove"))) return;
    await fetch(`/api/team/${id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <GlassCard title={t("team.invite")}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <FieldLabel htmlFor="invite-email">{t("team.inviteEmail")}</FieldLabel>
              <GlassInput
                id="invite-email"
                type="email"
                value={email}
                placeholder={t("auth.emailPlaceholder")}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="w-40">
              <FieldLabel htmlFor="invite-role">{t("team.role")}</FieldLabel>
              <GlassSelect
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <option value="ADMIN">{t("team.roleADMIN")}</option>
                <option value="VIEWER">{t("team.roleVIEWER")}</option>
              </GlassSelect>
            </div>
            <GlassButton onClick={() => void invite()} loading={pending} disabled={!email}>
              <UserPlus className="h-4 w-4" aria-hidden />
              {t("team.invite")}
            </GlassButton>
          </div>
          {message && <p className="mt-2 text-sm text-ink-muted">{message}</p>}
        </GlassCard>
      )}

      <GlassCard flush>
        <ul className="divide-y divide-white/25 dark:divide-white/10">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {member.name || member.email}
                  <Badge tone={member.role === "OWNER" ? "accent" : "neutral"}>
                    {t(`team.role${member.role === "SUPER_ADMIN" ? "OWNER" : member.role}`)}
                  </Badge>
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {member.email} · {t("team.joined")}{" "}
                  {new Date(member.createdAt).toLocaleDateString(locale)}
                </p>
              </div>
              {canManage && member.id !== currentUserId && member.role !== "OWNER" && (
                <GlassButton size="sm" variant="ghost" onClick={() => void remove(member.id)}>
                  {t("team.remove")}
                </GlassButton>
              )}
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  );
}
