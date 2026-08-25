import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeading } from "@/components/dashboard/stats-row";
import { TeamList } from "@/components/dashboard/team-list";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/signin");

  const members = await prisma.user.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastActiveAt: true,
    },
  });

  return (
    <div className="space-y-5">
      <PageHeading titleKey="team.title" subtitleKey="team.subtitle" />
      <TeamList
        members={members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
        currentUserId={session.user.id}
        canManage={session.user.role === "OWNER" || session.user.role === "SUPER_ADMIN"}
      />
    </div>
  );
}
