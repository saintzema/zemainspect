import type { Detection } from "@/lib/inference/postprocess";

/**
 * Temporal confirmation: only report a defect once it has held still across
 * several consecutive frames.
 *
 * A single-frame detector re-decides the world from scratch 1-2 times a
 * second. Sensor noise, a glare highlight sliding across a moving part, or a
 * momentarily ambiguous texture each produce a box that appears for one frame
 * and vanishes. Every one of those is logged as a failed inspection, and on a
 * production line that is a part pulled off the belt for nothing.
 *
 * Requiring N consecutive sightings of the *same* defect in the *same place*
 * costs a little latency — a real defect is flagged N frames late — and
 * removes the entire class of one-frame flickers, which are by definition the
 * ones that cannot survive the requirement. That trade is the right way round
 * for inspection: a defect on a moving line stays in view for many frames, so
 * N is cheap; a flicker never does, so it is filtered.
 *
 * The tracker is deliberately pure and frame-indexed rather than clock-based:
 * inference latency on a factory tablet swings between 0.9s and 5s per frame,
 * so anything measured in wall-clock milliseconds would behave differently on
 * every device. Frames are the unit the operator actually sees.
 */

/** Consecutive sightings required before a detection is reported. */
export const DEFAULT_CONFIRM_FRAMES = 2;
/** How many frames a track survives without a match before being dropped. */
export const DEFAULT_TRACK_TTL_FRAMES = 2;
/** Boxes overlapping at least this much are treated as the same defect. */
export const DEFAULT_MATCH_IOU = 0.3;

export interface TemporalOptions {
  confirmFrames?: number;
  trackTtlFrames?: number;
  matchIou?: number;
}

interface Track {
  detection: Detection;
  /** Consecutive frames this track has been seen in. */
  hits: number;
  /** Frames since it was last matched. */
  missed: number;
}

/** Intersection-over-union of two [x, y, w, h] boxes. */
export function iou(a: Detection["bbox"], b: Detection["bbox"]): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;

  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);

  const overlapW = x2 - x1;
  const overlapH = y2 - y1;
  if (overlapW <= 0 || overlapH <= 0) return 0;

  const intersection = overlapW * overlapH;
  const union = aw * ah + bw * bh - intersection;
  return union > 0 ? intersection / union : 0;
}

export class DetectionTracker {
  private tracks: Track[] = [];
  private readonly confirmFrames: number;
  private readonly trackTtlFrames: number;
  private readonly matchIou: number;

  constructor(options: TemporalOptions = {}) {
    this.confirmFrames = Math.max(1, options.confirmFrames ?? DEFAULT_CONFIRM_FRAMES);
    this.trackTtlFrames = Math.max(0, options.trackTtlFrames ?? DEFAULT_TRACK_TTL_FRAMES);
    this.matchIou = options.matchIou ?? DEFAULT_MATCH_IOU;
  }

  /** Forget everything — call when the camera stops, or the scene changes. */
  reset(): void {
    this.tracks = [];
  }

  /**
   * Feed one frame's raw detections; get back only those confirmed across
   * enough consecutive frames.
   *
   * A confirmed track keeps reporting the freshest box it matched, so the
   * overlay tracks the defect as the part moves rather than freezing on
   * wherever it was first seen.
   */
  update(detections: Detection[]): Detection[] {
    const unmatched = new Set(this.tracks);

    for (const detection of detections) {
      let best: Track | null = null;
      let bestScore = this.matchIou;

      for (const track of unmatched) {
        // Class must agree: a scratch turning into an inclusion in the same
        // spot is two different findings, not one continuing one.
        if (track.detection.type !== detection.type) continue;
        const score = iou(track.detection.bbox, detection.bbox);
        if (score >= bestScore) {
          bestScore = score;
          best = track;
        }
      }

      if (best) {
        best.detection = detection;
        best.hits += 1;
        best.missed = 0;
        unmatched.delete(best);
      } else {
        this.tracks.push({ detection, hits: 1, missed: 0 });
      }
    }

    // Anything not seen this frame ages. Note hits resets to zero rather than
    // decrementing: "consecutive" has to mean consecutive, or a defect
    // flickering on alternate frames would eventually accumulate its way to
    // confirmation — precisely the noise this exists to reject.
    for (const track of unmatched) {
      track.missed += 1;
      track.hits = 0;
    }
    this.tracks = this.tracks.filter((t) => t.missed <= this.trackTtlFrames);

    return this.tracks
      .filter((t) => t.hits >= this.confirmFrames)
      .map((t) => t.detection);
  }

  /** Tracks seen at least once but not yet confirmed — for a "watching" hint. */
  pendingCount(): number {
    return this.tracks.filter((t) => t.hits > 0 && t.hits < this.confirmFrames).length;
  }
}
