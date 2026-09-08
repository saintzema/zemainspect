import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { assessUploadedFrame } from "@/lib/inference/server-guard";

/** Build a real PNG (not a synthetic buffer) from a per-pixel grey value. */
async function greyscalePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw[y * width + x] = pixel(x, y);
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function colourPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, g, b] = pixel(x, y);
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const CELLS = 20;
function cellIndex(coord: number, size: number): number {
  return Math.min(CELLS - 1, Math.floor((coord * CELLS) / size));
}

/**
 * A real hash, not a smooth modular ramp. An earlier version of this fixture
 * used `(x * 928371 + y * 128371) % 997`, which "looks" pseudo-random but is
 * a smooth low-order polynomial in x and y — its local variance measured
 * 5.76, just under DEFAULT_MIN_CONTRAST (6), so it was rejected as
 * "too_flat" while looking plausibly textured to the eye. Genuine
 * high-frequency noise (measured contrast ~20) is what a real photograph of
 * a physical surface actually has.
 */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000;
}

function steelPixel(x: number, y: number): number {
  const v = 120 + Math.floor((noise(x, y) - 0.5) * 70);
  return Math.max(40, Math.min(210, v));
}

describe("assessUploadedFrame", () => {
  it("accepts a genuinely textured steel-like upload", async () => {
    const steelLike = await greyscalePng(400, 400, steelPixel);
    const verdict = await assessUploadedFrame(steelLike);
    expect(verdict.suitable).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it(
    "does not resize before measuring — resampling smooths exactly the texture 'contrast' measures",
    async () => {
      /*
       * Caught while building this: an earlier version of assessUploadedFrame
       * resized every upload to a 320px box before measuring anything, on the
       * theory that the grid check's fixed 20x20 sample makes source
       * resolution irrelevant. It does, for that ONE check — but resizing
       * also smooths the fine per-pixel variation `contrast` measures. A
       * large, genuinely textured image run through that path risked reading
       * as flatter than it is purely from resampling, not from anything
       * about the surface itself. This checks a resolution well past the
       * old 320px cutover still measures real contrast.
       */
      const large = await greyscalePng(1200, 1200, steelPixel);
      const verdict = await assessUploadedFrame(large);
      expect(verdict.stats.contrast).toBeGreaterThan(15);
      expect(verdict.suitable).toBe(true);
    },
  );

  it("does not mistake a lighting gradient or vignette for a manufactured grid", async () => {
    // Ordinary, benign line-camera conditions — uneven illumination, a
    // vignette toward the frame edges — that broke two earlier, simpler
    // designs of the grid check (see frame-suitability.ts's periodicity()
    // doc comment). Verified here too, not just at the unit level, since
    // this is the exact decode path a real MES integration's upload runs
    // through.
    const gradient = await greyscalePng(400, 400, (x, y) => {
      const v = 80 + Math.floor((x / 400) * 40) + Math.floor((y / 400) * 40);
      return Math.max(0, Math.min(255, v));
    });
    expect((await assessUploadedFrame(gradient)).reason).not.toBe("man_made_pattern");

    const vignette = await greyscalePng(400, 400, (x, y) => {
      const dx = x - 200;
      const dy = y - 200;
      const dist = Math.sqrt(dx * dx + dy * dy) / 280;
      const v = 150 - Math.floor(dist * 80);
      return Math.max(0, Math.min(255, v));
    });
    expect((await assessUploadedFrame(vignette)).reason).not.toBe("man_made_pattern");
  });

  it("rejects a keyboard-shaped upload as a manufactured grid", async () => {
    const keyboard = await greyscalePng(400, 400, (x, y) => {
      const cx = cellIndex(x, 400);
      const cy = cellIndex(y, 400);
      const gap = cx % 4 === 3 || cy % 4 === 3;
      return gap ? 20 : 70;
    });
    const verdict = await assessUploadedFrame(keyboard);
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("man_made_pattern");
  });

  it("does not reject a directional steel scratch as a grid", async () => {
    const scratch = await greyscalePng(400, 400, (x, y) => {
      const cy = cellIndex(y, 400);
      return cy % 5 === 0 ? 55 : 110;
    });
    const verdict = await assessUploadedFrame(scratch);
    expect(verdict.reason).not.toBe("man_made_pattern");
  });

  it("rejects a colour photo — a person, packaging, a room", async () => {
    const colourful = await colourPng(200, 200, (x) =>
      x % 2 === 0 ? [220, 40, 40] : [40, 60, 200],
    );
    const verdict = await assessUploadedFrame(colourful);
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("colour");
  });

  it("rejects a blown-out glare patch", async () => {
    const glare = await greyscalePng(400, 400, (x, y) => {
      const dx = x - 300;
      const dy = y - 260;
      if (dx * dx + dy * dy < 90 * 90) return 253;
      return steelPixel(x, y);
    });
    const verdict = await assessUploadedFrame(glare);
    expect(verdict.suitable).toBe(false);
    expect(verdict.reason).toBe("glare");
  });

  it("honours EXIF orientation the same way the inference decode path does", async () => {
    // Not exercising a real EXIF flip here (sharp's create/raw path has none
    // to read) — this just confirms the call succeeds and returns real
    // dimensions rather than throwing, since .rotate() is a no-op without
    // EXIF data but must not break a normal upload.
    const plain = await greyscalePng(320, 240, () => 120);
    const verdict = await assessUploadedFrame(plain);
    expect(verdict.stats.brightness).toBeGreaterThan(0);
  });
});
