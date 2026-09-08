/**
 * A cheap out-of-distribution guard for incoming frames.
 *
 * The model is trained on the NEU Surface Defect Database: tightly cropped,
 * effectively greyscale photographs of rolled steel under even lighting. Point
 * it at a face, a room, or a drinks can and it does not decline to answer — it
 * confidently reports "Patches 76%", because a detector only ever answers the
 * question it was trained on. That is not a bug in the weights; it is what
 * every supervised detector does off-distribution.
 *
 * This module answers a different question first: does this frame even look
 * like the kind of image the model has ever seen? It is a heuristic gate, not
 * a classifier, and it is deliberately built from statistics that are:
 *
 *   - cheap enough to run every frame on a factory tablet's CPU,
 *   - independent of the model, so a bad frame is rejected before inference
 *     rather than being explained away after it,
 *   - and honest about what they can and cannot separate (see below).
 *
 * What it catches:
 *
 *   - Colour. NEU frames are greyscale steel; a person, a room, or packaging
 *     is not.
 *   - A regular man-made grid — a keyboard, a PCB, packaging text, a phone
 *     screen. Found in production: a MacBook keyboard is dark and desaturated
 *     enough to pass the colour check outright (a keyboard IS grey, same as
 *     steel), yet it produced a confident, persistent "Patches"/"Scratches"
 *     verdict, because nothing was checking *shape* — only colour. Rolled
 *     steel defects (scratches, pitting, patches) are irregular and mostly
 *     one-directional (the rolling direction); a keyboard's edges are
 *     rectangles, present in comparable numbers along both axes. That
 *     difference is measurable without knowing what either object is.
 *   - Glare. A reflective, blown-out patch of pixels reads to the detector as
 *     a bright irregular region — which is exactly what a "Patches" defect
 *     looks like in the training data. Found in the same production frame:
 *     the false "Patches" hit sat right on a glare spot on a glossy trackpad.
 *
 * What it does NOT catch: a matte, evenly-lit, greyscale photograph of
 * something that happens to share rolled steel's texture statistics —
 * genuinely difficult to rule out this cheaply, and nothing here claims to.
 * It narrows the failure surface across the failures actually observed; it
 * does not eliminate every possible one, and the UI says so rather than
 * implying certainty.
 */

export interface FrameStats {
  /**
   * Hasler & Süsstrunk (2003) colourfulness. Roughly 0 for a greyscale
   * image; a saturated colour photograph lands well above 20.
   */
  colourfulness: number;
  /** Mean luminance, 0-255. */
  brightness: number;
  /** Standard deviation of luminance — texture/contrast energy. */
  contrast: number;
  /** Fraction of sampled pixels that are blown-out — glare or a hot reflection. */
  specularFraction: number;
  /**
   * How strongly the frame repeats itself moving down the image (row to
   * row) — 1.0 is a perfect repeat, 0 is no self-similarity at any spacing.
   * A real grid (a keyboard, a PCB) and a directional streak (a
   * rolling-direction scratch) both score high here; only a grid also scores
   * high on gridColPeriodicity. Null when `frameStats` was not given the
   * frame's width and height (cannot be computed from a flat pixel sample),
   * or when the sampled frame was too flat to measure repetition in at all.
   */
  gridRowPeriodicity: number | null;
  /**
   * The same measure moving across the image (column to column). A
   * directional streak that runs the same the whole way across scores near 0
   * here, however strongly it repeats down the image — this is what tells a
   * scratch apart from a grid. Null under the same conditions as
   * gridRowPeriodicity.
   */
  gridColPeriodicity: number | null;
}

/** The frame's pixel dimensions, needed only for the grid-structure check. */
export interface FrameDimensions {
  width: number;
  height: number;
}

export interface SuitabilityVerdict {
  suitable: boolean;
  stats: FrameStats;
  /** Which check failed, for a message the operator can act on. */
  reason: "colour" | "man_made_pattern" | "glare" | "too_dark" | "too_flat" | null;
}

/**
 * Defaults chosen against the two distributions that matter: NEU steel (which
 * sits near zero colourfulness by construction) and ordinary phone-camera
 * scenes of people and rooms (well above it). The gap between them is wide,
 * so the threshold does not need to be finely tuned — it needs to sit in the
 * empty space between, far from both.
 */
