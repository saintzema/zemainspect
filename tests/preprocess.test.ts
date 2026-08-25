import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { preprocessImage } from "@/lib/inference/onnx-node";
import { MODEL_INPUT_SIZE, letterboxInfo } from "@/lib/inference/postprocess";

const SIZE = MODEL_INPUT_SIZE;
const PLANE = SIZE * SIZE;
const PAD = 114 / 255;

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

describe("preprocessImage", () => {
  it("produces a correctly shaped, normalised NCHW tensor", async () => {
    const image = await solid(640, 640, [255, 0, 0]);
    const { data, box } = await preprocessImage(image);

    expect(data.length).toBe(3 * PLANE);
    expect(box.scale).toBe(1);
    expect(box.padX).toBe(0);
    expect(box.padY).toBe(0);

    // Pure red, normalised, in planar order.
    const [r, g, b] = pixel(data, 320, 320);
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);

    // Scan once and assert on the result — asserting per element would mean
    // 1.2M expect() calls.
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
    // 1280x640 -> scale 0.5 -> 640x320 drawn, 160px of pad top and bottom.
    const image = await solid(1280, 640, [0, 0, 255]);
    const { data, box } = await preprocessImage(image);

    const expected = letterboxInfo(1280, 640, SIZE);
    expect(box).toEqual(expected);
    expect(box.padY).toBe(160);
    expect(box.padX).toBe(0);

    // Inside the padding band: YOLO's grey.
    const [pr, pg, pb] = pixel(data, 320, 10);
    expect(pr).toBeCloseTo(PAD, 2);
    expect(pg).toBeCloseTo(PAD, 2);
    expect(pb).toBeCloseTo(PAD, 2);

    // Just inside the image band: blue.
    const [ir, ig, ib] = pixel(data, 320, 320);
    expect(ir).toBeCloseTo(0, 2);
    expect(ig).toBeCloseTo(0, 2);
    expect(ib).toBeCloseTo(1, 2);

    // The very first row below the pad must already be image, not pad.
    const [, , firstRowBlue] = pixel(data, 320, box.padY + 2);
    expect(firstRowBlue).toBeCloseTo(1, 2);
  });

  it("letterboxes a portrait image on the horizontal axis", async () => {
    const image = await solid(320, 640, [0, 255, 0]);
    const { data, box } = await preprocessImage(image);

    expect(box.padX).toBe(160);
    expect(box.padY).toBe(0);

    const [lr, lg, lb] = pixel(data, 10, 320); // left pad
    expect(lr).toBeCloseTo(PAD, 2);
    expect(lg).toBeCloseTo(PAD, 2);
    expect(lb).toBeCloseTo(PAD, 2);

    const [, cg] = pixel(data, 320, 320); // centre is the image
    expect(cg).toBeCloseTo(1, 2);
  });

  it("places a known region where the inverse transform predicts", async () => {
    // A 1000x500 canvas with a 100x100 white square at (400, 200).
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

    // Forward-project the square's centre (450, 250) into model space using the
    // same transform decodeYolov8 inverts.
    const modelX = Math.round(450 * box.scale + box.padX);
    const modelY = Math.round(250 * box.scale + box.padY);

    const [r, g, b] = pixel(data, modelX, modelY);
    expect(r).toBeCloseTo(1, 1);
    expect(g).toBeCloseTo(1, 1);
    expect(b).toBeCloseTo(1, 1);

    // A point well outside the square must be black, not white — proves the
    // square was not smeared across the frame by a bad resize.
    const [outR] = pixel(data, Math.round(50 * box.scale + box.padX), modelY);
    expect(outR).toBeCloseTo(0, 1);
  });

  it("rejects a buffer that is not an image", async () => {
    await expect(preprocessImage(Buffer.from("this is not an image"))).rejects.toThrow();
  });
});
