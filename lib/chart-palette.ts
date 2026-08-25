import { NEU_CLASSES, type NeuClass } from "@/lib/inference/labels";

/**
 * Fixed slot assignment: defect class -> categorical colour.
 *
 * Colour follows the entity, never its rank. Filtering the chart to three
 * classes must not repaint them, so this map is keyed by class name and the
 * slot order never changes. The hex values live in globals.css, per mode.
 */
export const SERIES_VAR: Record<NeuClass, string> = {
  crazing: "var(--series-1)",
  inclusion: "var(--series-2)",
  patches: "var(--series-3)",
  pitted_surface: "var(--series-4)",
  "rolled-in_scale": "var(--series-5)",
  scratches: "var(--series-6)",
};

export function colorForDefect(type: string): string {
  return SERIES_VAR[type as NeuClass] ?? "var(--series-1)";
}

export const DEFECT_SLOT_ORDER: readonly NeuClass[] = NEU_CLASSES;
