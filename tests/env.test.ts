import { afterEach, describe, expect, it } from "vitest";

import { env, envOr, hasEnv } from "@/lib/env";

const KEY = "ZEMA_TEST_VAR";

afterEach(() => {
  delete process.env[KEY];
});

describe("env", () => {
  it("returns a real value", () => {
    process.env[KEY] = "hello";
    expect(env(KEY)).toBe("hello");
  });

  it("treats an EMPTY STRING as absent", () => {
    // This is the whole point. Vercel's import screen stores every blank field
    // as "", and `process.env.X ?? fallback` lets it through as a real value —
    // which resolved the model path to a directory and 404'd edge inference on
    // a live deployment.
    process.env[KEY] = "";
    expect(env(KEY)).toBeUndefined();
    expect(hasEnv(KEY)).toBe(false);
    expect(envOr(KEY, "fallback")).toBe("fallback");
  });

  it("treats whitespace-only as absent", () => {
    process.env[KEY] = "   ";
    expect(env(KEY)).toBeUndefined();
    expect(envOr(KEY, "fallback")).toBe("fallback");
  });

  it("trims a value pasted with surrounding whitespace", () => {
    process.env[KEY] = "  sk_test_abc  \n";
    expect(env(KEY)).toBe("sk_test_abc");
  });

  it("treats an unset variable as absent", () => {
    expect(env(KEY)).toBeUndefined();
    expect(hasEnv(KEY)).toBe(false);
    expect(envOr(KEY, "fallback")).toBe("fallback");
  });

  it("keeps values that are falsy but meaningful", () => {
    process.env[KEY] = "0";
    expect(env(KEY)).toBe("0");
    expect(hasEnv(KEY)).toBe(true);
    process.env[KEY] = "false";
    expect(env(KEY)).toBe("false");
  });
});

describe("model path resolution (regression)", () => {
  afterEach(() => {
    delete process.env.MODEL_FILE;
  });

  it("falls back to the default filename when MODEL_FILE is blank", () => {
    process.env.MODEL_FILE = "";
    // Previously produced "/models/" — a directory — and hence a 404.
    expect(`/models/${envOr("MODEL_FILE", "yolov8n-neu.onnx")}`).toBe(
      "/models/yolov8n-neu.onnx",
    );
  });

  it("still honours an explicitly set MODEL_FILE", () => {
    process.env.MODEL_FILE = "custom.onnx";
    expect(envOr("MODEL_FILE", "yolov8n-neu.onnx")).toBe("custom.onnx");
  });
});
