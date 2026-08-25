/**
 * Development seed: one organization on a trial, one owner, one API key, and
 * a spread of inspection history so the dashboard and charts have something
 * to render before any real line is connected.
 *
 *   npx tsx prisma/seed.ts
 *
 * The generated API key is printed once — it is stored only as a hash.
 */

import { PrismaClient } from "../lib/generated/prisma";
import { generateApiKey } from "../lib/api-key";
import { generateWebhookSecret } from "../lib/webhooks";
import { NEU_CLASSES } from "../lib/inference/labels";
import { PLANS, TRIAL_DAYS } from "../lib/plans";

const prisma = new PrismaClient();

const DAYS_OF_HISTORY = 30;
const LINES = ["press-line-1", "press-line-2", "coil-inspection"];

function randomDefects(count: number) {
  return Array.from({ length: count }, () => {
    const type = NEU_CLASSES[Math.floor(Math.random() * NEU_CLASSES.length)];
    const x = Math.floor(Math.random() * 400);
    const y = Math.floor(Math.random() * 200);
    return {
      type,
      confidence: Number((0.35 + Math.random() * 0.6).toFixed(3)),
      bbox: [x, y, 40 + Math.floor(Math.random() * 120), 30 + Math.floor(Math.random() * 90)],
    };
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "founder@zemaai.com";

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  // Modelled on the real go-to-market path: a pilot factory hand-granted Pro
  // access by the founder, rather than a self-serve trial. This also keeps the
  // seeded history (~1k inspections) inside the plan limit, so the demo
  // account is not sitting at a 429 the moment you open it.
  const pilotUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  const org = await prisma.organization.create({
    data: {
      name: "Hangzhou Precision Steel (demo)",
      planTier: "TRIAL",
      trialEndsAt,
      manualAccessUntil: pilotUntil,
      manualPlanTier: "PRO",
      webhookSecret: generateWebhookSecret(),
      notificationThreshold: 0.05,
      subscription: {
        create: {
          status: "TRIALING",
          planTier: "TRIAL",
          currentPeriodEnd: trialEndsAt,
          monthlyInspectionLimit: PLANS.PRO.monthlyInspectionLimit,
        },
      },
    },
  });

  await prisma.user.create({
    data: { email, name: "Demo owner", role: "SUPER_ADMIN", organizationId: org.id },
  });

  const key = generateApiKey();
  await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      keyHash: key.keyHash,
      keyPrefix: key.keyPrefix,
      label: "Seed key",
    },
  });

  // Defect rate drifts upward over the window so the trend chart shows a slope
  // rather than noise around a flat line.
  const rows = [];

  for (let day = DAYS_OF_HISTORY; day >= 0; day--) {
    const perDay = 20 + Math.floor(Math.random() * 30);
    const failRate = 0.03 + (DAYS_OF_HISTORY - day) * 0.002;

    for (let i = 0; i < perDay; i++) {
      const failed = Math.random() < failRate;
      const createdAt = new Date(
        Date.now() - day * 24 * 60 * 60 * 1000 + i * 60 * 1000,
      );
      rows.push({
        organizationId: org.id,
        productCategory: "steel",
        lineId: LINES[i % LINES.length],
        result: failed ? ("FAIL" as const) : ("PASS" as const),
        defects: failed ? randomDefects(1 + Math.floor(Math.random() * 2)) : [],
        modelVariant: "yolov8n-neu-onnx",
        inferenceSource: i % 3 === 0 ? "edge" : "server",
        processingTimeMs: 30 + Math.floor(Math.random() * 90),
        createdAt,
      });
    }
  }

  await prisma.inspectionJob.createMany({ data: rows });
  await prisma.subscription.update({
    where: { organizationId: org.id },
    data: { inspectionsUsedThisCycle: rows.length },
  });

  console.log("Seeded.");
  console.log(`  organization : ${org.name} (${org.id})`);
  console.log(`  owner        : ${email}`);
  console.log(`  inspections  : ${rows.length}`);
  console.log(`  API key      : ${key.plaintext}`);
  console.log("\nThe API key is shown once — copy it now.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
