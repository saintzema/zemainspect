import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { organizationOptions, userRows } from "@/lib/admin/users";
import { PageHeading } from "@/components/dashboard/stats-row";
import { UserTable } from "@/components/admin/user-table";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  // The layout already gates on SUPER_ADMIN; this is here only to get the id
  // of the signed-in admin, so the table can refuse to let them disable or
  // demote themselves.
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const [rows, organizations] = await Promise.all([
    userRows(searchParams.q),
    organizationOptions(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeading titleKey="admin.users" subtitleKey="admin.usersSubtitle" />
      <UserTable
        rows={rows}
        organizations={organizations}
        query={searchParams.q ?? ""}
        currentUserId={session.user.id}
      />
    </div>
  );
}
