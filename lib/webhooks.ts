import { createHmac, randomBytes } from "crypto";

import type { Detection } from "@/lib/inference/postprocess";

export const SIGNATURE_HEADER = "X-ZemaInspect-Signature";
export const TIMESTAMP_HEADER = "X-ZemaInspect-Timestamp";

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Sign a webhook body.
 *
 * The timestamp is inside the signed payload so a captured request cannot be
 * replayed later — receivers should reject anything older than a few minutes.
 * Documented for customers in docs/WEBHOOKS.md.
 */
export function signWebhook(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export interface InspectionWebhookPayload {
  inspection_id: string;
  organization_id: string;
  result: "pass" | "fail";
  defects: Array<{ type: string; confidence: number; bbox: number[] }>;
  product_category: string;
  line_id?: string | null;
  image_url?: string | null;
  model_variant: string;
  processing_time_ms: number;
  processed_at: string;
}

export function buildInspectionPayload(job: {
  id: string;
  organizationId: string;
  result: "PASS" | "FAIL";
  defects: Detection[];
  productCategory: string;
  lineId: string | null;
  imageUrl: string | null;
  modelVariant: string;
  processingTimeMs: number;
  createdAt: Date;
}): InspectionWebhookPayload {
  return {
    inspection_id: job.id,
    organization_id: job.organizationId,
    result: job.result === "PASS" ? "pass" : "fail",
    defects: job.defects.map((d) => ({
      type: d.type,
      confidence: Number(d.confidence.toFixed(4)),
      bbox: d.bbox,
    })),
    product_category: job.productCategory,
    line_id: job.lineId,
    image_url: job.imageUrl,
    model_variant: job.modelVariant,
    processing_time_ms: job.processingTimeMs,
    processed_at: job.createdAt.toISOString(),
  };
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Deliver one webhook. Deliberately short-timeout and non-retrying: a slow
 * customer endpoint must never hold up the inspection response. Failures are
 * surfaced in the dashboard rather than queued.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: unknown,
  timeoutMs = 5000,
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ZemaInspect-Webhook/1.0",
        [SIGNATURE_HEADER]: signWebhook(body, secret, timestamp),
        [TIMESTAMP_HEADER]: String(timestamp),
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
