# Webhooks

ZemaInspect POSTs every inspection result to a URL you configure, so your MES
or ERP never has to poll. Configure it under **Settings → Result webhook**.

## Payload

```http
POST https://mes.yourfactory.com/hooks/zemainspect
Content-Type: application/json
X-ZemaInspect-Signature: 3f9a1c...
X-ZemaInspect-Timestamp: 1756089600
```

```json
{
  "inspection_id": "insp_cm3x...",
  "organization_id": "org_cm3x...",
  "result": "fail",
  "defects": [
    { "type": "scratches", "confidence": 0.9134, "bbox": [120, 64, 88, 32] }
  ],
  "product_category": "steel",
  "line_id": "press-line-1",
  "image_url": "https://....public.blob.vercel-storage.com/...",
  "model_variant": "yolov8n-neu-onnx",
  "processing_time_ms": 42,
  "processed_at": "2026-09-01T12:00:00.000Z"
}
```

`bbox` is `[x, y, width, height]` in pixels of the **original submitted image**,
top-left origin.

`defects` is empty and `result` is `"pass"` when nothing was detected above the
confidence threshold.

## Verifying the signature

Do this before trusting the payload. The signature is
`HMAC-SHA256(secret, "{timestamp}.{raw_body}")`, hex-encoded.

The timestamp is inside the signed material specifically so a captured request
cannot be replayed later — reject anything older than a few minutes.

### Node

```js
import { createHmac, timingSafeEqual } from "crypto";

function verify(rawBody, headers, secret) {
  const signature = headers["x-zemainspect-signature"];
  const timestamp = Number(headers["x-zemainspect-timestamp"]);

  // Reject stale requests (replay protection).
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature ?? "", "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### Python

```python
import hmac, hashlib, time

def verify(raw_body: bytes, headers, secret: str) -> bool:
    signature = headers.get("X-ZemaInspect-Signature", "")
    try:
        timestamp = int(headers.get("X-ZemaInspect-Timestamp", "0"))
    except ValueError:
        return False

    if abs(time.time() - timestamp) > 300:
        return False

    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

**Use the raw request bytes.** Re-serialising the parsed JSON changes
whitespace and key order, and the signature will not match.

## Threshold alerts

If you set a defect-rate threshold under **Settings → Defect rate alerts**, the
same endpoint also receives:

```json
{
  "event": "defect_rate_threshold_exceeded",
  "organization_id": "org_cm3x...",
  "window_start": "2026-09-01T11:00:00.000Z",
  "window_end": "2026-09-01T12:00:00.000Z",
  "defect_rate": 0.0731,
  "threshold": 0.05,
  "inspections": 342,
  "defects": 25
}
```

Checked every 15 minutes over a rolling one-hour window. A window with fewer
than 20 inspections is skipped — too small a sample to act on. At most one
alert per organization per hour.

## Delivery behaviour

Delivery is **fire-and-forget with a 5-second timeout and no retry**. A slow or
down endpoint must never hold up an inspection response or stall the line.

If you need guaranteed delivery, treat the webhook as a fast path and reconcile
against `GET /api/inspections` (or the CSV export) on a schedule.

Use **Send test event** in Settings to fire a representative payload — it is
signed identically, so it exercises your verification code for real.
