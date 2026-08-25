import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { auth } from "@/lib/auth";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The authoritative role check. Middleware only confirms a session exists.
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    // `theme-admin` swaps the accent to violet so the founder can always tell
    // at a glance that this is the admin console, not a customer dashboard.
    <div className="theme-admin flex min-h-dvh flex-col lg:flex-row">
      <AdminNav />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center gap-2 text-xs text-ink-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span>Signed in as {session.user.email}</span>
          <Link href="/dashboard" className="ml-auto underline hover:text-ink">
            ← Customer dashboard
          </Link>
        </div>
        {children}
      </main>
      <LanguageToggleFAB />
    </div>
  );
}
