/**
 * How a detection's confidence maps to what an operator sees.
 *
 * Shared between the edge inspector's canvas overlay (a CSS colour string)
 * and its badge list (a `Badge` tone), so the two never disagree about which
 * detections count as "the ones to worry about" — plain-language-testable in
 * one place rather than duplicated in JSX and canvas drawing code.
 */

export const HIGH_CONFIDENCE = 0.65;
export const MEDIUM_CONFIDENCE = 0.4;

/** Colour tier by detection confidence, as an rgba() string for canvas drawing. */
export function severityColor(confidence: number): string {
  if (confidence >= HIGH_CONFIDENCE) return "rgba(248, 81, 73, 0.95)"; // red
  if (confidence >= MEDIUM_CONFIDENCE) return "rgba(251, 146, 60, 0.95)"; // amber
  return "rgba(250, 204, 21, 0.95)"; // yellow — only seen at higher sensitivity
}

/** Badge tone for the same tiers, collapsed to the two tones Badge supports. */
export function severityTone(confidence: number): "fail" | "warn" {
  return confidence >= MEDIUM_CONFIDENCE ? "fail" : "warn";
}
