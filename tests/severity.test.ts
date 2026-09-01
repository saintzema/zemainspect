import { describe, expect, it } from "vitest";

import {
  HIGH_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  severityColor,
  severityTone,
} from "@/lib/inference/severity";

describe("severityColor", () => {
  it("is red at or above the high-confidence threshold", () => {
    expect(severityColor(HIGH_CONFIDENCE)).toMatch(/^rgba\(248, 81, 73/);
    expect(severityColor(0.95)).toMatch(/^rgba\(248, 81, 73/);
  });

  it("is amber for the medium band", () => {
    expect(severityColor(MEDIUM_CONFIDENCE)).toMatch(/^rgba\(251, 146, 60/);
    expect(severityColor(HIGH_CONFIDENCE - 0.01)).toMatch(/^rgba\(251, 146, 60/);
  });

  it("is yellow below the medium threshold — the low-sensitivity catches", () => {
    expect(severityColor(0)).toMatch(/^rgba\(250, 204, 21/);
    expect(severityColor(MEDIUM_CONFIDENCE - 0.01)).toMatch(/^rgba\(250, 204, 21/);
  });

  it("never returns a colour outside 0-1 alpha, whatever the input", () => {
    for (const conf of [-1, 0, 0.4, 0.65, 1, 2]) {
      expect(severityColor(conf)).toMatch(/0\.95\)$/);
    }
  });
});

describe("severityTone", () => {
  it("agrees with severityColor's medium/high boundary — never a fail-red box with a warn badge", () => {
    for (const conf of [0, 0.1, 0.39, 0.4, 0.5, 0.65, 0.9, 1]) {
      const isRedOrAmber = severityColor(conf) !== "rgba(250, 204, 21, 0.95)";
      expect(severityTone(conf) === "fail").toBe(isRedOrAmber);
    }
  });

  it("only ever returns the two tones the alert badge understands", () => {
    for (const conf of [0, 0.3, 0.6, 1]) {
      expect(["fail", "warn"]).toContain(severityTone(conf));
    }
  });
});
