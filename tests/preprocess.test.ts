import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { preprocessImage } from "@/lib/inference/onnx-node";
import { letterboxToTensor, PAD_VALUE } from "@/lib/inference/preprocess";
import { MODEL_INPUT_SIZE, letterboxInfo } from "@/lib/inference/postprocess";

const SIZE = MODEL_INPUT_SIZE;
const PLANE = SIZE * SIZE;
const PAD = PAD_VALUE / 255;

/** Read a planar-RGB pixel out of the NCHW float tensor. */
function pixel(data: Float32Array, x: number, y: number) {
  const i = y * SIZE + x;
  return [data[i], data[PLANE + i], data[2 * PLANE + i]] as const;
}

async function solid(width: number, height: number, rgb: [number, number, number]) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .png()
    .toBuffer();
}

describe("letterboxToTensor", () => {
  it("reproduces OpenCV's half-pixel bilinear mapping when upscaling", () => {
    // A 2x1 image, red then blue, upscaled to 4 px wide.
    // OpenCV maps dst x -> (x + 0.5) * 0.5 - 0.5 = -0.25, 0.25, 0.75, 1.25
    // which clamps/interpolates to weights 0, 0.25, 0.75, 1 across the pair.
    const rgb = new Uint8Array([255, 0, 0, 0, 0, 255]);
    const { data } = letterboxToTensor(rgb, 2, 1, 4, 3);

    const plane = 16;
    const red = (x: number, y: number) => data[y * 4 + x];
    const blue = (x: number, y: number) => data[2 * plane + y * 4 + x];

    // 2x1 in a 4x4 box -> scale 2, drawn 4x2, padY 1.
    const row = 1;
    expect(red(0, row)).toBeCloseTo(1, 5);
    expect(red(1, row)).toBeCloseTo(191 / 255, 5); // round(255*0.75)
    expect(red(2, row)).toBeCloseTo(64 / 255, 5); // round(255*0.25)
    expect(red(3, row)).toBeCloseTo(0, 5);

    expect(blue(0, row)).toBeCloseTo(0, 5);
    expect(blue(3, row)).toBeCloseTo(1, 5);
  });

  it("fills untouched regions with YOLO's pad value", () => {
    const rgb = new Uint8Array(4 * 3).fill(255); // 2x2 white
    const { data } = letterboxToTensor(rgb, 2, 1, 4, 3);
    // Rows 0 and 3 are padding for a 2:1 image in a square box.
    expect(data[0 * 4 + 0]).toBeCloseTo(PAD, 5);
    expect(data[3 * 4 + 0]).toBeCloseTo(PAD, 5);
  });

  it("accepts an RGBA stride, ignoring the alpha channel", () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 10, 20, 30, 0]);
    const { data } = letterboxToTensor(rgba, 2, 1, 2, 4);
    const plane = 4;
    // Row 0 is padding (2x1 into 2x2 -> drawn 2x1, padY 0), so read row 0.
    expect(data[0]).toBeCloseTo(10 / 255, 5);
    expect(data[plane]).toBeCloseTo(20 / 255, 5);
    expect(data[2 * plane]).toBeCloseTo(30 / 255, 5);
  });

  it("handles a 1-pixel source without sampling out of bounds", () => {
    const rgb = new Uint8Array([90, 90, 90]);
    const { data } = letterboxToTensor(rgb, 1, 1, 4, 3);
    expect(Number.isNaN(data[0])).toBe(false);
    // The single pixel replicates across the whole drawn area.
    expect(data[0]).toBeCloseTo(90 / 255, 5);
  });
});

describe("preprocessImage", () => {
  it("produces a correctly shaped, normalised NCHW tensor", async () => {
    const image = await solid(640, 640, [255, 0, 0]);
    const { data, box } = await preprocessImage(image);

    expect(data.length).toBe(3 * PLANE);
    expect(box.scale).toBe(1);
    expect(box.padX).toBe(0);
    expect(box.padY).toBe(0);

    const [r, g, b] = pixel(data, 320, 320);
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);

    let min = Infinity;
    let max = -Infinity;
    for (const value of data) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it("letterboxes a landscape image with grey padding exactly where letterboxInfo says", async () => {
    const image = await solid(1280, 640, [0, 0, 255]);
    const { data, box } = await preprocessImage(image);

    expect(box).toEqual(letterboxInfo(1280, 640, SIZE));
    expect(box.padY).toBe(160);
    expect(box.padX).toBe(0);

    const [pr, pg, pb] = pixel(data, 320, 10);
    expect(pr).toBeCloseTo(PAD, 2);
    expect(pg).toBeCloseTo(PAD, 2);
    expect(pb).toBeCloseTo(PAD, 2);

    const [ir, ig, ib] = pixel(data, 320, 320);
    expect(ir).toBeCloseTo(0, 2);
    expect(ig).toBeCloseTo(0, 2);
    expect(ib).toBeCloseTo(1, 2);
  });

  it("letterboxes a portrait image on the horizontal axis", async () => {
    const image = await solid(320, 640, [0, 255, 0]);
    const { data, box } = await preprocessImage(image);

    expect(box.padX).toBe(160);
    expect(box.padY).toBe(0);

    const [lr, lg, lb] = pixel(data, 10, 320);
    expect(lr).toBeCloseTo(PAD, 2);
    expect(lg).toBeCloseTo(PAD, 2);
    expect(lb).toBeCloseTo(PAD, 2);

    const [, cg] = pixel(data, 320, 320);
    expect(cg).toBeCloseTo(1, 2);
  });

  it("places a known region where the inverse transform predicts", async () => {
    const square = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const composed = await sharp({
      create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: square, left: 400, top: 200 }])
      .png()
      .toBuffer();

    const { data, box } = await preprocessImage(composed);

    const modelX = Math.round(450 * box.scale + box.padX);
    const modelY = Math.round(250 * box.scale + box.padY);

    const [r, g, b] = pixel(data, modelX, modelY);
    expect(r).toBeCloseTo(1, 1);
    expect(g).toBeCloseTo(1, 1);
    expect(b).toBeCloseTo(1, 1);

    const [outR] = pixel(data, Math.round(50 * box.scale + box.padX), modelY);
    expect(outR).toBeCloseTo(0, 1);
  });

  it("rejects a buffer that is not an image", async () => {
    await expect(preprocessImage(Buffer.from("this is not an image"))).rejects.toThrow();
  });
});
