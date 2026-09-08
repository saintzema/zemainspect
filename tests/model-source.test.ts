import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_FILE,
  modelFileName,
  modelIsConfigured,
  publicModelUrl,
} from "@/lib/inference/model-source";

afterEach(() => {
  delete process.env.MODEL_FILE;
  delete process.env.MODEL_URL;
});

/*
 * These cover a bug that reached production and broke the edge inspector with
 * "Could not download the model (404)".
 *
 * MODEL_FILE was left as a blank field in the Vercel dashboard. `?? default`
 * only falls back on null/undefined, so the filename became "" and the browser
 * was handed `/models/`. Worse, the server-side check used existsSync on the
 * resulting path — which is the `public/models` DIRECTORY, and existsSync says
 * yes to a directory. So the deployment believed it had a model, rendered the
 * camera UI, and only failed once a shop-floor operator pressed Start.
 */
describe("model file resolution", () => {
  it("uses the bundled model when nothing is configured", () => {
    expect(modelFileName()).toBe(DEFAULT_MODEL_FILE);
    expect(publicModelUrl()).toBe(`/models/${DEFAULT_MODEL_FILE}`);
  });

  it("treats a blank MODEL_FILE as unset rather than as an empty filename", () => {
    process.env.MODEL_FILE = "";
    expect(modelFileName()).toBe(DEFAULT_MODEL_FILE);
    expect(publicModelUrl()).toBe(`/models/${DEFAULT_MODEL_FILE}`);
  });

  it("treats a whitespace-only MODEL_FILE the same way", () => {
    process.env.MODEL_FILE = "   ";
    expect(publicModelUrl()).toBe(`/models/${DEFAULT_MODEL_FILE}`);
  });

  it("never yields a directory URL the browser would 404 on", () => {
    for (const value of ["", "   ", undefined]) {
      if (value === undefined) delete process.env.MODEL_FILE;
      else process.env.MODEL_FILE = value;
      expect(publicModelUrl()).not.toBe("/models/");
      expect(publicModelUrl()).not.toMatch(/\/$/);
    }
  });

  it("honours a real MODEL_FILE override", () => {
    process.env.MODEL_FILE = "custom.onnx";
    expect(modelFileName()).toBe("custom.onnx");
  });

  it("reports no model — rather than the models directory — when the file is missing", () => {
    process.env.MODEL_FILE = "does-not-exist.onnx";
    expect(modelIsConfigured()).toBe(false);
    // Null is what hides the edge inspector. Offering a camera that cannot run
    // is worse than not offering one.
    expect(publicModelUrl()).toBeNull();
  });

  it("counts a hosted MODEL_URL as configured even with no bundled file", () => {
    process.env.MODEL_FILE = "does-not-exist.onnx";
    process.env.MODEL_URL = "https://huggingface.co/example/resolve/main/model.onnx";
    expect(modelIsConfigured()).toBe(true);
  });

  it("ignores a blank MODEL_URL", () => {
    process.env.MODEL_FILE = "does-not-exist.onnx";
    process.env.MODEL_URL = "";
    expect(modelIsConfigured()).toBe(false);
  });
});

/*
 * The server-side counterpart to lib/inference/model-registry.ts on the
 * client: before this, product_category was accepted, stored on the
 * InspectionJob row, and never once consulted — a request for "automotive"
 * silently ran the bundled steel weights and reported steel defect class
 * names against whatever was actually submitted.
 */
describe("category model resolution", () => {
  afterEach(() => {
    delete process.env.MODEL_URL_GENERAL;
    delete process.env.MODEL_CLASSES_GENERAL;
    delete process.env.MODEL_URL_AUTOMOTIVE;
    delete process.env.MODEL_CLASSES_AUTOMOTIVE;
    delete process.env.MODEL_FILE;
    delete process.env.MODEL_URL;
  });

  it("steel is configured exactly when the bundled/default model resolution says so", async () => {
    const { categoryIsConfigured } = await import("@/lib/inference/model-source");
    expect(categoryIsConfigured("steel")).toBe(modelIsConfigured());
  });

  it("reports no model for a category nothing is configured for", async () => {
    const { categoryIsConfigured } = await import("@/lib/inference/model-source");
    expect(categoryIsConfigured("automotive")).toBe(false);
    expect(categoryIsConfigured("general")).toBe(false);
  });

  it("never serves the NEU steel classes for another category", async () => {
    process.env.MODEL_URL_GENERAL = "https://cdn.example.com/general.onnx";
    process.env.MODEL_CLASSES_GENERAL = "crack, dent , burr";
    const { classNamesFor } = await import("@/lib/inference/model-source");
    expect(classNamesFor("general")).toEqual(["crack", "dent", "burr"]);
    expect(classNamesFor("general")).not.toEqual(classNamesFor("steel"));
  });

  it("requires classes as well as a URL — weights alone cannot be labelled", async () => {
    process.env.MODEL_URL_AUTOMOTIVE = "https://cdn.example.com/auto.onnx";
    const { categoryIsConfigured } = await import("@/lib/inference/model-source");
    expect(categoryIsConfigured("automotive")).toBe(false);

    process.env.MODEL_CLASSES_AUTOMOTIVE = "weld_gap,porosity";
    expect(categoryIsConfigured("automotive")).toBe(true);
  });

  it("treats a blank class list as unset", async () => {
    process.env.MODEL_URL_GENERAL = "https://cdn.example.com/general.onnx";
    process.env.MODEL_CLASSES_GENERAL = "   ";
    const { categoryIsConfigured } = await import("@/lib/inference/model-source");
    expect(categoryIsConfigured("general")).toBe(false);
  });

  it("names a custom category's variant distinctly from steel's", async () => {
    process.env.MODEL_URL_GENERAL = "https://cdn.example.com/general.onnx";
    process.env.MODEL_CLASSES_GENERAL = "crack";
    const { modelVariantNameFor } = await import("@/lib/inference/model-source");
    expect(modelVariantNameFor("general")).toBe("custom-general");
    expect(modelVariantNameFor("steel")).not.toBe("custom-steel");
  });

  it("rejects loadModelBytesFor for an unconfigured category rather than silently loading steel", async () => {
    const { loadModelBytesFor } = await import("@/lib/inference/model-source");
    await expect(loadModelBytesFor("automotive")).rejects.toThrow(/No model deployed/);
  });
});
