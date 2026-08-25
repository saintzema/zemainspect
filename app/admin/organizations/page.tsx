import { organizationRows } from "@/lib/admin/metrics";
import { PageHeading } from "@/components/dashboard/stats-row";
import { OrgTable } from "@/components/admin/org-table";

export const dynamic = "force-dynamic";

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const rows = await organizationRows(searchParams.q);

  return (
    <div className="space-y-5">
      <PageHeading titleKey="admin.organizations" />
      <OrgTable rows={rows} query={searchParams.q ?? ""} />
    </div>
  );
}
