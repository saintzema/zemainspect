import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_COLOURFULNESS,
  DEFAULT_MIN_GRID_PERIODICITY,
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

/** Build a width x height RGBA buffer from a per-coordinate colour function. */
function makeImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = pixel(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Greyscale, mid-brightness, textured — what NEU steel looks like. */
const steelLike = () =>
  makeFrame(4000, (i) => {
    const v = 90 + ((i * 37) % 60);
    return [v, v, v];
  });

/**
 * The gridStructure() sampler reads one pixel per macro-cell of a 20x20
 * partition of the frame. Defining a pattern in pixel-space at a period close
 * to the sampler's own spacing aliases unpredictably — a period-20 keyboard
 * sampled every 20 pixels can land on the same phase every time and never see
 * a gap at all. Defining patterns directly in cell-index space sidesteps that
 * entirely: whatever pixel the sampler reads for cell (c, r), it is guaranteed
 * to be a pixel this function assigned deliberately, not an aliasing artifact.
 */
const CELLS = 20;
function cellIndex(coord: number, size: number): number {
  return Math.min(CELLS - 1, Math.floor((coord * CELLS) / size));
}

/**
 * A dark keyboard: narrow dark gap-lines every 4 cells, both across and down
 * — a real 2-D grid of key boundaries, with edges in comparable numbers
 * along both axes. Desaturated and mid-contrast, same as steel, so only
 * shape tells them apart. This is the production frame: a MacBook keyboard
 * read as "Patches"/"Scratches" because the guard only ever checked colour.
 *
 * (A pure checkerboard — alternating every single cell — is the wrong model
 * here: its edges run diagonally, not along either axis, and a central
 * difference is exactly blind to a change that reverses again one step
 * later. Real key gaps are a small fraction of the key pitch, which is what
 * this reproduces.)
 */
const keyboardLike = () =>
  makeImage(200, 200, (x, y) => {
    const cx = cellIndex(x, 200);
    const cy = cellIndex(y, 200);
    const gap = cx % 4 === 3 || cy % 4 === 3;
    const v = gap ? 20 : 70;
    return [v, v, v];
  });

/**
 * Rolled steel with a rolling-direction scratch: horizontal dark bands that
 * span the full width, on an otherwise smooth grey field. Genuinely
 * one-directional structure — brightness varies down each column but never
 * across a row — the case the grid check must NOT reject, or it would blind
 * the model to exactly the defects it exists to find.
 */
const steelWithScratch = () =>
  makeImage(200, 200, (x, y) => {
    const cy = cellIndex(y, 200);
    const v = cy % 5 === 0 ? 55 : 110;
    return [v, v, v];
  });

/**
 * A real hash, not a smooth ramp — deliberately high-frequency, uncorrelated
 * per-pixel noise standing in for genuine photographic grain/speckle. An
 * earlier version of this fixture used a low-order polynomial in x and y,
 * which "looks" textured but measured a real standard deviation of only
 * 5.76 — just under DEFAULT_MIN_CONTRAST — so it never actually exercised
 * the grid check at a realistic contrast. This is the fixture that caught a
 * genuine flaw during development: strong, dense, isotropic texture like
 * this scored just as dense and just as axis-balanced as a real keyboard
 * under the first version of this check (density-and-balance), because
 * random variation is equally likely to produce edges split evenly between
 * horizontal and vertical as a repeating grid is. Periodicity — does the
 * pattern actually repeat at a fixed spacing — is what correctly tells them
 * apart; this fixture is what proves it.
 */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000;
}

