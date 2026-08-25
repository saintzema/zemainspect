import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

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

function bundledPath(): string {
  const file = process.env.MODEL_FILE ?? DEFAULT_MODEL_FILE;
  return path.join(process.cwd(), "public", "models", file);
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
  if (process.env.HUGGINGFACE_TOKEN) {
    headers.Authorization = `Bearer ${process.env.HUGGINGFACE_TOKEN}`;
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
  if (existsSync(local)) {
    return new Uint8Array(await readFile(local));
  }

  const url = process.env.MODEL_URL;
  if (url) return loadFromUrl(url);

  throw new ModelUnavailableError(
    `No ONNX model available. Either commit weights to public/models/${
      process.env.MODEL_FILE ?? DEFAULT_MODEL_FILE
    } or set MODEL_URL to a hosted .onnx file. ` +
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
  return existsSync(bundledPath()) || !!process.env.MODEL_URL;
}

export function modelVariantName(): string {
  return process.env.MODEL_VARIANT ?? "yolov8n-neu-onnx";
}
