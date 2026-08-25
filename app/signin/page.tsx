"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { ScanLine } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  FieldLabel,
  GlassButton,
  GlassInput,
  GlassPanel,
} from "@/components/ui/glass";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";

function SignInForm() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null);

  return (
    <GlassPanel className="w-full max-w-md animate-fade-up p-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white">
          <ScanLine className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("auth.signInTitle")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("auth.signInSubtitle")}</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPending("email");
          void signIn("email", { email, callbackUrl });
        }}
      >
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
        <GlassButton
          type="submit"
          className="mt-4 w-full"
          loading={pending === "email"}
          disabled={pending !== null}
        >
          {t("auth.sendLink")}
        </GlassButton>
      </form>

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
    </GlassPanel>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
      <LanguageToggleFAB />
    </div>
  );
}
