import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";
export const maxDuration = 60;
// Never prerender: this route reads the database and must run per invocation.
export const dynamic = "force-dynamic";

/**
 * Defect-rate alerting, run by Vercel Cron every 15 minutes.
 *
 * For each org with a configured threshold, look at the last hour and alert if
 * the defect rate crossed it. A NotificationEvent row records each alert so a
 * sustained problem does not re-notify every quarter hour — one alert per org
 * per hour is the cap.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const windowStart = new Date(Date.now() - 60 * 60 * 1000);

  const orgs = await prisma.organization.findMany({
    where: { notificationThreshold: { not: null } },
    select: {
      id: true,
      name: true,
      notificationThreshold: true,
      notifyEmail: true,
      webhookUrl: true,
      webhookSecret: true,
    },
  });

  const alerted: string[] = [];

  for (const org of orgs) {
    const threshold = org.notificationThreshold;
    if (threshold === null) continue;

    const [total, failed] = await Promise.all([
      prisma.inspectionJob.count({
        where: { organizationId: org.id, createdAt: { gte: windowStart } },
      }),
      prisma.inspectionJob.count({
        where: {
          organizationId: org.id,
          createdAt: { gte: windowStart },
          result: "FAIL",
        },
      }),
    ]);

    // A handful of frames is not a signal; require a usable sample.
    if (total < 20) continue;

    const rate = failed / total;
    if (rate <= threshold) continue;

    const recent = await prisma.notificationEvent.findFirst({
      where: {
        organizationId: org.id,
        kind: "defect_rate_threshold",
        createdAt: { gte: windowStart },
      },
      select: { id: true },
    });
    if (recent) continue;

    await prisma.notificationEvent.create({
      data: {
        organizationId: org.id,
        kind: "defect_rate_threshold",
        windowStart,
        defectRate: rate,
      },
    });

    if (org.webhookUrl && org.webhookSecret) {
      await deliverWebhook(org.webhookUrl, org.webhookSecret, {
        event: "defect_rate_threshold_exceeded",
        organization_id: org.id,
        window_start: windowStart.toISOString(),
        window_end: new Date().toISOString(),
        defect_rate: Number(rate.toFixed(4)),
        threshold,
        inspections: total,
        defects: failed,
      });
    }

    alerted.push(org.id);
  }

  return NextResponse.json({ checked: orgs.length, alerted: alerted.length });
}
