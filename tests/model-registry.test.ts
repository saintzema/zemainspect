import { afterEach, describe, expect, it } from "vitest";

import {
  isCategoryAvailable,
  modelForCategory,
} from "@/lib/inference/model-registry";
import { NEU_CLASSES } from "@/lib/inference/labels";

const STEEL_URL = "/models/yolov8n-neu.onnx";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_MODEL_URL_GENERAL;
  delete process.env.NEXT_PUBLIC_MODEL_CLASSES_GENERAL;
  delete process.env.NEXT_PUBLIC_MODEL_URL_AUTOMOTIVE;
  delete process.env.NEXT_PUBLIC_MODEL_CLASSES_AUTOMOTIVE;
});

describe("modelForCategory", () => {
  it("serves the bundled NEU model for steel", () => {
    const model = modelForCategory("steel", STEEL_URL);
    expect(model.modelUrl).toBe(STEEL_URL);
    expect(model.classNames).toEqual(NEU_CLASSES);
    expect(model.expectsGreyscale).toBe(true);
  });

  it("reports no model for a category nothing is configured for", () => {
    // The honest default: selecting "automotive part" today must not quietly
    // run steel weights and report steel defect classes on a car part.
    const model = modelForCategory("automotive", STEEL_URL);
    expect(model.modelUrl).toBeNull();
    expect(model.classNames).toEqual([]);
  });

  it("never falls back to the steel model for another category", () => {
    expect(modelForCategory("general", STEEL_URL).modelUrl).not.toBe(STEEL_URL);
  });

  it("picks up a model configured for a category", () => {
    process.env.NEXT_PUBLIC_MODEL_URL_GENERAL = "https://cdn.example.com/general.onnx";
    process.env.NEXT_PUBLIC_MODEL_CLASSES_GENERAL = "crack, dent , burr";

    const model = modelForCategory("general", STEEL_URL);
    expect(model.modelUrl).toBe("https://cdn.example.com/general.onnx");
    // Whitespace around comma-separated names is normal in an env var.
    expect(model.classNames).toEqual(["crack", "dent", "burr"]);
    expect(model.variant).toBe("custom-general");
  });

  it("does not apply the steel greyscale assumption to a custom model", () => {
    process.env.NEXT_PUBLIC_MODEL_URL_GENERAL = "https://cdn.example.com/general.onnx";
    process.env.NEXT_PUBLIC_MODEL_CLASSES_GENERAL = "crack";
    // The colour guard is calibrated for NEU steel. Inheriting it would
    // reject every frame of a legitimately coloured part.
    expect(modelForCategory("general", STEEL_URL).expectsGreyscale).toBe(false);
  });

  it("treats a blank env var as unset", () => {
    process.env.NEXT_PUBLIC_MODEL_URL_GENERAL = "   ";
    process.env.NEXT_PUBLIC_MODEL_CLASSES_GENERAL = "";
    const model = modelForCategory("general", STEEL_URL);
    expect(model.modelUrl).toBeNull();
    expect(model.classNames).toEqual([]);
  });
});

describe("isCategoryAvailable", () => {
  it("is true for steel when the weights are deployed", () => {
    expect(isCategoryAvailable("steel", STEEL_URL)).toBe(true);
  });

  it("is false for steel when no weights are deployed", () => {
    expect(isCategoryAvailable("steel", null)).toBe(false);
  });

  it("is false for a category with no model", () => {
    expect(isCategoryAvailable("automotive", STEEL_URL)).toBe(false);
  });

  it("requires classes as well as a URL — weights alone cannot be labelled", () => {
    process.env.NEXT_PUBLIC_MODEL_URL_AUTOMOTIVE = "https://cdn.example.com/auto.onnx";
    expect(isCategoryAvailable("automotive", STEEL_URL)).toBe(false);

    process.env.NEXT_PUBLIC_MODEL_CLASSES_AUTOMOTIVE = "weld_gap,porosity";
    expect(isCategoryAvailable("automotive", STEEL_URL)).toBe(true);
  });
});
