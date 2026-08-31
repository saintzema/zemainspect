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
