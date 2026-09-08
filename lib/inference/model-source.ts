import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import os from "os";

import { env, envOr, hasEnv } from "@/lib/env";
import { NEU_CLASSES, type ProductCategory } from "@/lib/inference/labels";

/**
 * Where the ONNX weights come from, in priority order:
 *
 *   1. `public/models/<name>.onnx` committed in the repo (simplest; the file
 *      is ~12MB as ONNX so it fits comfortably in a git repo).
 *   2. `MODEL_URL` — any HTTPS URL, typically a Hugging Face `resolve` link.
 *      Fetched once per cold start and cached on the function's tmp disk, so
 *      warm invocations pay nothing.
 *
 * Hosting the weights on Hugging Face costs nothing and keeps large binaries
 * out of git; committing them keeps the deploy hermetic. Both work.
 *
 * This covers "steel" only — the one model this deployment ships by default.
 * `categoryModelUrl` / `categoryClasses` below are the server-side mirror of
 * `lib/inference/model-registry.ts` on the client: a `product_category` of
 * "general" or "automotive" server-side used to run these same steel weights
 * and report steel defect class names against whatever was actually
 * submitted — a car door reported as "38% patches" — because nothing here
 * ever looked at the category at all. `categoryIsConfigured` is what a
 * caller must check before running inference, the same way the browser
 * checks `isCategoryAvailable` before enabling Start.
 */

export { MODEL_INPUT_SIZE } from "@/lib/inference/postprocess";
export const DEFAULT_MODEL_FILE = "yolov8n-neu.onnx";

let inflight: Promise<Uint8Array> | null = null;
let cached: Uint8Array | null = null;

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

/** The model filename, ignoring a blank override. */
export function modelFileName(): string {
  return envOr("MODEL_FILE", DEFAULT_MODEL_FILE);
}

function bundledPath(): string {
  return path.join(process.cwd(), "public", "models", modelFileName());
}

/**
 * Whether a real file sits at `p` — not merely "something exists there".
 *
 * `existsSync` answers yes for a directory, and that is not academic: a blank
 * MODEL_FILE used to resolve this to the `public/models` directory itself, so
 * the app reported the model as configured, rendered the edge inspector, and
 * then handed the browser `/models/` to download. A 404 at the camera, from a
 * deployment that believed it was fine.
 */
function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The URL the browser downloads the weights from, served off our own origin so
 * a plant that blocks public CDNs still works. Null when this deployment has
 * no weights to serve, which is what tells the UI to hide the edge inspector
 * rather than offer a camera that cannot run.
 */
export function publicModelUrl(): string | null {
  return modelIsConfigured() ? `/models/${modelFileName()}` : null;
}

function tmpCachePath(url: string): string {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `zemainspect-model-${digest}.onnx`);
}

async function loadFromUrl(url: string): Promise<Uint8Array> {
  const cachePath = tmpCachePath(url);
  if (existsSync(cachePath)) {
    return new Uint8Array(await readFile(cachePath));
  }

  const headers: Record<string, string> = {};
  // Private Hugging Face repos need a token; public ones do not.
  const hfToken = env("HUGGINGFACE_TOKEN");
  if (hfToken) {
    headers.Authorization = `Bearer ${hfToken}`;
  }

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new ModelUnavailableError(
      `Failed to download model from MODEL_URL (${res.status} ${res.statusText})`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  await mkdir(path.dirname(cachePath), { recursive: true }).catch(() => undefined);
  await writeFile(cachePath, bytes).catch(() => undefined);
  return bytes;
}

async function resolveBytes(): Promise<Uint8Array> {
  const local = bundledPath();
  if (isFile(local)) {
    return new Uint8Array(await readFile(local));
  }

  const url = env("MODEL_URL");
  if (url) return loadFromUrl(url);

  throw new ModelUnavailableError(
    `No ONNX model available. Either commit weights to public/models/${modelFileName()} ` +
      `or set MODEL_URL to a hosted .onnx file. ` +
      `Run "python scripts/export_onnx.py --weights best.pt" to produce one.`,
  );
}

/**
 * Resolve the model bytes, memoised for the lifetime of the process. A failed
 * load clears the memo so the next request retries rather than caching a fault.
 */
export function loadModelBytes(): Promise<Uint8Array> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = resolveBytes().then(
    (bytes) => {
      cached = bytes;
      inflight = null;
      return bytes;
    },
    (err) => {
      inflight = null;
      throw err;
    },
  );

  return inflight;
}

/** True when the deployment has weights it can actually serve. */
export function modelIsConfigured(): boolean {
  return isFile(bundledPath()) || hasEnv("MODEL_URL");
}

export function modelVariantName(): string {
  return envOr("MODEL_VARIANT", "yolov8n-neu-onnx");
}

/* ---------------------------------------------------------------------- *
 * Per-category models — see the module doc comment above.
 * ---------------------------------------------------------------------- */

function categoryModelUrl(category: ProductCategory): string | null {
  return env(`MODEL_URL_${category.toUpperCase()}`) ?? null;
}

function categoryClasses(category: ProductCategory): readonly string[] | null {
  const raw = env(`MODEL_CLASSES_${category.toUpperCase()}`);
  if (!raw) return null;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

/** True when this deployment can actually run inference for `category`. */
export function categoryIsConfigured(category: ProductCategory): boolean {
  if (category === "steel") return modelIsConfigured();
  return categoryModelUrl(category) !== null && categoryClasses(category) !== null;
}

/** Class names in the index order the category's model was trained with. */
export function classNamesFor(category: ProductCategory): readonly string[] {
  if (category === "steel") return NEU_CLASSES;
  return categoryClasses(category) ?? [];
}

export function modelVariantNameFor(category: ProductCategory): string {
  if (category === "steel") return modelVariantName();
  return `custom-${category}`;
}

const categoryBytesCache = new Map<ProductCategory, Promise<Uint8Array>>();

/**
 * Resolve the ONNX weights for `category`, memoised per category for the
 * lifetime of the process — the same caching `loadModelBytes` already does
 * for steel, just keyed so a second category never evicts the first.
 */
export function loadModelBytesFor(category: ProductCategory): Promise<Uint8Array> {
  if (category === "steel") return loadModelBytes();

  const inflightForCategory = categoryBytesCache.get(category);
  if (inflightForCategory) return inflightForCategory;

  const url = categoryModelUrl(category);
  if (!url) {
    return Promise.reject(
      new ModelUnavailableError(
        `No model deployed for product_category="${category}". Set MODEL_URL_${category.toUpperCase()} ` +
          `and MODEL_CLASSES_${category.toUpperCase()} to enable it.`,
      ),
    );
  }

  const promise = loadFromUrl(url).catch((err) => {
    categoryBytesCache.delete(category);
    throw err;
  });
  categoryBytesCache.set(category, promise);
  return promise;
}
