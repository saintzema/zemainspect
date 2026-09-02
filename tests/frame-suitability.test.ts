import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_COLOURFULNESS,
  assessFrame,
  frameStats,
} from "@/lib/inference/frame-suitability";

/** Build an RGBA buffer from a per-pixel colour function. */
function makeFrame(
  count: number,
  pixel: (i: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = pixel(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Greyscale, mid-brightness, textured — what NEU steel looks like. */
const steelLike = () =>
  makeFrame(4000, (i) => {
    const v = 90 + ((i * 37) % 60);
    return [v, v, v];
  });

describe("frameStats", () => {
  it("reports near-zero colourfulness for a greyscale frame", () => {
    // Every channel equal means rg and yb are identically zero, which is the
    // defining property of the training distribution.
    expect(frameStats(steelLike()).colourfulness).toBeLessThan(1);
  });

  it("reports high colourfulness for a saturated colour frame", () => {
    const colourful = makeFrame(4000, (i) =>
      i % 2 === 0 ? [220, 40, 40] : [40, 60, 200],
    );
    expect(frameStats(colourful).colourfulness).toBeGreaterThan(
      DEFAULT_MAX_COLOURFULNESS,
    );
  });

  it("measures brightness and contrast", () => {
    const flatMid = makeFrame(1000, () => [128, 128, 128]);
    const stats = frameStats(flatMid);
    expect(stats.brightness).toBeGreaterThan(120);
    expect(stats.brightness).toBeLessThan(136);
    // A perfectly uniform frame has no luminance variation at all.
    expect(stats.contrast).toBeLessThan(0.5);
  });

  it("never returns NaN on a perfectly uniform frame", () => {
    // Variance computed as E[x²]-E[x]² can land a hair below zero here;
    // Math.sqrt of that is NaN, and NaN comparisons are all false, which
    // would make every suitability check silently pass.
    const stats = frameStats(makeFrame(500, () => [77, 77, 77]));
    expect(Number.isNaN(stats.colourfulness)).toBe(false);
    expect(Number.isNaN(stats.contrast)).toBe(false);
    expect(Number.isNaN(stats.brightness)).toBe(false);
  });

  it("handles an empty buffer without dividing by zero", () => {
    expect(frameStats(new Uint8ClampedArray(0))).toEqual({
      colourfulness: 0,
      brightness: 0,
      contrast: 0,
    });
  });
});

describe("assessFrame", () => {
  it("accepts a steel-like greyscale frame", () => {
    const verdict = assessFrame(steelLike());
    expect(verdict.suitable).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("rejects a colour frame — the production false-positive case", () => {
    // Skin tones, a red cap and printed packaging: the frame that produced
    // "Patches 76%" on a human being.
    const skinAndProps = makeFrame(4000, (i) =>
      i % 3 === 0 ? [198, 134, 96] : i % 3 === 1 ? [190, 32, 40] : [232, 226, 200],
    );
    const verdict = assessFrame(skinAndProps);
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("colour");
  });

  it("rejects a frame that is essentially unlit", () => {
    const dark = makeFrame(2000, (i) => {
      const v = i % 5;
      return [v, v, v];
    });
    const verdict = assessFrame(dark);
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("too_dark");
  });

  it("rejects a blank, textureless frame such as a lens cap or bare wall", () => {
    const verdict = assessFrame(makeFrame(2000, () => [140, 140, 140]));
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("too_flat");
  });

  it("reports colour ahead of other failures, since it is the actionable one", () => {
    // Dark AND colourful: "this is not steel" is what the operator can act
    // on; "too dark" would send them to adjust lighting on a photo of a face.
    const darkAndColourful = makeFrame(2000, (i) =>
      i % 2 === 0 ? [40, 2, 2] : [2, 2, 40],
    );
    expect(assessFrame(darkAndColourful).reason).toBe("colour");
  });

  it("honours caller-supplied thresholds", () => {
    const steel = steelLike();
    // An absurdly strict colour threshold rejects even greyscale, proving the
    // option is actually plumbed through rather than ignored.
    expect(assessFrame(steel, { maxColourfulness: -1 }).reason).toBe("colour");
    expect(assessFrame(steel, { minBrightness: 250 }).reason).toBe("too_dark");
  });
});
