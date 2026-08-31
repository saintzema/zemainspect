"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Lock, ScanLine } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  FieldLabel,
  GlassButton,
  GlassInput,
  GlassPanel,
} from "@/components/ui/glass";

const CODE_LENGTH = 6;

/**
 * Three ways in, in deliberate order of reliability on a factory floor:
 *
 *  1. Email + password — works with no inbox access at all, which is the only
 *     thing guaranteed to be true for an operator mid-shift.
 *  2. A one-time code by email — for anyone who has forgotten their password
 *     but can still read mail.
 *  3. Google — convenient, but blocked on the mainland, so never the default.
 *
 * Methods that are not configured on the deployment are not rendered, so a
 * user is never shown a form that silently does nothing.
 */
export function SignInForm({
  emailEnabled,
  googleEnabled,
}: {
  emailEnabled: boolean;
  googleEnabled: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/dashboard";

  const [mode, setMode] = useState<"password" | "otp">("password");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"password" | "email" | "google" | "code" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signInWithPassword = async () => {
    setPending("password");
    setError(null);
    setNotice(null);
    try {
      const res = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
        callbackUrl,
      });
      if (!res || res.error) {
        // The provider returns the same failure for a wrong password, an
        // unknown address and a disabled account, so the message here has to
        // stay generic too — anything more specific would leak which
        // addresses are registered.
        setError(t("auth.invalidCredentials"));
        return;
      }
      // A full navigation rather than router.push: the session cookie was just
      // set, and every server component on the destination needs to render
      // with it.
      window.location.href = res.url ?? callbackUrl;
    } catch {
      setError(t("auth.invalidCredentials"));
    } finally {
      setPending(null);
    }
  };

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
   * which middleware sends back here with a flag.
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
  const urlError = params.get("error");
  const verificationFailed = urlError === "Verification";
  const credentialsFailed = urlError === "CredentialsSignin";

  const enteringCode = mode === "otp" && step === "code";

  const clearMessages = () => {
    setError(null);
    setNotice(null);
    // Drop ?error= so a stale message does not survive switching methods.
    if (urlError) router.replace(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  };

  return (
    <GlassPanel className="w-full max-w-md animate-fade-up p-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white">
          {enteringCode ? (
            <KeyRound className="h-6 w-6" aria-hidden />
          ) : mode === "password" ? (
            <Lock className="h-6 w-6" aria-hidden />
          ) : (
            <ScanLine className="h-6 w-6" aria-hidden />
          )}
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {enteringCode ? t("auth.otpTitle") : t("auth.signInTitle")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {enteringCode
            ? t("auth.otpBody", { email: email.trim() })
            : t("auth.signInSubtitle")}
        </p>
      </div>

      {(error || verificationFailed || credentialsFailed) && (
        <p role="alert" className="mb-4 rounded-xl bg-fail/10 px-3 py-2 text-sm text-fail">
          {error ??
            (verificationFailed ? t("auth.otpInvalid") : t("auth.invalidCredentials"))}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl bg-pass/10 px-3 py-2 text-sm text-pass">
          {notice}
        </p>
      )}

      {enteringCode ? (
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
                clearMessages();
              }}
            >
              {t("auth.otpWrongEmail")}
            </GlassButton>
          </div>
        </form>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (mode === "password") void signInWithPassword();
              else void sendCode();
            }}
          >
            <FieldLabel htmlFor="email">{t("auth.emailLabel")}</FieldLabel>
            <GlassInput
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            {mode === "password" && (
              <div className="mt-3">
                <FieldLabel htmlFor="password">{t("auth.passwordLabel")}</FieldLabel>
                <GlassInput
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}

            <GlassButton
              type="submit"
              className="mt-4 w-full"
              loading={pending === "password" || pending === "email"}
              disabled={pending !== null}
            >
              {mode === "password" ? t("auth.signInAction") : t("auth.sendCode")}
            </GlassButton>
          </form>

          {emailEnabled && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setMode(mode === "password" ? "otp" : "password");
                setPassword("");
                clearMessages();
              }}
              className="mt-3 w-full text-center text-sm text-accent underline-offset-2 hover:underline disabled:opacity-50"
            >
              {mode === "password" ? t("auth.emailCodeInstead") : t("auth.passwordInstead")}
            </button>
          )}

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
            {t("auth.noAccount")}{" "}
            <Link
              href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              {t("auth.createOne")}
            </Link>
          </p>
        </>
      )}
    </GlassPanel>
  );
}
