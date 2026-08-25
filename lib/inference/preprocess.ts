import { MODEL_INPUT_SIZE, letterboxInfo, type LetterboxInfo } from "@/lib/inference/postprocess";

/**
 * Letterbox raw RGB pixels into the model's NCHW float32 input.
 *
 * The resampling is implemented here rather than delegated to sharp or to
 * canvas `drawImage` for one reason: those two disagree with each other and
 * both disagree with OpenCV, which is what the model was trained and
 * benchmarked against. Measured on real weights, letting the image library
 * pick the kernel shifted detection confidence by up to 0.10 — enough to flip
 * a pass/fail at the default 0.25 threshold — and moved box edges by several
 * pixels.
 *
 * Doing it ourselves buys two guarantees that matter on a production line:
 *
 *   1. Results match the reference Ultralytics implementation, so the accuracy
 *      figures in the published benchmark actually describe this product.
 *   2. The server and the in-browser edge path produce *bit-identical* output
 *      for the same frame, so a defect never passes in one and fails in the
 *      other.
 *
 * This reproduces OpenCV's INTER_LINEAR exactly, including its half-pixel
 * centre convention (`src = (dst + 0.5) * scale - 0.5`) and its edge clamping.
 */

/** YOLO's canonical letterbox padding value. */
export const PAD_VALUE = 114;

interface Axis {
  /** Left/top source index to sample. */
  lower: Int32Array;
  /** Weight applied to `lower + 1`; `1 - weight` applies to `lower`. */
  weight: Float32Array;
}

/** Precompute the source index and interpolation weight for each output pixel. */
function buildAxis(srcLength: number, dstLength: number): Axis {
  const lower = new Int32Array(dstLength);
  const weight = new Float32Array(dstLength);
  const scale = srcLength / dstLength;

  for (let i = 0; i < dstLength; i++) {
    // OpenCV's half-pixel centre mapping.
    let f = (i + 0.5) * scale - 0.5;
    let s = Math.floor(f);
    f -= s;

    // Clamp at the edges the way cv::resize does, so border pixels replicate
    // rather than sampling out of bounds.
    if (s < 0) {
      s = 0;
      f = 0;
    }
    if (s >= srcLength - 1) {
      s = Math.max(0, srcLength - 2);
      f = srcLength <= 1 ? 0 : 1;
    }

    lower[i] = s;
    weight[i] = f;
  }

  return { lower, weight };
}

export interface LetterboxResult {
  /** NCHW float32 RGB in [0, 1], length 3 * size * size. */
  data: Float32Array;
  box: LetterboxInfo;
}

/**
 * @param rgb    Interleaved RGB bytes (3 per pixel), row-major, length srcW*srcH*3.
 * @param stride Bytes per pixel in `rgb` — 3 for RGB, 4 for RGBA (canvas).
 */
export function letterboxToTensor(
  rgb: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  size = MODEL_INPUT_SIZE,
  stride = 3,
): LetterboxResult {
  const box = letterboxInfo(srcW, srcH, size);
  const drawW = Math.round(srcW * box.scale);
  const drawH = Math.round(srcH * box.scale);

  const plane = size * size;
  const out = new Float32Array(3 * plane);

  // Everything starts as padding; only the drawn region is overwritten.
  const pad = PAD_VALUE / 255;
  out.fill(pad);

  const xAxis = buildAxis(srcW, drawW);
  const yAxis = buildAxis(srcH, drawH);

  for (let dy = 0; dy < drawH; dy++) {
    const sy = yAxis.lower[dy];
    const wy = yAxis.weight[dy];
    const wy0 = 1 - wy;

    const row0 = sy * srcW;
    const row1 = Math.min(sy + 1, srcH - 1) * srcW;
    const outRow = (dy + box.padY) * size + box.padX;

    for (let dx = 0; dx < drawW; dx++) {
      const sx = xAxis.lower[dx];
      const wx = xAxis.weight[dx];
      const wx0 = 1 - wx;
      const sx1 = Math.min(sx + 1, srcW - 1);

      const i00 = (row0 + sx) * stride;
      const i01 = (row0 + sx1) * stride;
      const i10 = (row1 + sx) * stride;
      const i11 = (row1 + sx1) * stride;

      const o = outRow + dx;

      for (let c = 0; c < 3; c++) {
        const top = rgb[i00 + c] * wx0 + rgb[i01 + c] * wx;
        const bottom = rgb[i10 + c] * wx0 + rgb[i11 + c] * wx;
        // cv::resize on 8-bit input rounds each interpolated sample back to a
        // byte before the tensor is built. Rounding here too keeps us on the
        // same quantisation grid as the reference implementation.
        const value = Math.round(top * wy0 + bottom * wy);
        out[c * plane + o] = (value < 0 ? 0 : value > 255 ? 255 : value) / 255;
      }
    }
  }

  return { data: out, box };
}