export const DEFAULT_MAX_COLOURFULNESS = 16;
/** Below this the frame is essentially unlit; detections would be noise. */
export const DEFAULT_MIN_BRIGHTNESS = 18;
/** A blank wall or a lens cap has almost no luminance variation. */
export const DEFAULT_MIN_CONTRAST = 6;
/**
 * A shiny steel coil can legitimately carry some specular highlight; a glass
 * screen or a glossy plastic reflection runs well past this.
 */
export const DEFAULT_MAX_SPECULAR_FRACTION = 0.06;
/**
 * How strongly a row (or column) profile clusters into repeating phases —
 * 1.0 means grouping by some spacing explains all of the variance (a perfect
 * repeat), 0 means it explains none. Real grids at a range of pitches scored
 * a clean 1.0 in testing; genuinely textured or defect-bearing content —
 * isotropic noise at several grain sizes, scattered isolated defects at
 * several counts and layouts, a real lighting gradient, a radial vignette —
 * topped out at 0.48 across dozens of randomised trials. The threshold sits
 * well inside that gap, close to the clean signal rather than splitting the
 * difference, since the cost of missing an unusually coarse or heavily
 * defect-covered grid is far lower than the cost of rejecting a real,
 * paying inspection.
 *
 * This is the second design this check went through, not the first — see
 * `periodicity`'s doc comment for what the first two attempts got wrong and
 * why.
 */
export const DEFAULT_MIN_GRID_PERIODICITY = 0.65;

/** Coarse sampling grid for the structure check — cheap by construction. */
const GRID_DIVISIONS = 20;
/** Blown-out: within a few counts of full white. */
const SPECULAR_LUMA_THRESHOLD = 246;

export interface SuitabilityOptions {
  maxColourfulness?: number;
  minBrightness?: number;
  minContrast?: number;
  maxSpecularFraction?: number;
  minGridPeriodicity?: number;
}

/**
 * How much of a sequence's variance is explained by grouping its samples
 * into phases at the best-fitting repeat spacing — a simplified, cheap
 * periodogram. For each candidate spacing P, group values by index mod P and
 * measure what fraction of the total variance sits between those P group
 * means rather than within them; return the best fraction found over every
 * P tried. A signal that truly repeats every P samples clusters almost
 * perfectly into P phases (ratio near 1); one that does not, however
 * structured, does not.
 *
 * Two simpler measures were tried and rejected before this one, against
 * fixtures built specifically to break each:
 *
 *   1. Raw autocorrelation at each lag. Fails on a lighting gradient or a
 *      vignette — completely ordinary, benign camera conditions — because a
 *      smooth monotonic trend correlates with a shifted copy of itself at
 *      almost any lag purely from being smooth, with no repetition involved
 *      at all. Measured 0.80-0.85 on a plain diagonal gradient: comparable
 *      to a real keyboard.
 *   2. The same, but on first differences (to remove a linear trend).
 *      Fixes the straight-line gradient but not a vignette, whose falloff is
 *      curved rather than linear — a smoothly curved trend's differences are
 *      still smooth, so they still autocorrelate. Measured 0.89 on a radial
 *      vignette.
 *
 * Phase-variance does not have this failure mode: a monotonic or smoothly
 * curved trend does not cluster into repeating phases no matter what
 * spacing is tried, because consecutive same-phase samples (P apart) still
 * differ systematically along the trend. Measured 0.06-0.25 on the same
 * gradient and vignette fixtures that broke the first two attempts.
 *
 * The candidate range is capped at n/3 rather than n/2 deliberately: fewer
 * than three repeats of a spacing over-fits on a small sample — a handful of
 * isolated defects or a patch of noise can look deceptively "periodic" at a
 * spacing with only two samples per phase, purely by chance. Capping at n/3
 * measured against dozens of randomised noise and scattered-defect layouts
 * pulled the worst case down from as high as 0.74 to 0.48, at the cost of no
 * longer catching a grid whose own repeat spacing is wider than that —
 * missing an unusually coarse grid is a far cheaper mistake than rejecting a
 * real, paying inspection.
 */
