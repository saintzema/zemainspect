import { Suspense } from "react";

import { googleSignInEnabled } from "@/lib/auth";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";
import { SignUpForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Suspense fallback={null}>
        <SignUpForm googleEnabled={googleSignInEnabled()} />
      </Suspense>
      <LanguageToggleFAB />
    </div>
  );
}
