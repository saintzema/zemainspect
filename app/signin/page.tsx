import { Suspense } from "react";

import { emailSignInEnabled, googleSignInEnabled } from "@/lib/auth";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";
import { SignInForm } from "./signin-form";

// Which providers exist is decided by environment variables, so this page has
// to be rendered per-request rather than baked at build time.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Suspense fallback={null}>
        <SignInForm
          emailEnabled={emailSignInEnabled()}
          googleEnabled={googleSignInEnabled()}
        />
      </Suspense>
      <LanguageToggleFAB />
    </div>
  );
}