const texturedSteel = () =>
  makeImage(400, 400, (x, y) => {
    const v = Math.max(40, Math.min(210, 120 + Math.floor((noise(x, y) - 0.5) * 70)));
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
      specularFraction: 0,
      gridRowPeriodicity: null,
      gridColPeriodicity: null,
    });
  });

  it("reports a high specular fraction for a glare-blown patch", () => {
    // Half the frame is a hot reflection; nothing else in the pixel data
    // signals that except the blown-out luma itself.
    const glare = makeFrame(2000, (i) => (i % 2 === 0 ? [252, 252, 252] : [95, 95, 95]));
    expect(frameStats(glare).specularFraction).toBeGreaterThan(0.4);
  });

  it("reports near-zero specular fraction for an evenly-lit surface", () => {
    expect(frameStats(steelLike()).specularFraction).toBeLessThan(0.01);
  });

  it("leaves grid fields null without dimensions — cannot judge 2-D structure from a flat sample", () => {
    const stats = frameStats(keyboardLike());
    expect(stats.gridRowPeriodicity).toBeNull();
    expect(stats.gridColPeriodicity).toBeNull();
  });

  it("scores a keyboard grid as strongly periodic along both axes", () => {
    // A keyboard's grid lines repeat at a fixed spacing in both directions;
    // measured as a clean 1.0 across every key pitch that fits the sampling
    // grid's period cap in testing.
    const stats = frameStats(keyboardLike(), 7, { width: 200, height: 200 });
    expect(stats.gridRowPeriodicity).not.toBeNull();
    expect(stats.gridRowPeriodicity!).toBeGreaterThan(0.9);
    expect(stats.gridColPeriodicity!).toBeGreaterThan(0.9);
  });

  it("scores a directional steel scratch as periodic in one axis only", () => {
    // The critical negative case: a rolling-direction mark repeats down the
    // image just as strongly as a grid does, so row-periodicity alone
    // cannot tell it apart from one. Column periodicity — exactly 0, since
    // nothing at all varies moving across a row — is what must exclude it.
    const stats = frameStats(steelWithScratch(), 7, { width: 200, height: 200 });
    expect(stats.gridRowPeriodicity).not.toBeNull();
    expect(stats.gridRowPeriodicity!).toBeGreaterThan(0.9);
    expect(stats.gridColPeriodicity!).toBe(0);
  });

  it("scores strong, isotropic texture as low-periodicity on both axes", () => {
    // The flaw an earlier (density-and-balance) version of this check had,
    // caught during development: dense, evenly axis-split structure is not
    // unique to a grid — genuinely random texture with real contrast
    // produces exactly that too, purely by chance, however strong. This
    // fixture has real contrast (~20, well above DEFAULT_MIN_CONTRAST) and
    // would have been wrongly rejected by that version; it must not be
    // rejected by this one, whose threshold is calibrated with real margin
    // above what texture like this measures (see the constant's own doc
    // comment for the numbers).
    const stats = frameStats(texturedSteel(), 7, { width: 400, height: 400 });
    expect(stats.gridRowPeriodicity).not.toBeNull();
    expect(stats.gridRowPeriodicity!).toBeLessThan(DEFAULT_MIN_GRID_PERIODICITY);
    expect(stats.gridColPeriodicity!).toBeLessThan(DEFAULT_MIN_GRID_PERIODICITY);
  });

  it("scores a scattering of isolated defects as low-periodicity", () => {
    // A handful of small, individually square defects has no fixed spacing
    // to repeat at either — real steel defects are localised, not periodic.
    const scattered = makeImage(200, 200, (x, y) => {
      const cx = cellIndex(x, 200);
      const cy = cellIndex(y, 200);
      const blob =
        (cx === 3 && cy === 4) ||
        (cx === 4 && cy === 4) ||
        (cx === 10 && cy === 12) ||
        (cx === 11 && cy === 13) ||
        (cx === 15 && cy === 6);
      const v = blob ? 60 : 105;
      return [v, v, v];
    });
    const stats = frameStats(scattered, 7, { width: 200, height: 200 });
    expect(stats.gridRowPeriodicity).not.toBeNull();
    expect(stats.gridRowPeriodicity!).toBeLessThan(DEFAULT_MIN_GRID_PERIODICITY);
    expect(stats.gridColPeriodicity!).toBeLessThan(DEFAULT_MIN_GRID_PERIODICITY);
  });

  it("does not mistake a lighting gradient or vignette for a grid", () => {
    // Completely ordinary, benign camera conditions on a real line — uneven
    // illumination, a light off to one side, vignetting toward the frame
    // edges — that broke the two simpler designs this check went through
    // before landing on phase-variance (see `periodicity`'s doc comment).
    // Both a straight gradient and a curved radial vignette must survive.
    const gradient = makeImage(200, 200, (x, y) => {
      const v = 80 + Math.floor((x / 200) * 40) + Math.floor((y / 200) * 40);
      return [v, v, v];
    });
    expect(assessFrame(gradient, {}, { width: 200, height: 200 }).reason).not.toBe(
      "man_made_pattern",
    );

    const vignette = makeImage(200, 200, (x, y) => {
      const dx = x - 100;
      const dy = y - 100;
      const dist = Math.sqrt(dx * dx + dy * dy) / 140;
      const v = 150 - Math.floor(dist * 80);
      return [v, v, v];
    });
    expect(assessFrame(vignette, {}, { width: 200, height: 200 }).reason).not.toBe(
      "man_made_pattern",
    );
  });

  it("reports zero periodicity along an axis with no variation at all", () => {
    // A gentle monotonic ramp across x, flat down y: rows are identical to
    // each other (no row-to-row variation to measure repetition from, so
    // gridRowPeriodicity is exactly 0 rather than a division-by-near-zero
    // artifact), while columns vary monotonically — real variance, but no
    // repetition, so a low score rather than null.
    const smooth = makeImage(200, 200, (x) => {
      const v = 80 + Math.floor(x / 40);
      return [v, v, v];
    });
    const stats = frameStats(smooth, 7, { width: 200, height: 200 });
    expect(stats.gridRowPeriodicity).toBe(0);
    expect(stats.gridColPeriodicity).not.toBeNull();
    expect(stats.gridColPeriodicity!).toBeLessThan(DEFAULT_MIN_GRID_PERIODICITY);
  });

  it("leaves grid fields null when the frame is too small for the sampling grid", () => {
    const tiny = makeImage(16, 16, () => [90, 90, 90]);
    const stats = frameStats(tiny, 7, { width: 16, height: 16 });
    expect(stats.gridRowPeriodicity).toBeNull();
    expect(stats.gridColPeriodicity).toBeNull();
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

  it("rejects a keyboard — the production false-positive colour alone let through", () => {
    // Dark and desaturated, same as steel, so this frame passed the old
    // colour-only guard outright and produced a confident, persistent
    // "Patches"/"Scratches" verdict on a real MacBook. Shape is what
    // distinguishes it, so shape is what the guard now has to check.
    const verdict = assessFrame(keyboardLike(), {}, { width: 200, height: 200 });
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("man_made_pattern");
  });

  it("does NOT reject a real rolling-direction steel scratch as a grid", () => {
    // The one-directional case must survive, or the fix would blind the
    // model to exactly the class of defect it exists to catch.
    const verdict = assessFrame(steelWithScratch(), {}, { width: 200, height: 200 });
    expect(verdict.reason).not.toBe("man_made_pattern");
  });

  it("does NOT reject strongly textured, isotropic steel as a grid", () => {
    // The regression this whole redesign exists to prevent: a genuinely
    // textured surface, not a smooth one, must still be accepted. Caught
    // during development against exactly this fixture — a real bug, not a
    // hypothetical one.
    const verdict = assessFrame(texturedSteel(), {}, { width: 400, height: 400 });
    expect(verdict.reason).not.toBe("man_made_pattern");
  });

  it("without dimensions, cannot catch the keyboard — documents the known gap", () => {
    // The grid check needs width/height. A caller that omits them (or a
    // model variant this check does not apply to) gets the pre-fix behaviour
    // back, not a crash — proving the new check degrades safely.
    const verdict = assessFrame(keyboardLike());
    expect(verdict.reason).not.toBe("man_made_pattern");
  });

  it("rejects a glare-blown frame — the production false 'Patches' hit sat on a reflection", () => {
    const glare = makeFrame(2000, (i) => (i % 2 === 0 ? [252, 252, 252] : [95, 95, 95]));
    const verdict = assessFrame(glare);
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("glare");
  });

  it("reports colour ahead of the grid and glare checks too", () => {
    // A colourful frame that also happens to carry a grid pattern (printed
    // packaging, a phone screen) should still get the most actionable reason.
    const colourfulGrid = makeImage(200, 200, (x, y) => {
      const key = x % 20 < 17 && y % 20 < 17;
      return key ? [220, 40, 40] : [40, 60, 200];
    });
    expect(assessFrame(colourfulGrid, {}, { width: 200, height: 200 }).reason).toBe("colour");
  });

  it("honours caller-supplied grid and glare thresholds", () => {
    const keyboard = keyboardLike();
    expect(
      assessFrame(keyboard, { minGridPeriodicity: 1.1 }, { width: 200, height: 200 }).reason,
    ).not.toBe("man_made_pattern");

    const glare = makeFrame(2000, (i) => (i % 2 === 0 ? [252, 252, 252] : [95, 95, 95]));
    expect(assessFrame(glare, { maxSpecularFraction: 0.9 }).reason).not.toBe("glare");
  });
});
