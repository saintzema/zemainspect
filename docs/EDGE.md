# Edge inference

Detection runs in the operator's browser by default. This is the feature that
makes ZemaInspect usable on a real production line rather than only in a demo.

## Why

Sending every frame to a serverless function looks simpler and fails in the
places that matter:

- A 1–2 MP JPEG from a plant in Zhejiang to a US region costs 200–600 ms of
  round trip *before* inference starts.
- When the uplink drops, inspection stops. Lines do not stop.
- Bandwidth and per-invocation cost scale with frame rate.

Running the model in the browser makes latency the model's own, keeps working
through an outage, uploads a few hundred bytes per result instead of an image,
and costs nothing per frame.

## Measured behaviour

All figures below were measured in headless Chromium against the committed
`yolov8n-neu.onnx`, on a shared container CPU with **no GPU**:

| | WASM | WebGPU (software) |
|---|---|---|
| Model load | ~1.9 s | ~0.5 s |
| First frame | ~0.55 s | ~28 s |
| Warm frame | **~480 ms** | ~16,000 ms |

Detections were **byte-identical** between the two backends and to the server
path — e.g. `crazing 0.2819 @ [72, 121, 105, 35]` in all three.

On real GPU hardware WebGPU is far faster than WASM. The numbers above are the
*software-emulated* case, which is the trap described next.

## Backend selection

Choosing WebGPU because it initialised is wrong. A software adapter
initialises perfectly and then runs ~33× slower than WASM. On a cheap factory
tablet that turns a real-time inspector into a stalled one.

`lib/inference/onnx-web.ts` therefore selects in three steps:

1. **Ask the adapter what it is.** `requestAdapter()` then reject
   `isFallbackAdapter`, or a vendor/description matching a known software
   rasteriser (SwiftShader, llvmpipe, lavapipe, …). Costs microseconds.
2. **Time a real warmup.** If a WebGPU session's first inference exceeds
   `WEBGPU_WARMUP_BUDGET_MS` (1500 ms), discard it. This is the backstop for
   adapters that are slow without saying so.
3. **Fall back to WASM**, warmed up before the operator's first frame.

Skipping the expensive probe when step 1 already knows the answer cut startup
from ~30 s to ~2.8 s on the software-adapter machine.

## Main-thread responsiveness

`ort.env.wasm.proxy = true` runs the WASM backend in a Web Worker. Several
hundred milliseconds of inference on the main thread would freeze the UI
between every inspection; proxying keeps the page responsive.

## Self-hosted runtime

`scripts/copy-ort-assets.mjs` copies the ONNX Runtime into `public/ort/` and
the page imports it from there, never a CDN — Chinese factory networks
routinely block public CDNs, and this is exactly the deployment the edge path
exists for.

The sidecar list is **derived, not hardcoded**. ORT picks its Emscripten module
at runtime from the browser's capabilities: the WebGPU build reaches for the
`asyncify` variant on some paths and `jsep` on others. An earlier hardcoded
list omitted `asyncify` and edge inference died with "no available backend
found" — a failure that only appears in a real browser, not in unit tests.

## Privacy

Only the detection result and an optional 192×108 thumbnail leave the plant.
The full frame never does. Operators can switch the upload off entirely and
still get live on-screen detection.