function periodicity(values: Float32Array): number {
  const n = values.length;
  let grandMean = 0;
  for (let i = 0; i < n; i++) grandMean += values[i];
  grandMean /= n;

  let totalVariance = 0;
  for (let i = 0; i < n; i++) totalVariance += (values[i] - grandMean) * (values[i] - grandMean);
  if (totalVariance < 1e-6) return 0; // flat sequence — no structure to cluster

  let best = 0;
  const maxPeriod = Math.floor(n / 3);
  for (let period = 2; period <= maxPeriod; period++) {
    const sums = new Float32Array(period);
    const counts = new Int32Array(period);
    for (let i = 0; i < n; i++) {
      const phase = i % period;
      sums[phase] += values[i];
      counts[phase] += 1;
    }

    let betweenPhaseVariance = 0;
    for (let phase = 0; phase < period; phase++) {
      const phaseMean = sums[phase] / counts[phase];
      betweenPhaseVariance += counts[phase] * (phaseMean - grandMean) * (phaseMean - grandMean);
    }

    const ratio = betweenPhaseVariance / totalVariance;
    if (ratio > best) best = ratio;
  }
  return best;
}

/**
 * Sample a coarse grid of luma values and measure how strongly the frame
 * repeats itself along each axis.
 *
 * Runs on a fixed 20x20 grid of single-pixel samples regardless of the
 * frame's resolution — 400 lookups — so unlike `frameStats`'s per-pixel pass
 * it does not need a `step` parameter to stay cheap. A real 2-D grid — a
 * keyboard, a PCB, packaging — repeats along BOTH axes; a directional streak
 * (a rolling-direction scratch) repeats along only one; isotropic texture,
 * however strong its local contrast, does not meaningfully repeat along
 * either, because nothing about random variation has a fixed spacing to
 * autocorrelate against.
 */
function gridStructure(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): { rowPeriodicity: number | null; colPeriodicity: number | null } {
  const empty = { rowPeriodicity: null, colPeriodicity: null };
  if (width < GRID_DIVISIONS * 2 || height < GRID_DIVISIONS * 2) {
    return empty;
  }

  const cols = GRID_DIVISIONS;
  const rows = GRID_DIVISIONS;
  const luma = new Float32Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    const y = Math.min(height - 1, Math.floor(((r + 0.5) * height) / rows));
    for (let c = 0; c < cols; c++) {
      const x = Math.min(width - 1, Math.floor(((c + 0.5) * width) / cols));
      const i = (y * width + x) * 4;
      luma[r * cols + c] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }

  const rowMeans = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let sum = 0;
    for (let c = 0; c < cols; c++) sum += luma[r * cols + c];
    rowMeans[r] = sum / cols;
  }

  const colMeans = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) sum += luma[r * cols + c];
    colMeans[c] = sum / rows;
  }

  return {
    rowPeriodicity: periodicity(rowMeans),
    colPeriodicity: periodicity(colMeans),
  };
}

/**
 * Compute frame statistics from raw RGBA pixels.
 *
 * `stride` is 4 for canvas ImageData. Sampling every `step`-th pixel keeps
 * this well under a millisecond on a 1280x720 frame — the guard must never
 * cost more than the inference it is protecting.
 *
 * `dimensions` is optional and only needed for the grid-structure fields
 * (gridRowPeriodicity / gridColPeriodicity), which require 2-D neighbour
 * lookups a flat sampled pass cannot give them. Omit it and those two fields
 * come back null — every other statistic is unaffected.
 */
