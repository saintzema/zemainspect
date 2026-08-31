"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { KeyRound, ScanLine } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  FieldLabel,
  GlassButton,
  GlassInput,
  GlassPanel,
} from "@/components/ui/glass";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";

const CODE_LENGTH = 6;

function SignInForm() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/dashboard";

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"email" | "google" | "code" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (resend = false) => {
    setPending("email");
    setError(null);
    setNotice(null);
    try {
      // redirect:false keeps the user on this page so they can type the code
      // here, instead of NextAuth bouncing them to its own "check your email".
      const res = await signIn("email", {
        email: email.trim(),
        redirect: false,
        callbackUrl,
      });
      if (res?.error) {
        setError(t("auth.otpSendFailed"));
        return;
      }
      setStep("code");
      if (resend) setNotice(t("auth.otpResent"));
    } catch {
      setError(t("auth.otpSendFailed"));
    } finally {
      setPending(null);
    }
  };

  /*
   * The code IS NextAuth's verification token, so verifying it is just the
   * standard email callback with the token supplied by hand rather than by
   * clicking a link. A wrong or expired code lands on NextAuth's error page,
   * so we send it back here with a flag and show a readable message.
   */
  const verifyCode = () => {
    setPending("code");
    const url = new URL("/api/auth/callback/email", window.location.origin);
    url.searchParams.set("email", email.trim());
    url.searchParams.set("token", code.trim());
    url.searchParams.set("callbackUrl", callbackUrl);
    window.location.href = url.toString();
  };

  // NextAuth redirects failed verification to /signin?error=Verification.
  const verificationFailed = params.get("error") === "Verification";

  return (
    <GlassPanel className="w-full max-w-md animate-fade-up p-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white">
          {step === "code" ? (
            <KeyRound className="h-6 w-6" aria-hidden />
          ) : (
            <ScanLine className="h-6 w-6" aria-hidden />
          )}
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {step === "code" ? t("auth.otpTitle") : t("auth.signInTitle")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {step === "code"
            ? t("auth.otpBody", { email: email.trim() })
            : t("auth.signInSubtitle")}
        </p>
      </div>

      {(verificationFailed || error) && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-fail/10 px-3 py-2 text-sm text-fail"
        >
          {error ?? t("auth.otpInvalid")}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl bg-pass/10 px-3 py-2 text-sm text-pass">
          {notice}
        </p>
      )}

      {step === "email" ? (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <FieldLabel htmlFor="email">{t("auth.emailLabel")}</FieldLabel>
            <GlassInput
              id="email"
              type="email"
              required
              autoFocus
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
              {t("auth.sendCode")}
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
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            verifyCode();
          }}
        >
          <FieldLabel htmlFor="code">{t("auth.otpLabel")}</FieldLabel>
          <GlassInput
            id="code"
            // `numeric` shows a digit keypad on a phone without rejecting
            // paste, which `type="number"` would complicate.
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            required
            autoFocus
            placeholder="000000"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
            }
            className="text-center font-mono text-2xl tracking-[0.4em]"
          />
          <GlassButton
            type="submit"
            className="mt-4 w-full"
            loading={pending === "code"}
            disabled={code.length !== CODE_LENGTH || pending !== null}
          >
            {t("auth.otpVerify")}
          </GlassButton>

          <div className="mt-4 flex items-center justify-between">
            <GlassButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => void sendCode(true)}
            >
              {t("auth.otpResend")}
            </GlassButton>
            <GlassButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setNotice(null);
              }}
            >
              {t("auth.otpWrongEmail")}
            </GlassButton>
          </div>
        </form>
      )}
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
