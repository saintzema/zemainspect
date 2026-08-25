# ZemaInspect

**See every defect. Speak every language.**

Real-time AI surface-defect detection for small and medium manufacturers.
Runs on the cameras a factory already owns, bilingual EN/中文 from the first
screen, and priced per inspection instead of per hardware quote.

Built by [Zema AI Labs](https://zemaai.com). The detection model comes from the
[ClosedMfgAI](https://github.com/saintzema/ClosedMfgAI) YOLOv8 benchmark on the
NEU Surface Defect Database.

---

## What it does

- **REST API** — `POST /api/v1/inspect` with a frame, get back defect classes,
  confidences and bounding boxes.
- **Edge inference** — the same model runs *in the operator's browser* via
  WebGPU/WASM. Frames never leave the plant, latency is the model's own
  ~10–40 ms, and a dropped uplink does not stop the line.
- **Live dashboard** — inspection feed, defect-rate trends, per-class breakdown.
- **Compliance export** — ISO 9001 / IATF 16949-style PDF over any date range.
- **Integrations** — signed webhooks into an existing MES/ERP, CSV export for
  factories whose "system" is a spreadsheet, and a batch endpoint for
  end-of-shift QC.
- **Billing** — Paystack (NGN and African cards) and Stripe (international),
  behind one provider-agnostic interface.
- **Admin console** — MRR, churn, per-org usage, and a one-click *grant free Pro
  access* button for hand-managed pilot factories.

## Why the edge path matters

The obvious architecture — ship every frame to a serverless function — does not
survive contact with a factory floor in Zhejiang. A 1–2 MP frame over a
congested uplink to a US region costs 200–600 ms round trip before inference
even starts, and stops entirely when the link drops.

So detection runs in the browser by default. Only the *result* (a few hundred
bytes) and an optional 192×108 thumbnail are uploaded. The server path exists
for API and batch callers, and as the fallback. Both paths share the exact same
decode code in `lib/inference/postprocess.ts`, so their geometry cannot drift.

This is also the cheapest configuration that works: browser inference costs
nothing per frame, and YOLOv8n is 3.0 M parameters — small enough to download
once and cache.

## Model

The benchmark behind the model selection (`results/benchmark_table.md` in
ClosedMfgAI):

| Model | mAP@0.5 | Params | T4 latency |
|---|---|---|---|
| YOLOv8l | 74.1% | 43.6 M | 15.8 ms |
| **YOLOv8n** | **73.6%** | **3.0 M** | **2.1 ms** |
| YOLOv8s | 73.3% | 11.2 M | ~4 ms |
| YOLOv8m | 73.2% | 25.9 M | 9.7 ms |

YOLOv8n gives up 0.5 points of mAP for a 14× parameter reduction and roughly 7×
lower latency. For an edge-first product that is not a trade-off, it is the
answer — and it is what makes in-browser inference viable at all.

Per-class accuracy varies a lot (patches 91.8%, crazing 50.6%). The UI surfaces
that: low-reliability classes are badged, and the compliance PDF states it in
writing rather than presenting one accuracy number to an auditor.

**The weights are in this repo.** `weights/yolov8n_neu_best.pt` is the trained
checkpoint; `public/models/yolov8n-neu.onnx` is the deployed export. Both are
committed so the build is hermetic and the browser can fetch the model from our
own origin. See [docs/MODEL.md](docs/MODEL.md) to re-export or swap them.

### Verified against the reference implementation

The app does its own letterboxing, YOLOv8 decode and NMS in TypeScript so the
server and the browser can share one code path. That is a correctness risk: a
subtly wrong decode yields confident boxes in the *wrong place*, which on a
production line is worse than no detection. So there is a parity harness:

```bash
.venv/bin/python scripts/reference_predict.py ref.json samples/*.jpg
npx tsx scripts/verify-parity.ts ./samples ./ref.json
```

It runs Ultralytics' own pipeline over the same weights and images and compares
box-for-box. Current result: **28/28 detections matched, worst box IoU 0.9636,
worst confidence difference 0.0038.**

Getting there required implementing the resize ourselves
(`lib/inference/preprocess.ts`). `sharp` silently ignores its `kernel` option
when enlarging, and neither it nor canvas `drawImage` reproduces OpenCV's
`INTER_LINEAR`, which the model was trained against. Measured on these weights,
letting the image library choose shifted detection confidence by up to **0.10**
— enough to flip a pass/fail at the 0.25 default — and moved box edges several
pixels. The shared resampler also means the server and the edge path produce
identical output for the same frame.

## Quick start

```bash
npm install
cp .env.example .env.local          # fill in DATABASE_URL at minimum
npx prisma migrate deploy
npx tsx prisma/seed.ts              # demo org + ~1k inspections + an API key
npm run dev
```

The model ships with the repo, so inspection works immediately.

Open http://localhost:3000. The seed prints an API key once:

```bash
curl -X POST http://localhost:3000/api/v1/inspect \
  -H "Authorization: Bearer zi_live_..." \
  -F "image=@frame.jpg" \
  -F "product_category=steel" \
  -F "line_id=press-line-1"
```

Real response, measured end to end on this build:

```json
{
  "inspection_id": "cmt8dydr800017dy4ciof1zyn",
  "result": "fail",
  "defects": [
    { "type": "crazing", "confidence": 0.2819, "bbox": [72, 121, 105, 35] },
    { "type": "scratches", "confidence": 0.1244, "bbox": [5, 189, 194, 11] }
  ],
  "model_variant": "yolov8n-neu-onnx",
  "processing_time_ms": 110
}
```

Warm server inference measures ~105–125 ms per frame on a shared CPU. The
browser edge path is faster still and does not cross the network at all.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 14 App Router, TypeScript |
| Styling | Tailwind, custom glassmorphism system on CSS variables |
| Database | Postgres (Neon), Prisma |
| Auth | NextAuth — magic link + Google |
| Inference | `onnxruntime-node` (server) · `onnxruntime-web` (browser) |
| Billing | Paystack + Stripe |
| Charts | Recharts |
| PDF | `@react-pdf/renderer` |

## Layout

```
app/
  (marketing)/        landing + pricing
  (dashboard)/        feed, trends, reports, api-keys, billing, team, settings
  admin/              founder console (SUPER_ADMIN only, violet accent)
  api/v1/inspect      the public inspection API
  api/webhooks/       paystack + stripe
components/
  ui/glass/           GlassPanel / Card / Button / Input primitives
  ui/language-toggle-fab.tsx
  dashboard/          feed, charts, edge inspector, settings
  admin/              org table, MRR overview
lib/
  inference/          labels · postprocess (shared) · onnx-node · onnx-web
  billing/            provider interface + paystack + stripe + sync
  i18n/               en.json · zh.json · LanguageProvider
  analytics.ts        trend and defect aggregation (SQL-side)
prisma/               schema, migrations, seed
scripts/              export_onnx.py, copy-ort-assets.mjs
tests/                decode maths + letterbox geometry
```

## Commands

```bash
npm run dev         # dev server (copies the ORT runtime first)
npm run build       # prisma generate + migrate deploy + next build
npm test            # vitest — 22 tests
npm run typecheck
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Short version: Vercel + Neon, set
the env vars from `.env.example`, point the Paystack and Stripe webhooks at
`/api/webhooks/paystack` and `/api/webhooks/stripe`, and deploy the model per
`docs/MODEL.md`.

## Licence

Proprietary — © Zema AI Labs.