export function frameStats(
  rgba: Uint8ClampedArray | Uint8Array,
  step = 7,
  dimensions?: FrameDimensions,
): FrameStats {
  let sumRg = 0;
  let sumYb = 0;
  let sumRgSq = 0;
  let sumYbSq = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let specularCount = 0;
  let n = 0;

  const stridePixels = 4 * Math.max(1, Math.trunc(step));
  for (let i = 0; i + 3 < rgba.length; i += stridePixels) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];

    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    // Rec. 601 luma: matches how the greyscale training images were produced.
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    sumRg += rg;
    sumYb += yb;
    sumRgSq += rg * rg;
    sumYbSq += yb * yb;
    sumLuma += luma;
    sumLumaSq += luma * luma;
    if (luma >= SPECULAR_LUMA_THRESHOLD) specularCount += 1;
    n += 1;
  }

  if (n === 0) {
    return {
      colourfulness: 0,
      brightness: 0,
      contrast: 0,
      specularFraction: 0,
      gridRowPeriodicity: null,
      gridColPeriodicity: null,
    };
  }

  const meanRg = sumRg / n;
  const meanYb = sumYb / n;
  // Variance via E[x²] - E[x]², clamped: floating-point error can push a
  // genuinely zero variance (a perfectly flat frame) very slightly negative,
  // and Math.sqrt of that is NaN — which would silently poison every
  // comparison downstream into false.
  const varRg = Math.max(0, sumRgSq / n - meanRg * meanRg);
  const varYb = Math.max(0, sumYbSq / n - meanYb * meanYb);
  const meanLuma = sumLuma / n;
  const varLuma = Math.max(0, sumLumaSq / n - meanLuma * meanLuma);

  const stdRoot = Math.sqrt(varRg + varYb);
  const meanRoot = Math.sqrt(meanRg * meanRg + meanYb * meanYb);

  const structure = dimensions
    ? gridStructure(rgba, dimensions.width, dimensions.height)
    : { rowPeriodicity: null, colPeriodicity: null };

  return {
    colourfulness: stdRoot + 0.3 * meanRoot,
    brightness: meanLuma,
    contrast: Math.sqrt(varLuma),
    specularFraction: specularCount / n,
    gridRowPeriodicity: structure.rowPeriodicity,
    gridColPeriodicity: structure.colPeriodicity,
  };
}

/** Decide whether a frame is worth running the detector on at all. */
export function assessFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  options: SuitabilityOptions = {},
  dimensions?: FrameDimensions,
): SuitabilityVerdict {
  const {
    maxColourfulness = DEFAULT_MAX_COLOURFULNESS,
    minBrightness = DEFAULT_MIN_BRIGHTNESS,
    minContrast = DEFAULT_MIN_CONTRAST,
    maxSpecularFraction = DEFAULT_MAX_SPECULAR_FRACTION,
    minGridPeriodicity = DEFAULT_MIN_GRID_PERIODICITY,
  } = options;

  const stats = frameStats(rgba, 7, dimensions);

  // Order matters: report the most specific, most actionable failure. "This
  // is a colour photo, not steel" tells an operator what to do; "too flat"
  // would be a confusing thing to say about a picture of a face.
  if (stats.colourfulness > maxColourfulness) {
    return { suitable: false, stats, reason: "colour" };
  }
  if (
    stats.gridRowPeriodicity !== null &&
    stats.gridColPeriodicity !== null &&
    stats.gridRowPeriodicity > minGridPeriodicity &&
    stats.gridColPeriodicity > minGridPeriodicity
  ) {
    return { suitable: false, stats, reason: "man_made_pattern" };
  }
  if (stats.specularFraction > maxSpecularFraction) {
    return { suitable: false, stats, reason: "glare" };
  }
  if (stats.brightness < minBrightness) {
    return { suitable: false, stats, reason: "too_dark" };
  }
  if (stats.contrast < minContrast) {
    return { suitable: false, stats, reason: "too_flat" };
  }
  return { suitable: true, stats, reason: null };
}

/**
 * A plain-English explanation of a rejection reason, for the REST API's error
 * responses. Distinct from the operator-facing i18n strings in en.json /
 * zh.json (edge.unsuitable_*) — this is a developer-facing API message, in
 * the same voice as the API's other error messages ("Images must be under
 * 12MB"), not a translated UI label.
 */
export function reasonMessage(reason: SuitabilityVerdict["reason"]): string {
  switch (reason) {
    case "colour":
      return "The image does not look like a greyscale steel surface — it has too much colour.";
    case "man_made_pattern":
      return "The image looks like a manufactured object (a regular grid pattern, like a keyboard, " +
        "PCB, or packaging), not raw steel.";
    case "glare":
      return "The image has too much glare or reflection to inspect reliably.";
    case "too_dark":
      return "The image is too dark to inspect.";
    case "too_flat":
      return "The image has too little surface detail to inspect — a blank or out-of-focus frame.";
    case null:
      return "";
  }
}
