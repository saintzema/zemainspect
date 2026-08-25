/**
 * NEU Surface Defect Database classes, in the exact index order the model was
 * trained with (see ClosedMfgAI configs/neu_defects.yaml). Changing this order
 * silently mislabels every detection.
 */
export const NEU_CLASSES = [
  "crazing",
  "inclusion",
  "patches",
  "pitted_surface",
  "rolled-in_scale",
  "scratches",
] as const;

export type NeuClass = (typeof NEU_CLASSES)[number];

/** Bilingual display names, so a detection reads correctly on a Chinese line. */
export const DEFECT_LABELS: Record<NeuClass, { en: string; zh: string }> = {
  crazing: { en: "Crazing", zh: "龟裂" },
  inclusion: { en: "Inclusion", zh: "夹杂物" },
  patches: { en: "Patches", zh: "斑块" },
  pitted_surface: { en: "Pitted surface", zh: "麻点" },
  "rolled-in_scale": { en: "Rolled-in scale", zh: "压入氧化皮" },
  scratches: { en: "Scratches", zh: "划痕" },
};

/**
 * Per-class validation mAP@0.5 from the YOLOv8 NEU benchmark (Table IV).
 * Surfaced in the UI so an operator can see which classes the model is weak
 * on rather than trusting every box equally.
 */
export const CLASS_MAP50: Record<NeuClass, number> = {
  patches: 0.918,
  scratches: 0.844,
  pitted_surface: 0.811,
  inclusion: 0.81,
  "rolled-in_scale": 0.556,
  crazing: 0.506,
};

export type Reliability = "high" | "medium" | "low";

export function reliabilityOf(cls: string): Reliability {
  const score = CLASS_MAP50[cls as NeuClass];
  if (score === undefined) return "medium";
  if (score >= 0.84) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

export function labelFor(cls: string, language: "en" | "zh"): string {
  const entry = DEFECT_LABELS[cls as NeuClass];
  if (!entry) return cls;
  return entry[language];
}

export const PRODUCT_CATEGORIES = ["steel", "general", "automotive"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
