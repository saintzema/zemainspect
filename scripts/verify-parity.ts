/**
 * Verify our TypeScript inference pipeline against Ultralytics' own.
 *
 *   .venv/bin/python scripts/reference_predict.py ref.json samples/*.jpg
 *   npx tsx scripts/verify-parity.ts ./samples ./ref.json
 *
 * Why this exists: the app does its own letterboxing, its own YOLOv8 decode
 * and its own NMS, in TypeScript, so it can share one code path between the
 * server and the browser. That is a correctness risk — a subtly wrong decode
 * produces confident boxes in the wrong place, which on a factory floor is
 * worse than no detection at all. This script proves ours matches the
 * reference implementation box-for-box on the same weights and images.
 *
 * Run it whenever the weights or the decode change.
 */

import { readFileSync, readdirSync } from "fs";
import path from "path";

import { runInference } from "@/lib/inference/onnx-node";
import type { Detection } from "@/lib/inference/postprocess";

const samplesDir = process.argv[2];
const referencePath = process.argv[3];

if (!samplesDir || !referencePath) {
  console.error("usage: tsx scripts/verify-parity.ts <samples-dir> <reference.json>");
  process.exit(2);
}

// Must match the thresholds the reference run used.
const CONFIDENCE = 0.05;
const IOU = 0.45;

/** Boxes must overlap at least this much to count as the same detection. */
const MIN_MATCH_IOU = 0.9;
/** Confidence may differ only by float noise. */
const MAX_CONFIDENCE_DELTA = 0.01;
/** Detections this close to the cut-off may appear on one side only. */
const BOUNDARY_MARGIN = 0.03;

const reference = JSON.parse(readFileSync(referencePath, "utf8")) as Record<
  string,
  Detection[]
>;

function overlap(a: readonly number[], b: readonly number[]): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

async function main() {
  const files = readdirSync(samplesDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();

  let referenceCount = 0;
  let matchedCount = 0;
  let worstIou = 1;
  let worstConfidenceDelta = 0;
  const problems: string[] = [];

  for (const file of files) {
    const buffer = readFileSync(path.join(samplesDir, file));
    const { detections } = await runInference(buffer, {
      confidenceThreshold: CONFIDENCE,
      iouThreshold: IOU,
    });

    const expected = reference[file] ?? [];
    referenceCount += expected.length;

    // Extra detections are only tolerated when they sit within
    // BOUNDARY_MARGIN of the confidence cut-off: a sub-1/255 pixel difference
    // legitimately flips a box across the line there, and this comparison runs
    // at 0.05 to exercise the decode, far below the 0.25 production default.
    // Anything above that margin is a real disagreement.
    const surplus = detections.length - expected.length;
    if (surplus > 0) {
      const borderline = detections.filter(
        (d) => d.confidence < CONFIDENCE + BOUNDARY_MARGIN,
      ).length;
      if (surplus > borderline) {
        problems.push(
          `${file}: ${surplus} extra detection(s), only ${borderline} near the threshold`,
        );
      }
    } else if (surplus < 0) {
      problems.push(
        `${file}: missing ${-surplus} detection(s) — ours ${detections.length}, reference ${expected.length}`,
      );
    }

    // Greedily pair each reference box with our best same-class overlap.
    const claimed = new Set<number>();
    for (const want of expected) {
      let bestIndex = -1;
      let bestIou = 0;
      detections.forEach((got, index) => {
        if (claimed.has(index) || got.type !== want.type) return;
        const o = overlap(got.bbox, want.bbox);
        if (o > bestIou) {
          bestIou = o;
          bestIndex = index;
        }
      });

      if (bestIndex < 0 || bestIou < MIN_MATCH_IOU) {
        problems.push(
          `${file}: no match for ${want.type} @${want.confidence} bbox=[${want.bbox}] ` +
            `(best IoU ${bestIou.toFixed(3)})`,
        );
        continue;
      }

      const delta = Math.abs(detections[bestIndex].confidence - want.confidence);
      if (delta > MAX_CONFIDENCE_DELTA) {
        problems.push(
          `${file}: ${want.type} confidence differs by ${delta.toFixed(4)}`,
        );
      }

      claimed.add(bestIndex);
      matchedCount += 1;
      worstIou = Math.min(worstIou, bestIou);
      worstConfidenceDelta = Math.max(worstConfidenceDelta, delta);
    }
  }

  console.log(`images                : ${files.length}`);
  console.log(`matched detections    : ${matchedCount}/${referenceCount}`);
  console.log(`worst box IoU         : ${worstIou.toFixed(4)}  (1.0 = pixel-identical)`);
  console.log(`worst confidence diff : ${worstConfidenceDelta.toFixed(5)}`);

  if (problems.length > 0) {
    console.log("\nPROBLEMS");
    for (const problem of problems.slice(0, 20)) console.log(`  ${problem}`);
    if (problems.length > 20) console.log(`  … and ${problems.length - 20} more`);
    process.exit(1);
  }

  console.log("\nPARITY OK — the TypeScript pipeline matches Ultralytics on every box.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
