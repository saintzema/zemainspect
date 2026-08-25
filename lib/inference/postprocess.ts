import { NEU_CLASSES } from "@/lib/inference/labels";

export interface Detection {
  type: string;
  confidence: number;
  /** [x, y, w, h] in ORIGINAL image pixel coordinates. */
  bbox: [number, number, number, number];
}

/**
 * Detections are stored in a Prisma `Json` column. Prisma's InputJsonValue
 * does not accept an interface with named properties directly, so this is the
 * single sanctioned place that widens the type for persistence.
 */
export function detectionsAsJson(detections: Detection[]) {
  return detections as unknown as import("@/lib/generated/prisma").Prisma.InputJsonValue;
}

export interface LetterboxInfo {
  /** Uniform scale applied to the original image before padding. */
  scale: number;
  /** Padding added on the left and top, in model-input pixels. */
  padX: number;
  padY: number;
  originalWidth: number;
  originalHeight: number;
}

export interface DecodeOptions {
  confidenceThreshold?: number;
  iouThreshold?: number;
  maxDetections?: number;
  classNames?: readonly string[];
}

export const DEFAULT_CONFIDENCE = 0.25;
export const DEFAULT_IOU = 0.45;

/**
 * Compute the letterbox transform for fitting `srcW x srcH` into a square
 * model input of `size`, preserving aspect ratio and centring the result.
 */
export function letterboxInfo(srcW: number, srcH: number, size: number): LetterboxInfo {
  const scale = Math.min(size / srcW, size / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  return {
    scale,
    padX: Math.floor((size - drawW) / 2),
    padY: Math.floor((size - drawH) / 2),
    originalWidth: srcW,
    originalHeight: srcH,
  };
}

/**
 * Decode a raw YOLOv8 detection head into boxes in original-image space.
 *
 * Expected output layout is [1, 4 + numClasses, numAnchors] — the Ultralytics
 * export format. Row 0..3 are cx, cy, w, h in model-input pixels; the
 * remaining rows are per-class scores. There is no separate objectness term in
 * v8, so the class score IS the confidence.
 */
export function decodeYolov8(
  raw: Float32Array,
  dims: readonly number[],
  box: LetterboxInfo,
  options: DecodeOptions = {},
): Detection[] {
  const {
    confidenceThreshold = DEFAULT_CONFIDENCE,
    iouThreshold = DEFAULT_IOU,
    maxDetections = 100,
    classNames = NEU_CLASSES,
  } = options;

  if (dims.length !== 3) {
    throw new Error(`Unexpected YOLO output rank ${dims.length}; expected [1, 4+nc, anchors]`);
  }
  const [, channels, anchors] = dims;
  const numClasses = channels - 4;
  if (numClasses <= 0) {
    throw new Error(`Unexpected YOLO output shape [${dims.join(", ")}]`);
  }
  if (numClasses !== classNames.length) {
    throw new Error(
      `Model has ${numClasses} classes but ${classNames.length} label names were supplied. ` +
        `The weights and label list are out of sync.`,
    );
  }

  const candidates: Detection[] = [];

  for (let i = 0; i < anchors; i++) {
    // Find the winning class for this anchor before doing any box maths.
    let bestScore = 0;
    let bestClass = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = raw[(4 + c) * anchors + i];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestClass < 0 || bestScore < confidenceThreshold) continue;

    const cx = raw[0 * anchors + i];
    const cy = raw[1 * anchors + i];
    const w = raw[2 * anchors + i];
    const h = raw[3 * anchors + i];

    // Undo the letterbox: strip padding, then undo the uniform scale.
    const x = (cx - w / 2 - box.padX) / box.scale;
    const y = (cy - h / 2 - box.padY) / box.scale;
    const bw = w / box.scale;
    const bh = h / box.scale;

    // Clamp to the image; a box half off the edge is still a real defect.
    const x0 = Math.max(0, Math.min(x, box.originalWidth));
    const y0 = Math.max(0, Math.min(y, box.originalHeight));
    const x1 = Math.max(0, Math.min(x + bw, box.originalWidth));
    const y1 = Math.max(0, Math.min(y + bh, box.originalHeight));
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;

    candidates.push({
      type: classNames[bestClass],
      confidence: bestScore,
      bbox: [
        Math.round(x0),
        Math.round(y0),
        Math.round(x1 - x0),
        Math.round(y1 - y0),
      ],
    });
  }

  return nonMaxSuppression(candidates, iouThreshold).slice(0, maxDetections);
}

function iou(a: Detection["bbox"], b: Detection["bbox"]): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const interX = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const interY = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const inter = interX * interY;
  if (inter <= 0) return 0;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy NMS applied per class, so overlapping different defects both survive. */
export function nonMaxSuppression(dets: Detection[], iouThreshold: number): Detection[] {
  const byClass = new Map<string, Detection[]>();
  for (const d of dets) {
    const list = byClass.get(d.type);
    if (list) list.push(d);
    else byClass.set(d.type, [d]);
  }

  const kept: Detection[] = [];
  for (const list of byClass.values()) {
    list.sort((a, b) => b.confidence - a.confidence);
    const survivors: Detection[] = [];
    for (const cand of list) {
      if (survivors.every((s) => iou(s.bbox, cand.bbox) <= iouThreshold)) {
        survivors.push(cand);
      }
    }
    kept.push(...survivors);
  }

  return kept.sort((a, b) => b.confidence - a.confidence);
}
