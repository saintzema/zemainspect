import sharp from "sharp";

import {
  assessFrame,
  type SuitabilityOptions,
  type SuitabilityVerdict,
} from "@/lib/inference/frame-suitability";

/**
 * The REST API's counterpart to the edge inspector's browser-side frame
 * guard (`lib/inference/frame-suitability.ts`).
 *
 * A CCTV camera aimed even slightly off-part, or an MES integration that
 * occasionally forwards the wrong frame, is exactly as capable of handing
 * this endpoint a keyboard, a glare reflection, or a shipping label as a
 * phone camera pointed at the wrong thing is in the browser. The model does
 * not know the difference either way — it was never trained to say "this is
 * not steel", only to look for defects on the assumption that it is. Without
 * this check, the API's answer to an off-target camera is a confident,
 * persisted, webhook-delivered "Patches 76%".
 *
 * Decoded at native resolution, deliberately NOT resized first. An earlier
 * version resized to a 320px box before measuring anything, on the theory
 * that the grid check only ever samples a fixed 20x20 grid regardless of
 * source size (true) and so a smaller decode was pure savings (false): sharp's
 * resize interpolation smooths exactly the per-pixel variation `contrast` and
 * `colourfulness` measure, and it produced a real false rejection in testing
 * — a legitimately textured steel-like image came back "too_flat" purely
 * because resampling had blurred its texture away before frameStats ever saw
 * a pixel. The browser guard never resizes the frame it measures either; this
 * keeps both paths measuring the same thing. Bounded to a sane resolution via
 * the endpoint's own upload size cap, not by resampling the image the guard
 * is trying to judge honestly.
 */

export async function assessUploadedFrame(
  buffer: Buffer,
  options?: SuitabilityOptions,
): Promise<SuitabilityVerdict> {
  const { data, info } = await sharp(buffer, { failOn: "none" })
    .rotate() // honour EXIF orientation, same as the inference decode path
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return assessFrame(data, options, { width: info.width, height: info.height });
}
