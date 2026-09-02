import { NEU_CLASSES } from "@/lib/inference/labels";
import type { ProductCategory } from "@/lib/inference/labels";
import { env } from "@/lib/env";

/**
 * Which model serves which product category.
 *
 * Today exactly one model exists: YOLOv8n trained on the NEU Surface Defect
 * Database — six classes of rolled-steel surface defect. "General product" and
 * "automotive part" have no model behind them, and no amount of application
 * code creates one; that is a data-collection and training project.
 *
 * The point of this registry is to stop that being a lie told by a dropdown.
 * A category with no model is marked unavailable, the UI says so, and the
 * inspector refuses to run rather than reporting steel defect classes on a
 * plastic moulding — which is what it did before, since selecting a category
 * changed a label in the database and nothing about what the model saw.
 *
 * When a model for a category does exist, it drops in here: point the env var
 * at the weights, list the classes it was trained on, and the whole pipeline
 * — loading, labelling, the guard, the UI — follows without touching anything
 * else.
 */
export interface CategoryModel {
  category: ProductCategory;
  /** Public URL the browser fetches the ONNX weights from. */
  modelUrl: string | null;
  /** Class names in the exact index order the model was trained with. */
  classNames: readonly string[];
  /** Identifies which weights produced a result, for the audit trail. */
  variant: string;
  /**
   * Whether the frame guard's greyscale assumption holds. It is calibrated
   * for NEU steel; a category whose parts are legitimately coloured must not
   * inherit a threshold that would reject every real frame.
   */
  expectsGreyscale: boolean;
}

/** Env var naming, so adding a category is a deployment change, not a deploy. */
function categoryModelUrl(category: ProductCategory): string | null {
  return env(`NEXT_PUBLIC_MODEL_URL_${category.toUpperCase()}`) ?? null;
}

function categoryClasses(category: ProductCategory): readonly string[] | null {
  const raw = env(`NEXT_PUBLIC_MODEL_CLASSES_${category.toUpperCase()}`);
  if (!raw) return null;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

/**
 * Resolve the model for a category.
 *
 * `steelModelUrl` is the bundled NEU model the app already ships, passed in
 * rather than read here because only the server knows whether the weights are
 * actually present on this deployment.
 */
export function modelForCategory(
  category: ProductCategory,
  steelModelUrl: string | null,
): CategoryModel {
  if (category === "steel") {
    return {
      category,
      modelUrl: steelModelUrl,
      classNames: NEU_CLASSES,
      variant: "yolov8n-neu-web",
      expectsGreyscale: true,
    };
  }

  const url = categoryModelUrl(category);
  return {
    category,
    modelUrl: url,
    classNames: categoryClasses(category) ?? [],
    variant: `custom-${category}`,
    // A category whose model was supplied by the operator makes no claim
    // about greyscale, so the colour guard does not apply to it.
    expectsGreyscale: false,
  };
}

/** True when this deployment can actually inspect the category. */
export function isCategoryAvailable(
  category: ProductCategory,
  steelModelUrl: string | null,
): boolean {
  const model = modelForCategory(category, steelModelUrl);
  return model.modelUrl !== null && model.classNames.length > 0;
}
