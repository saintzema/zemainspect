import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { defectsByType, summaryStats, trendSeries, type Bucket } from "@/lib/analytics";
import { PageHeading, StatsRow } from "@/components/dashboard/stats-row";
import {
  DefectRateChart,
  DefectsByTypeChart,
  VolumeChart,
} from "@/components/dashboard/defect-trend-chart";
import { RangePicker } from "@/components/dashboard/range-picker";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: { range?: string; bucket?: string };
}) {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/signin");
  const organizationId = session.user.organizationId;

  const days = RANGE_DAYS[searchParams.range ?? "30"] ?? 30;
  const bucket: Bucket =
    searchParams.bucket === "week" || searchParams.bucket === "month"
      ? searchParams.bucket
      : "day";

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const [stats, series, byType] = await Promise.all([
    summaryStats(organizationId, from),
    trendSeries(organizationId, from, to, bucket),
    defectsByType(organizationId, from, to),
  ]);

  const locale = session.user.preferredLanguage === "zh" ? "zh-CN" : "en-GB";

  return (
    <div className="space-y-5">
      <PageHeading
        titleKey="trends.title"
        subtitleKey="trends.subtitle"
        action={<RangePicker range={String(days)} bucket={bucket} />}
      />

      <StatsRow stats={stats} />

      <DefectRateChart points={series} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DefectsByTypeChart counts={byType} />
        <VolumeChart points={series} locale={locale} />
      </div>
    </div>
  );
}
