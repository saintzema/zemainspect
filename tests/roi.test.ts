import { describe, expect, it } from "vitest";

import {
  FULL_FRAME,
  isDegenerate,
  isFullFrame,
  mapDetectionsToFrame,
  normaliseRoi,
  roiToPixels,
} from "@/lib/inference/roi";
import type { Detection } from "@/lib/inference/postprocess";

describe("normaliseRoi", () => {
  it("leaves a well-formed ROI alone", () => {
    expect(normaliseRoi({ x: 0.2, y: 0.3, width: 0.4, height: 0.5 })).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.4,
      height: 0.5,
    });
  });

  it("flips a right-to-left drag into a positive rectangle", () => {
    // Dragging leftwards is normal operator input, not an error.
    expect(normaliseRoi({ x: 0.8, y: 0.2, width: -0.3, height: 0.4 })).toEqual({
      x: 0.5,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });
  });

  it("flips a bottom-to-top drag", () => {
    expect(normaliseRoi({ x: 0.1, y: 0.9, width: 0.2, height: -0.5 })).toEqual({
      x: 0.1,
      y: 0.4,
      width: 0.2,
      height: 0.5,
    });
  });

  it("clamps a drag that ran outside the video element", () => {
    const roi = normaliseRoi({ x: -0.2, y: -0.1, width: 2, height: 2 });
    expect(roi.x).toBe(0);
    expect(roi.y).toBe(0);
    expect(roi.width).toBe(1);
    expect(roi.height).toBe(1);
  });

  it("never produces a rectangle extending past the frame edge", () => {
    const roi = normaliseRoi({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 });
    expect(roi.x + roi.width).toBeLessThanOrEqual(1);
    expect(roi.y + roi.height).toBeLessThanOrEqual(1);
  });
});

describe("isFullFrame / isDegenerate", () => {
  it("recognises the full frame", () => {
    expect(isFullFrame(FULL_FRAME)).toBe(true);
    expect(isFullFrame({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
  });

  it("treats a stray click as degenerate rather than a 3-pixel ROI", () => {
    expect(isDegenerate({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 })).toBe(true);
    expect(isDegenerate({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 })).toBe(false);
  });
});

describe("roiToPixels", () => {
  it("converts a centred half-frame ROI to pixel bounds", () => {
    expect(roiToPixels({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 1280, 720)).toEqual({
      x: 320,
      y: 180,
      width: 640,
      height: 360,
    });
  });

  it("returns whole-pixel integers, so drawImage does not resample", () => {
    const rect = roiToPixels({ x: 0.333, y: 0.111, width: 0.4, height: 0.27 }, 1281, 721);
    for (const v of Object.values(rect)) expect(Number.isInteger(v)).toBe(true);
  });

  it("never runs past the frame, even at the far edge", () => {
    const rect = roiToPixels({ x: 0.99, y: 0.99, width: 0.5, height: 0.5 }, 1280, 720);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1280);
    expect(rect.y + rect.height).toBeLessThanOrEqual(720);
  });

  it("always yields at least one pixel — a zero-size crop would blank the feed", () => {
    const rect = roiToPixels({ x: 0.5, y: 0.5, width: 0, height: 0 }, 1280, 720);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });
});

describe("mapDetectionsToFrame", () => {
  const det: Detection = { type: "patches", confidence: 0.7, bbox: [10, 20, 30, 40] };

  it("offsets crop-local boxes back into full-frame coordinates", () => {
    const [mapped] = mapDetectionsToFrame([det], { x: 100, y: 50, width: 400, height: 300 });
    expect(mapped.bbox).toEqual([110, 70, 30, 40]);
  });

  it("leaves width and height untouched — only the origin moves", () => {
    const [mapped] = mapDetectionsToFrame([det], { x: 100, y: 50, width: 400, height: 300 });
    expect(mapped.bbox[2]).toBe(30);
    expect(mapped.bbox[3]).toBe(40);
  });

  it("preserves class and confidence", () => {
    const [mapped] = mapDetectionsToFrame([det], { x: 7, y: 9, width: 100, height: 100 });
    expect(mapped.type).toBe("patches");
    expect(mapped.confidence).toBe(0.7);
  });

  it("is a no-op for a crop already at the origin", () => {
    expect(mapDetectionsToFrame([det], { x: 0, y: 0, width: 1280, height: 720 })[0].bbox).toEqual(
      [10, 20, 30, 40],
    );
  });
});
