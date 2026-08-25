import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { LanguageToggleFAB } from "@/components/ui/language-toggle-fab";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // A signed-in user with no org means provisioning did not finish.
  if (!session.user.organizationId) redirect("/onboarding");

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <DashboardNav isSuperAdmin={session.user.role === "SUPER_ADMIN"} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <LanguageToggleFAB />
    </div>
  );
}
