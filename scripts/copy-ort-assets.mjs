#!/usr/bin/env node
/**
 * Copy the onnxruntime-web runtime into public/ort/.
 *
 * Two reasons this is self-hosted rather than pulled from a CDN:
 *
 *  1. Factory networks — Chinese ones especially — routinely block public
 *     CDNs, and edge inference has to start reliably on the shop floor.
 *  2. The browser loads ort as a native ES module straight from this
 *     directory (see lib/inference/onnx-web.ts), which sidesteps bundling
 *     its prebuilt .mjs entirely.
 *
 * The sidecar list is DERIVED, not hardcoded. ORT picks its Emscripten module
 * at runtime based on the browser's capabilities — the WebGPU build reaches
 * for the `asyncify` variant on some paths and the `jsep` one on others — so a
 * hand-maintained list silently misses a file and edge inference dies with
 * "no available backend found" only in the browsers that need the missing one.
 * Copying every `ort-wasm-*` sidecar costs disk and removes a whole class of
 * production-only failure.
 */

import { mkdir, copyFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ENTRY = "ort.webgpu.min.mjs"; // WebGPU backend with a WASM fallback

const source = path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist");
const target = path.join(process.cwd(), "public", "ort");

if (!existsSync(source)) {
  console.warn("[ort-assets] onnxruntime-web not installed; skipping.");
  process.exit(0);
}

const available = await readdir(source);

if (!available.includes(ENTRY)) {
  console.error(`[ort-assets] entry ${ENTRY} not found in ${source}`);
  process.exit(1);
}

// The entry plus every Emscripten sidecar it may load at runtime.
const files = [ENTRY, ...available.filter((n) => /^ort-wasm-.*\.(mjs|wasm)$/.test(n))];

await mkdir(target, { recursive: true });

let bytes = 0;
for (const name of files) {
  await copyFile(path.join(source, name), path.join(target, name));
  bytes += (await stat(path.join(source, name))).size;
}

console.log(
  `[ort-assets] copied ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) to public/ort/`,
);
