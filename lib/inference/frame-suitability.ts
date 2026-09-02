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
 * What it catches: colour. NEU frames are greyscale steel; a person, a room,
 * or packaging is not. Colourfulness alone would have rejected every
 * false-positive frame observed in production.
 *
 * What it does NOT catch: a greyscale photograph of something that is not
 * steel. Nothing this cheap can. It narrows the failure surface; it does not
 * eliminate it, and the UI says so rather than implying certainty.
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
}

export interface SuitabilityVerdict {
  suitable: boolean;
  stats: FrameStats;
  /** Which check failed, for a message the operator can act on. */
  reason: "colour" | "too_dark" | "too_flat" | null;
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

export interface SuitabilityOptions {
  maxColourfulness?: number;
  minBrightness?: number;
  minContrast?: number;
}

/**
 * Compute frame statistics from raw RGBA pixels.
 *
 * `stride` is 4 for canvas ImageData. Sampling every `step`-th pixel keeps
 * this well under a millisecond on a 1280x720 frame — the guard must never
 * cost more than the inference it is protecting.
 */
export function frameStats(rgba: Uint8ClampedArray | Uint8Array, step = 7): FrameStats {
  let sumRg = 0;
  let sumYb = 0;
  let sumRgSq = 0;
  let sumYbSq = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
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
    n += 1;
  }

  if (n === 0) return { colourfulness: 0, brightness: 0, contrast: 0 };

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

  return {
    colourfulness: stdRoot + 0.3 * meanRoot,
    brightness: meanLuma,
    contrast: Math.sqrt(varLuma),
  };
}

/** Decide whether a frame is worth running the detector on at all. */
export function assessFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  options: SuitabilityOptions = {},
): SuitabilityVerdict {
  const {
    maxColourfulness = DEFAULT_MAX_COLOURFULNESS,
    minBrightness = DEFAULT_MIN_BRIGHTNESS,
    minContrast = DEFAULT_MIN_CONTRAST,
  } = options;

  const stats = frameStats(rgba);

  // Order matters: report the most specific, most actionable failure. "This
  // is a colour photo, not steel" tells an operator what to do; "too flat"
  // would be a confusing thing to say about a picture of a face.
  if (stats.colourfulness > maxColourfulness) {
    return { suitable: false, stats, reason: "colour" };
  }
  if (stats.brightness < minBrightness) {
    return { suitable: false, stats, reason: "too_dark" };
  }
  if (stats.contrast < minContrast) {
    return { suitable: false, stats, reason: "too_flat" };
  }
  return { suitable: true, stats, reason: null };
}
