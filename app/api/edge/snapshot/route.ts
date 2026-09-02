import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgSession } from "@/lib/auth";
import { hasEnv } from "@/lib/env";
import { storeInspectionImage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Archive an operator-captured frame, bounding boxes and all.
 *
 * Distinct from the automatic per-inspection thumbnail: that is a 192px
 * postage stamp uploaded on a throttle to keep the feed illustrated. This is a
 * deliberate act — an operator saw something and pressed the button — so it
 * keeps the full annotated frame at full resolution, and is never throttled or
 * sampled. Those are the frames that end up in a supplier dispute, a scrap
 * report, or the training set for the next model.
 *
 * Deliberately does NOT create an Inspection row or touch the usage counter:
 * this is a copy of a frame that was already inspected, not a second
 * inspection, and billing an operator twice for pressing "save" would be
 * indefensible.
 */
const schema = z.object({
  /** data: URL of the composited frame. ~8 MB ceiling for a 1080p PNG. */
  image: z.string().min(32).max(8_000_000),
  note: z.string().trim().max(500).optional(),
});

/** Parse a data: URL into raw bytes plus its declared content type. */
function decodeDataUrl(value: string): { buffer: Buffer; contentType: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(value);
  if (!match) return null;
  try {
    return { contentType: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await requireOrgSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { image } as a data URL" }, { status: 400 });
  }

  /*
   * Answer "not configured" distinctly from "upload failed". The operator's
   * next step is completely different — set an environment variable, versus
   * retry — and storeInspectionImage collapses both to null.
   */
  if (!hasEnv("BLOB_READ_WRITE_TOKEN")) {
    return NextResponse.json(
      {
        error:
          "Cloud archive is not set up on this deployment. Add a BLOB_READ_WRITE_TOKEN " +
          "environment variable (Vercel → Storage → Blob) to enable saving snapshots.",
        code: "blob_not_configured",
      },
      { status: 503 },
    );
  }

  const decoded = decodeDataUrl(parsed.data.image);
  if (!decoded) {
    return NextResponse.json(
      { error: "Image must be a base64 data URL of a PNG, JPEG or WebP" },
      { status: 400 },
    );
  }

  const url = await storeInspectionImage(
    session.user.organizationId!,
    decoded.buffer,
    decoded.contentType,
  );

  if (!url) {
    return NextResponse.json(
      { error: "Could not upload the snapshot. Check the blob token and try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, url });
}
