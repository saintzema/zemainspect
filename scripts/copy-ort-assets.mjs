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
 * Only the files the webgpu build actually needs are copied; the package
 * ships ~26 variants and shipping all of them would bloat the deploy.
 */

import { mkdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ENTRY = "ort.webgpu.min.mjs"; // WebGPU backend with a WASM fallback

const FILES = [
  ENTRY,
  // Emscripten loaders + binaries for each backend the entry can select.
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

const source = path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist");
const target = path.join(process.cwd(), "public", "ort");

if (!existsSync(source)) {
  console.warn("[ort-assets] onnxruntime-web not installed; skipping.");
  process.exit(0);
}

await mkdir(target, { recursive: true });

let bytes = 0;
for (const name of FILES) {
  const from = path.join(source, name);
  if (!existsSync(from)) {
    console.error(`[ort-assets] missing expected file: ${name}`);
    process.exit(1);
  }
  await copyFile(from, path.join(target, name));
  bytes += (await stat(from)).size;
}

console.log(
  `[ort-assets] copied ${FILES.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) to public/ort/`,
);
