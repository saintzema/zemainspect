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
   * Of the frame's strong local edges, the fraction that run purely
   * horizontal or purely vertical in the image's own coordinate frame.
   * Reported for diagnostics; NOT what separates a grid from a few isolated
   * defects (see gridBalance) — an isolated square-ish defect scores just as
   * axis-aligned as a grid cell does. Null when `frameStats` was not given
   * the frame's width and height (cannot be computed from a flat pixel
   * sample), or when there were too few strong edges to judge anything from.
   */
  gridAxisAlignedFraction: number | null;
  /**
   * What fraction of the sampled frame is covered by strong local structure
   * at all — the actual grid-vs-defects discriminator. A real grid (a
   * keyboard, a PCB) fills roughly half the sampling grid; a handful of
   * isolated defects fill a twentieth of it, however axis-aligned or evenly
   * split those few edges are. Null under the same conditions as
   * gridAxisAlignedFraction.
   */
  gridEdgeDensity: number | null;
  /**
   * Of the frame's axis-aligned edges, how evenly split they are between
   * "mostly horizontal edge" and "mostly vertical edge" (0 = all one
   * direction, up to 0.5 = perfectly even). A one-directional streak — a
   * scratch, a rolling-direction mark — scores near 0 here however dense it
   * is; only a real 2-D grid scores high on both density and this at once.
   * Null under the same conditions as gridAxisAlignedFraction.
   */
  gridBalance: number | null;
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
 * Measured against the two cases that motivated this check: a real keyboard
 * covers roughly half of the sampling grid's interior nodes with a strong
 * edge (0.50-0.53 in testing); a handful of isolated steel defects — the case
 * this must NOT reject — covers barely a twentieth of it (0.06). The
 * threshold sits well inside that gap, not at either edge of it.
 */
export const DEFAULT_MIN_GRID_EDGE_DENSITY = 0.18;
/**
 * Below this, the axis-aligned edges are all one direction — a directional
 * streak, not a grid — however dense the structure is. This is what lets a
 * rolling-direction scratch (balance 0 in testing, however dense) through
 * while still catching a keyboard (balance 0.26-0.35). Density alone is not
 * enough: a scattering of small, individually-square defects also splits
 * close to evenly between horizontal and vertical edges (balance 0.44 in
 * testing) purely from each blob having a top, bottom, left and right edge —
 * it is excluded by density being far too low, not by this.
 */
export const DEFAULT_MIN_GRID_BALANCE = 0.15;

/** Coarse sampling grid for the structure check — cheap by construction. */
const GRID_DIVISIONS = 20;
/** Luma difference between neighbouring grid nodes counted as a real edge. */
const GRID_EDGE_THRESHOLD = 18;
/** Fraction of an edge's gradient that must sit on one axis to call it aligned. */
const GRID_AXIS_DOMINANCE = 0.9;
/** Fewer strong edges than this and there is nothing to judge structure from. */
const MIN_STRUCTURED_EDGES = 8;
/** Blown-out: within a few counts of full white. */
const SPECULAR_LUMA_THRESHOLD = 246;

export interface SuitabilityOptions {
  maxColourfulness?: number;
  minBrightness?: number;
  minContrast?: number;
  maxSpecularFraction?: number;
  minGridEdgeDensity?: number;
  minGridBalance?: number;
}

/**
 * Sample a coarse grid of luma values and score how much of the frame is
 * covered by strong, axis-aligned local structure, and how evenly that
 * structure splits between the two axes.
 *
 * Runs on a fixed 20x20 grid of single-pixel samples regardless of the
 * frame's resolution — 400 lookups — so unlike `frameStats`'s per-pixel pass
 * it does not need a `step` parameter to stay cheap.
 *
 * Density, not axis-alignment fraction, is what actually separates "a grid"
 * from "a few isolated defects": tested against real fixtures, an isolated
 * blob's edges are just as axis-aligned and just as evenly split between
 * horizontal and vertical as a keyboard's (each blob has a top, a bottom, a
 * left and a right edge, same as a grid cell does) — the two are
 * indistinguishable by shape alone. What differs is coverage: a grid's
 * structure fills roughly half the sampled frame; a handful of defects fill
 * a twentieth of it.
 */
function gridStructure(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): { axisAlignedFraction: number | null; balance: number | null; density: number | null } {
  const empty = { axisAlignedFraction: null, balance: null, density: null };
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

  let strongEdges = 0;
  let axisAligned = 0;
  let horizontalDominant = 0; // edge runs horizontally (vertical gradient)
  let verticalDominant = 0; // edge runs vertically (horizontal gradient)
  const interiorNodes = (rows - 2) * (cols - 2);

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const gx = luma[r * cols + c + 1] - luma[r * cols + c - 1];
      const gy = luma[(r + 1) * cols + c] - luma[(r - 1) * cols + c];
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      if (magnitude < GRID_EDGE_THRESHOLD) continue;

      strongEdges += 1;
      const axisDominance = Math.max(Math.abs(gx), Math.abs(gy)) / magnitude;
      if (axisDominance >= GRID_AXIS_DOMINANCE) {
        axisAligned += 1;
        if (Math.abs(gy) >= Math.abs(gx)) horizontalDominant += 1;
        else verticalDominant += 1;
      }
    }
  }

  if (strongEdges < MIN_STRUCTURED_EDGES) {
    return empty;
  }

  return {
    axisAlignedFraction: axisAligned / strongEdges,
    balance: Math.min(horizontalDominant, verticalDominant) / strongEdges,
    density: strongEdges / interiorNodes,
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
 * (gridAxisAlignedFraction / gridEdgeDensity / gridBalance), which require
 * 2-D neighbour lookups a flat sampled pass cannot give them. Omit it and
 * those three fields come back null — every other statistic is unaffected.
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
      gridAxisAlignedFraction: null,
      gridEdgeDensity: null,
      gridBalance: null,
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
    : { axisAlignedFraction: null, balance: null, density: null };

  return {
    colourfulness: stdRoot + 0.3 * meanRoot,
    brightness: meanLuma,
    contrast: Math.sqrt(varLuma),
    specularFraction: specularCount / n,
    gridAxisAlignedFraction: structure.axisAlignedFraction,
    gridEdgeDensity: structure.density,
    gridBalance: structure.balance,
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
    minGridEdgeDensity = DEFAULT_MIN_GRID_EDGE_DENSITY,
    minGridBalance = DEFAULT_MIN_GRID_BALANCE,
  } = options;

  const stats = frameStats(rgba, 7, dimensions);

  // Order matters: report the most specific, most actionable failure. "This
  // is a colour photo, not steel" tells an operator what to do; "too flat"
  // would be a confusing thing to say about a picture of a face.
  if (stats.colourfulness > maxColourfulness) {
    return { suitable: false, stats, reason: "colour" };
  }
  if (
    stats.gridEdgeDensity !== null &&
    stats.gridBalance !== null &&
    stats.gridEdgeDensity > minGridEdgeDensity &&
    stats.gridBalance > minGridBalance
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
