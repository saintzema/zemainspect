import { describe, expect, it } from "vitest";

import { DetectionTracker, iou } from "@/lib/inference/temporal";
import type { Detection } from "@/lib/inference/postprocess";

const det = (
  type: string,
  bbox: [number, number, number, number],
  confidence = 0.8,
): Detection => ({ type, confidence, bbox });

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [100, 100, 10, 10])).toBe(0);
  });

  it("is 0 for boxes that only touch at an edge", () => {
    expect(iou([0, 0, 10, 10], [10, 0, 10, 10])).toBe(0);
  });

  it("computes partial overlap correctly", () => {
    // Half-overlapping equal boxes: intersection 50, union 150.
    expect(iou([0, 0, 10, 10], [5, 0, 10, 10])).toBeCloseTo(50 / 150, 5);
  });

  it("does not divide by zero on a zero-area box", () => {
    expect(iou([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
  });
});

describe("DetectionTracker", () => {
  it("withholds a defect seen only once", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    expect(tracker.update([det("scratches", [10, 10, 20, 20])])).toEqual([]);
  });

  it("confirms a defect that holds still across enough frames", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    tracker.update([det("scratches", [10, 10, 20, 20])]);
    const confirmed = tracker.update([det("scratches", [11, 11, 20, 20])]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].type).toBe("scratches");
  });

  it("drops a one-frame flicker entirely — the whole point", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    expect(tracker.update([det("patches", [50, 50, 30, 30])])).toEqual([]);
    expect(tracker.update([])).toEqual([]);
    expect(tracker.update([])).toEqual([]);
  });

  it("reports the freshest box, so the overlay follows a moving part", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    tracker.update([det("patches", [10, 10, 40, 40])]);
    const confirmed = tracker.update([det("patches", [18, 10, 40, 40])]);
    expect(confirmed[0].bbox[0]).toBe(18);
  });

  it("treats a different defect class in the same place as a separate finding", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    tracker.update([det("scratches", [10, 10, 20, 20])]);
    // Same location, different class — must not inherit the scratch's hit.
    expect(tracker.update([det("inclusion", [10, 10, 20, 20])])).toEqual([]);
  });

  it("does not let an alternating flicker accumulate its way to confirmation", () => {
    // The subtle one: if a miss merely decremented hits, a detection present
    // on every other frame would eventually cross the threshold. "Consecutive"
    // has to actually mean consecutive.
    const tracker = new DetectionTracker({ confirmFrames: 3, trackTtlFrames: 5 });
    const box = det("patches", [10, 10, 20, 20]);
    for (let i = 0; i < 8; i++) {
      const confirmed = tracker.update(i % 2 === 0 ? [box] : []);
      expect(confirmed).toEqual([]);
    }
  });

  it("forgets a track once it has been missing longer than its TTL", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2, trackTtlFrames: 1 });
    tracker.update([det("patches", [10, 10, 20, 20])]);
    tracker.update([]);
    tracker.update([]);
    // The old track is gone, so this is a first sighting again, not a second.
    expect(tracker.update([det("patches", [10, 10, 20, 20])])).toEqual([]);
  });

  it("keeps a confirmed defect reported while it stays in view", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    const box: [number, number, number, number] = [10, 10, 20, 20];
    tracker.update([det("patches", box)]);
    expect(tracker.update([det("patches", box)])).toHaveLength(1);
    expect(tracker.update([det("patches", box)])).toHaveLength(1);
  });

  it("tracks two distinct defects independently", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    tracker.update([det("patches", [10, 10, 20, 20])]);
    // Second defect appears a frame later; only the first is confirmed yet.
    const confirmed = tracker.update([
      det("patches", [10, 10, 20, 20]),
      det("scratches", [200, 200, 20, 20]),
    ]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].type).toBe("patches");
  });

  it("confirmFrames of 1 passes everything straight through", () => {
    const tracker = new DetectionTracker({ confirmFrames: 1 });
    expect(tracker.update([det("patches", [10, 10, 20, 20])])).toHaveLength(1);
  });

  it("reset clears all state", () => {
    const tracker = new DetectionTracker({ confirmFrames: 2 });
    tracker.update([det("patches", [10, 10, 20, 20])]);
    tracker.reset();
    expect(tracker.update([det("patches", [10, 10, 20, 20])])).toEqual([]);
  });

  it("counts unconfirmed tracks for a 'watching' indicator", () => {
    const tracker = new DetectionTracker({ confirmFrames: 3 });
    tracker.update([det("patches", [10, 10, 20, 20])]);
    expect(tracker.pendingCount()).toBe(1);
  });
});
