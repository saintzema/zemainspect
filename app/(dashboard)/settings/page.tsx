import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeading } from "@/components/dashboard/stats-row";
import { SettingsForm } from "@/components/dashboard/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/signin");

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: {
      name: true,
      webhookUrl: true,
      webhookSecret: true,
      notificationThreshold: true,
      notifyEmail: true,
      referralCode: true,
    },
  });

  return (
    <div className="space-y-5">
      <PageHeading titleKey="settings.title" subtitleKey="settings.subtitle" />
      <SettingsForm
        initial={organization}
        readOnly={session.user.role === "VIEWER"}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      />
    </div>
  );
}
