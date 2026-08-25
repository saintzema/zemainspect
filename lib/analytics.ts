import { prisma } from "@/lib/prisma";
import type { Detection } from "@/lib/inference/postprocess";

export type Bucket = "day" | "week" | "month";

export interface SummaryStats {
  total: number;
  failed: number;
  passed: number;
  defectRate: number;
  avgLatencyMs: number;
}

export async function summaryStats(
  organizationId: string,
  since: Date,
): Promise<SummaryStats> {
  const [total, failed, latency] = await Promise.all([
    prisma.inspectionJob.count({
      where: { organizationId, createdAt: { gte: since } },
    }),
    prisma.inspectionJob.count({
      where: { organizationId, createdAt: { gte: since }, result: "FAIL" },
    }),
    prisma.inspectionJob.aggregate({
      where: { organizationId, createdAt: { gte: since } },
      _avg: { processingTimeMs: true },
    }),
  ]);

  return {
    total,
    failed,
    passed: total - failed,
    defectRate: total > 0 ? failed / total : 0,
    avgLatencyMs: Math.round(latency._avg.processingTimeMs ?? 0),
  };
}

export interface TrendPoint {
  bucket: string;
  total: number;
  failed: number;
  defectRate: number;
}

/**
 * Inspection volume and defect rate over time.
 *
 * Bucketing happens in Postgres via date_trunc so we never pull a month of
 * rows into the function just to group them.
 */
export async function trendSeries(
  organizationId: string,
  from: Date,
  to: Date,
  bucket: Bucket = "day",
): Promise<TrendPoint[]> {
  // `bucket` is constrained to a literal union, never interpolated user input.
  const rows = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; total: bigint; failed: bigint }>
  >(
    `SELECT date_trunc($1, "createdAt") AS bucket,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE "result" = 'FAIL') AS failed
       FROM "InspectionJob"
      WHERE "organizationId" = $2
        AND "createdAt" >= $3
        AND "createdAt" <= $4
      GROUP BY 1
      ORDER BY 1 ASC`,
    bucket,
    organizationId,
    from,
    to,
  );

  return rows.map((r) => {
    const total = Number(r.total);
    const failed = Number(r.failed);
    return {
      bucket: r.bucket.toISOString(),
      total,
      failed,
      defectRate: total > 0 ? failed / total : 0,
    };
  });
}

export interface DefectCount {
  type: string;
  count: number;
}

/**
 * Count individual defects by class.
 *
 * `defects` is a JSON array per row, so this expands it server-side rather
 * than counting rows — one frame can carry several defects of different types.
 */
export async function defectsByType(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<DefectCount[]> {
  const rows = await prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
    SELECT d->>'type' AS type, COUNT(*) AS count
      FROM "InspectionJob" j
      CROSS JOIN LATERAL jsonb_array_elements(j."defects"::jsonb) AS d
     WHERE j."organizationId" = ${organizationId}
       AND j."createdAt" >= ${from}
       AND j."createdAt" <= ${to}
     GROUP BY 1
     ORDER BY count DESC
  `;

  return rows.map((r) => ({ type: r.type, count: Number(r.count) }));
}

export async function defectsByLine(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<Array<{ lineId: string; total: number; failed: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ lineid: string | null; total: bigint; failed: bigint }>
  >`
    SELECT COALESCE("lineId", 'unassigned') AS lineid,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE "result" = 'FAIL') AS failed
      FROM "InspectionJob"
     WHERE "organizationId" = ${organizationId}
       AND "createdAt" >= ${from}
       AND "createdAt" <= ${to}
     GROUP BY 1
     ORDER BY total DESC
     LIMIT 20
  `;

  return rows.map((r) => ({
    lineId: r.lineid ?? "unassigned",
    total: Number(r.total),
    failed: Number(r.failed),
  }));
}

export interface FeedItem {
  id: string;
  imageUrl: string | null;
  result: "PASS" | "FAIL";
  defects: Detection[];
  productCategory: string;
  lineId: string | null;
  modelVariant: string;
  inferenceSource: string;
  processingTimeMs: number;
  createdAt: string;
}

export async function recentInspections(
  organizationId: string,
  limit = 40,
  before?: Date,
): Promise<FeedItem[]> {
  const jobs = await prisma.inspectionJob.findMany({
    where: {
      organizationId,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });

  return jobs.map((j) => ({
    id: j.id,
    imageUrl: j.imageUrl,
    result: j.result,
    defects: (j.defects as unknown as Detection[]) ?? [],
    productCategory: j.productCategory,
    lineId: j.lineId,
    modelVariant: j.modelVariant,
    inferenceSource: j.inferenceSource,
    processingTimeMs: j.processingTimeMs,
    createdAt: j.createdAt.toISOString(),
  }));
}

/**
 * A Cpk-style capability figure derived from the observed defect rate.
 *
 * This is a proxy, not a dimensional capability study: it converts the
 * fraction defective into the sigma level that would produce it under a
 * normal one-sided assumption. Reported as such in the compliance PDF so an
 * auditor is not misled about how it was obtained.
 */
export function capabilityIndex(defectRate: number): number | null {
  if (defectRate <= 0) return null; // No defects observed — unbounded.
  if (defectRate >= 1) return 0;
  const z = normalQuantile(1 - defectRate);
  return Number((z / 3).toFixed(2));
}

/** Acklam's inverse normal CDF approximation — accurate to ~1e-9. */
function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
