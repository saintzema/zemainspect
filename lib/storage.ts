import { put } from "@vercel/blob";

import { env, hasEnv } from "@/lib/env";

/**
 * Persist an inspected frame.
 *
 * Storage is optional by design: a line running 25k frames a month does not
 * necessarily want every frame retained, and edge-mode inspections upload only
 * a thumbnail. When no blob token is configured we simply keep no image rather
 * than failing the inspection.
 */
export async function storeInspectionImage(
  organizationId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  if (!hasEnv("BLOB_READ_WRITE_TOKEN")) return null;

  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";

  try {
    const blob = await put(
      `inspections/${organizationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
      buffer,
      {
        access: "public",
        contentType,
        token: env("BLOB_READ_WRITE_TOKEN"),
        addRandomSuffix: false,
      },
    );
    return blob.url;
  } catch (err) {
    console.error("Blob upload failed; continuing without an image:", err);
    return null;
  }
}
