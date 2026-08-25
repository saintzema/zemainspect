import {
  mrrOverTime,
  platformMetrics,
  platformVolume,
} from "@/lib/admin/metrics";
import { PageHeading } from "@/components/dashboard/stats-row";
import { AdminOverview } from "@/components/admin/admin-overview";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [metrics, mrr, volume] = await Promise.all([
    platformMetrics(),
    mrrOverTime(12),
    platformVolume(30),
  ]);

  return (
    <div className="space-y-5">
      <PageHeading titleKey="admin.overview" />
      <AdminOverview metrics={metrics} mrr={mrr} volume={volume} />
    </div>
  );
}
