import type { Detection } from "@/lib/inference/postprocess";

/**
 * Region of interest: inspect only the part of the frame the part occupies.
 *
 * Two independent wins, both of which matter on a real line:
 *
 *  - Accuracy. Everything outside the part — the conveyor, a operator's hand,
 *    a printed label, the wall behind the rig — is off-distribution input the
 *    detector will still answer for. Not showing it to the model at all is
 *    strictly better than filtering its guesses afterwards.
 *  - Speed. The crop is letterboxed up to the model's 640px input, so a
 *    tighter ROI means the part occupies more of those pixels. Small defects
 *    that were 4px across in a full 1280px frame become 12px across, which is
 *    the difference between detectable and not.
 *
 * Stored in normalised 0-1 coordinates so it survives a camera that changes
 * resolution between sessions, or an operator moving from a 720p laptop to a
 * 4K line camera, without silently pointing at the wrong part of the frame.
 */
export interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_FRAME: Roi = { x: 0, y: 0, width: 1, height: 1 };

/** True when the ROI covers the whole frame — nothing to crop. */
export function isFullFrame(roi: Roi): boolean {
  return roi.x <= 0 && roi.y <= 0 && roi.width >= 1 && roi.height >= 1;
}

/**
 * Clamp a possibly-nonsense ROI into the frame.
 *
 * Drag-to-draw produces negative widths when the operator drags right-to-left
 * or bottom-to-top, and pointer capture can report coordinates slightly
 * outside the element. Both are normal input, not errors, so normalise rather
 * than reject: an ROI of zero or negative area would crop to nothing and the
 * inspector would go permanently blank with no explanation.
 */
export function normaliseRoi(roi: Roi): Roi {
  let { x, y, width, height } = roi;

  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }

  x = Math.min(Math.max(x, 0), 1);
  y = Math.min(Math.max(y, 0), 1);
  width = Math.min(width, 1 - x);
  height = Math.min(height, 1 - y);

  return { x, y, width, height };
}

/** The smallest ROI worth honouring, as a fraction of each axis. */
export const MIN_ROI_FRACTION = 0.05;

/**
 * An ROI too small to be a deliberate selection — usually a stray click
 * rather than a drag. Treated as "no selection" so a mis-click cannot leave
 * the inspector staring at a 3-pixel box.
 */
export function isDegenerate(roi: Roi): boolean {
  return roi.width < MIN_ROI_FRACTION || roi.height < MIN_ROI_FRACTION;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a normalised ROI to integer pixel bounds within a frame.
 *
 * Rounded and re-clamped because a fractional source rectangle makes
 * `drawImage` resample, which would put the model's input through a different
 * interpolation than the letterbox path it was matched against.
 */
export function roiToPixels(roi: Roi, frameWidth: number, frameHeight: number): PixelRect {
  const safe = normaliseRoi(roi);
  const x = Math.round(safe.x * frameWidth);
  const y = Math.round(safe.y * frameHeight);
  const width = Math.max(1, Math.min(Math.round(safe.width * frameWidth), frameWidth - x));
  const height = Math.max(1, Math.min(Math.round(safe.height * frameHeight), frameHeight - y));
  return { x, y, width, height };
}

/**
 * Move detections from crop-local coordinates back into full-frame ones.
 *
 * The model saw only the crop, so every box it returns is relative to the
 * crop's top-left. The overlay canvas, the uploaded thumbnail and the stored
 * result all speak full-frame coordinates — without this the boxes would draw
 * in the wrong place, offset by exactly the ROI origin, which looks like a
 * calibration bug rather than a coordinate one.
 */
export function mapDetectionsToFrame(
  detections: Detection[],
  crop: PixelRect,
): Detection[] {
  if (crop.x === 0 && crop.y === 0) return detections;
  return detections.map((det) => ({
    ...det,
    bbox: [det.bbox[0] + crop.x, det.bbox[1] + crop.y, det.bbox[2], det.bbox[3]] as Detection["bbox"],
  }));
}
