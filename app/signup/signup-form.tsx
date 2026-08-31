"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { UserPlus } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { MIN_PASSWORD_LENGTH, validatePassword } from "@/lib/password-rules";
import {
  FieldLabel,
  GlassButton,
  GlassInput,
  GlassPanel,
} from "@/components/ui/glass";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const { t } = useTranslation();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/onboarding";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"register" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    // Same rules the server enforces, applied here first so a weak password
    // is rejected instantly instead of after a round trip.
    const problem = validatePassword(password);
    if (problem) {
      setError(problem.message);
      return;
    }

    setPending("register");
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("auth.signUpFailed"));
        return;
      }

      // Registration deliberately does not issue a session, so sign in with
      // the credentials that were just created. One code path issues sessions.
      const signedIn = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
        callbackUrl,
      });
      if (!signedIn || signedIn.error) {
        // The account exists; only the automatic sign-in failed. Send them to
        // the sign-in page rather than leaving them stuck here.
        window.location.href = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        return;
      }
      window.location.href = signedIn.url ?? callbackUrl;
    } catch {
      setError(t("auth.signUpFailed"));
    } finally {
      setPending(null);
    }
  };

  return (
    <GlassPanel className="w-full max-w-md animate-fade-up p-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white">
          <UserPlus className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("auth.signUpTitle")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("auth.signUpSubtitle")}</p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-fail/10 px-3 py-2 text-sm text-fail">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void register();
        }}
      >
        <FieldLabel htmlFor="name">{t("auth.nameLabel")}</FieldLabel>
        <GlassInput
          id="name"
          autoFocus
          autoComplete="name"
          placeholder={t("auth.namePlaceholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="mt-3">
          <FieldLabel htmlFor="email">{t("auth.emailLabel")}</FieldLabel>
          <GlassInput
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="mt-3">
          <FieldLabel htmlFor="password">{t("auth.passwordLabel")}</FieldLabel>
          <GlassInput
            id="password"
            type="password"
            required
            // The browser's own check catches a short password before a round
            // trip; the server re-validates regardless.
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.passwordPlaceholder")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <GlassButton
          type="submit"
          className="mt-4 w-full"
          loading={pending === "register"}
          disabled={pending !== null}
        >
          {t("auth.signUpAction")}
        </GlassButton>
      </form>

      {googleEnabled && (
        <>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/30 dark:bg-white/10" />
            <span className="text-xs uppercase tracking-wide text-ink-muted">or</span>
            <span className="h-px flex-1 bg-white/30 dark:bg-white/10" />
          </div>
          <GlassButton
            variant="secondary"
            className="w-full"
            loading={pending === "google"}
            disabled={pending !== null}
            onClick={() => {
              setPending("google");
              void signIn("google", { callbackUrl });
            }}
          >
            {t("auth.continueGoogle")}
          </GlassButton>
        </>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        {t("auth.haveAccount")}{" "}
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          {t("auth.signInInstead")}
        </Link>
      </p>
    </GlassPanel>
  );
}
