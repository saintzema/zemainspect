import { describe, expect, it } from "vitest";

import {
  decodeYolov8,
  letterboxInfo,
  nonMaxSuppression,
  type Detection,
} from "@/lib/inference/postprocess";
import { NEU_CLASSES } from "@/lib/inference/labels";

const SIZE = 640;
const NUM_CLASSES = NEU_CLASSES.length; // 6

/**
 * Build a YOLOv8-shaped output tensor [1, 4+nc, anchors] with the given boxes
 * written into specific anchor slots. Values are in model-input pixel space.
 */
function buildOutput(
  anchors: number,
  boxes: Array<{
    anchor: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
    cls: number;
    score: number;
  }>,
) {
  const channels = 4 + NUM_CLASSES;
  const raw = new Float32Array(channels * anchors);
  for (const b of boxes) {
    raw[0 * anchors + b.anchor] = b.cx;
    raw[1 * anchors + b.anchor] = b.cy;
    raw[2 * anchors + b.anchor] = b.w;
    raw[3 * anchors + b.anchor] = b.h;
    raw[(4 + b.cls) * anchors + b.anchor] = b.score;
  }
  return { raw, dims: [1, channels, anchors] as const };
}

describe("letterboxInfo", () => {
  it("centres a landscape image and reports the pad", () => {
    // 1280x640 scales by 0.5 to 640x320, leaving 160px of pad top and bottom.
    const box = letterboxInfo(1280, 640, SIZE);
    expect(box.scale).toBe(0.5);
    expect(box.padX).toBe(0);
    expect(box.padY).toBe(160);
  });

  it("is a no-op transform for an already-square image at input size", () => {
    const box = letterboxInfo(640, 640, SIZE);
    expect(box.scale).toBe(1);
    expect(box.padX).toBe(0);
    expect(box.padY).toBe(0);
  });

  it("scales up a small image", () => {
    const box = letterboxInfo(200, 200, SIZE);
    expect(box.scale).toBe(3.2);
  });
});

describe("decodeYolov8", () => {
  it("maps a centre box back to original coordinates through the letterbox", () => {
    // Original 1280x640 -> scale 0.5, padY 160.
    const box = letterboxInfo(1280, 640, SIZE);
    // A detection at the centre of the padded canvas, 100x100 input pixels.
    const { raw, dims } = buildOutput(10, [
      { anchor: 3, cx: 320, cy: 320, w: 100, h: 100, cls: 2, score: 0.9 },
    ]);

    const dets = decodeYolov8(raw, dims, box);

    expect(dets).toHaveLength(1);
    expect(dets[0].type).toBe("patches"); // index 2
    expect(dets[0].confidence).toBeCloseTo(0.9, 5);

    // x: (320 - 50 - 0) / 0.5 = 540 ; y: (320 - 50 - 160) / 0.5 = 220
    // w,h: 100 / 0.5 = 200
    expect(dets[0].bbox).toEqual([540, 220, 200, 200]);
  });

  it("picks the highest-scoring class for an anchor", () => {
    const box = letterboxInfo(640, 640, SIZE);
    const anchors = 5;
    const channels = 4 + NUM_CLASSES;
    const raw = new Float32Array(channels * anchors);
    raw[0 * anchors + 1] = 100;
    raw[1 * anchors + 1] = 100;
    raw[2 * anchors + 1] = 40;
    raw[3 * anchors + 1] = 40;
    raw[(4 + 0) * anchors + 1] = 0.30; // crazing
    raw[(4 + 5) * anchors + 1] = 0.80; // scratches — should win

    const dets = decodeYolov8(raw, [1, channels, anchors], box);
    expect(dets).toHaveLength(1);
    expect(dets[0].type).toBe("scratches");
    expect(dets[0].confidence).toBeCloseTo(0.8, 5);
  });

  it("drops detections below the confidence threshold", () => {
    const box = letterboxInfo(640, 640, SIZE);
    const { raw, dims } = buildOutput(4, [
      { anchor: 0, cx: 100, cy: 100, w: 20, h: 20, cls: 1, score: 0.10 },
      { anchor: 1, cx: 300, cy: 300, w: 20, h: 20, cls: 1, score: 0.60 },
    ]);

    const dets = decodeYolov8(raw, dims, box, { confidenceThreshold: 0.25 });
    expect(dets).toHaveLength(1);
    expect(dets[0].confidence).toBeCloseTo(0.6, 5);
  });

  it("clamps boxes that run past the image edge", () => {
    const box = letterboxInfo(640, 640, SIZE);
    // Centre near the right edge with a wide box -> must clip at 640.
    const { raw, dims } = buildOutput(3, [
      { anchor: 0, cx: 620, cy: 320, w: 200, h: 100, cls: 4, score: 0.7 },
    ]);

    const dets = decodeYolov8(raw, dims, box);
    const [x, , w] = dets[0].bbox;
    expect(x).toBe(520);
    expect(x + w).toBeLessThanOrEqual(640);
  });

  it("rejects a label list that disagrees with the model's class count", () => {
    const box = letterboxInfo(640, 640, SIZE);
    const { raw } = buildOutput(2, []);
    // Claim 3 classes while the tensor carries 6.
    expect(() =>
      decodeYolov8(raw, [1, 4 + NUM_CLASSES, 2], box, {
        classNames: ["a", "b", "c"],
      }),
    ).toThrow(/out of sync/);
  });

  it("rejects a malformed output rank", () => {
    const box = letterboxInfo(640, 640, SIZE);
    expect(() => decodeYolov8(new Float32Array(10), [1, 10], box)).toThrow(
      /rank/,
    );
  });
});

describe("nonMaxSuppression", () => {
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    confidence: number,
    type = "scratches",
  ): Detection => ({ type, confidence, bbox: [x, y, w, h] });

  it("collapses heavily overlapping boxes of the same class", () => {
    const kept = nonMaxSuppression(
      [box(0, 0, 100, 100, 0.9), box(5, 5, 100, 100, 0.7)],
      0.45,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].confidence).toBeCloseTo(0.9, 5);
  });

  it("keeps overlapping boxes of different classes", () => {
    const kept = nonMaxSuppression(
      [box(0, 0, 100, 100, 0.9, "scratches"), box(0, 0, 100, 100, 0.8, "inclusion")],
      0.45,
    );
    expect(kept).toHaveLength(2);
  });

  it("keeps distant boxes of the same class", () => {
    const kept = nonMaxSuppression(
      [box(0, 0, 50, 50, 0.9), box(400, 400, 50, 50, 0.8)],
      0.45,
    );
    expect(kept).toHaveLength(2);
  });

  it("returns results sorted by descending confidence", () => {
    const kept = nonMaxSuppression(
      [box(0, 0, 20, 20, 0.5), box(300, 300, 20, 20, 0.95), box(600, 600, 20, 20, 0.7)],
      0.45,
    );
    expect(kept.map((k) => k.confidence)).toEqual([0.95, 0.7, 0.5]);
  });
});
