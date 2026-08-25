# API reference

Base URL: `https://<your-app>/api/v1`

All requests authenticate with an API key created under **API keys** in the
dashboard:

```
Authorization: Bearer zi_live_...
```

Keys are stored only as a SHA-256 hash, so the plaintext is shown exactly once
at creation. Revoking a key takes effect immediately.

---

## `POST /v1/inspect`

Inspect one frame.

**Body:** `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `image` | file | yes | JPEG/PNG/WebP, max 12 MB |
| `product_category` | string | no | `steel` (default), `general`, `automotive` |
| `line_id` | string | no | Free-form, shown in the dashboard and trends |
| `store_image` | boolean | no | `false` skips retention for high-volume lines |
| `confidence` | number | no | 0.01–0.99, default 0.25 |

**200**

```json
{
  "inspection_id": "insp_cm3x...",
  "result": "fail",
  "defects": [
    { "type": "scratches", "confidence": 0.9134, "bbox": [120, 64, 88, 32] }
  ],
  "model_variant": "yolov8n-neu-onnx",
  "processing_time_ms": 42,
  "processed_at": "2026-09-01T12:00:00.000Z"
}
```

`result` is `"fail"` when at least one defect is above threshold, otherwise
`"pass"`. `bbox` is `[x, y, width, height]` in original-image pixels.

A `"degraded": true` field means the external high-accuracy service was
unreachable and the request was served by the local model instead.

**Defect classes:** `crazing`, `inclusion`, `patches`, `pitted_surface`,
`rolled-in_scale`, `scratches`.

Accuracy is not uniform across them — `patches` and `scratches` validate above
84% mAP@0.5, `crazing` and `rolled-in_scale` around 50–56%. Treat a
low-confidence hit on a weak class as a prompt for human review, not a verdict.

---

## `POST /v1/inspect/batch`

End-of-shift batches rather than live line inspection.

| Field | Type | Notes |
|---|---|---|
| `images` | file[] | 1–20 per call |
| `product_category` | string | as above |
| `line_id` | string | as above |
| `store_images` | boolean | as above |

**202**

```json
{
  "batch_id": "batch_cm3x...",
  "status": "completed",
  "total": 12,
  "processed": 12,
  "failed": 0,
  "status_url": "/api/v1/inspect/batch/batch_cm3x..."
}
```

`status` is `"partial"` if the call hit its time budget before finishing;
resubmit the remainder as a new batch. Images are processed in order and each
counts against your monthly quota.

## `GET /v1/inspect/batch/:id`

```json
{
  "batch_id": "batch_cm3x...",
  "status": "completed",
  "total": 12,
  "processed": 12,
  "failed": 0,
  "results": [
    {
      "inspection_id": "insp_...",
      "result": "pass",
      "defects": [],
      "image_url": null,
      "processing_time_ms": 38,
      "processed_at": "2026-09-01T12:00:00.000Z"
    }
  ]
}
```

---

## Errors

Every error has the same shape:

```json
{ "error": { "code": "quota_exceeded", "message": "..." } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `missing_image` / `invalid_parameters` / `invalid_body` | malformed request |
| 401 | `missing_api_key` / `invalid_api_key` | bad or revoked key |
| 402 | `trial_expired` / `subscription_inactive` | upgrade needed |
| 413 | `image_too_large` / `batch_too_large` | over the size cap |
| 422 | `inference_failed` | the file was not a readable image |
| 429 | `quota_exceeded` | monthly limit reached on a trial |
| 503 | `model_unavailable` | no weights deployed — see docs/MODEL.md |

**Quota behaviour differs by plan on purpose.** Trials stop at the limit. Paid
plans keep inspecting and bill overage at $0.01 per inspection — a factory
hates being cut off mid-shift more than it hates a small line item.

---

## Other surfaces

- **Webhooks** — results pushed to your MES/ERP. See [WEBHOOKS.md](WEBHOOKS.md).
- **CSV** — `GET /api/inspections?format=csv` (session-authenticated), or the
  **Export** button on the feed and trends pages.
- **Compliance PDF** — `GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&lang=en`
  (session-authenticated, Pro and above).
