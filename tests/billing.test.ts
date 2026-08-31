import { afterEach, describe, expect, it } from "vitest";

import { alipayConfig, alipayPriceFor, alipayReference } from "@/lib/billing/alipay";
import { validatePassword, MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

const TOUCHED = [
  "ALIPAY_QR_URL",
  "ALIPAY_CONTACT",
  "ALIPAY_ACCOUNT_NAME",
  "ALIPAY_PRICE_PRO_FEN",
  "ADMIN_EMAIL",
];

afterEach(() => {
  for (const key of TOUCHED) delete process.env[key];
});

describe("alipayConfig", () => {
  it("is off until a QR code is on file", () => {
    process.env.ADMIN_EMAIL = "founder@example.com";
    expect(alipayConfig()).toBeNull();
  });

  it("is off when there is nowhere to send proof of payment", () => {
    process.env.ALIPAY_QR_URL = "/images/alipay-qr.jpg";
    expect(alipayConfig()).toBeNull();
  });

  it("treats a blank Vercel field as unset", () => {
    process.env.ALIPAY_QR_URL = "   ";
    process.env.ADMIN_EMAIL = "founder@example.com";
    expect(alipayConfig()).toBeNull();
  });

  it("falls back to the founder address for the contact", () => {
    process.env.ALIPAY_QR_URL = "/images/alipay-qr.jpg";
    process.env.ADMIN_EMAIL = "founder@example.com";
    expect(alipayConfig()).toEqual({
      qrUrl: "/images/alipay-qr.jpg",
      contact: "founder@example.com",
      accountName: null,
    });
  });

  it("prefers an explicit Alipay contact over the founder address", () => {
    process.env.ALIPAY_QR_URL = "/images/alipay-qr.jpg";
    process.env.ADMIN_EMAIL = "founder@example.com";
    process.env.ALIPAY_CONTACT = "wechat:zema";
    process.env.ALIPAY_ACCOUNT_NAME = "Emmanuel E.";
    expect(alipayConfig()).toEqual({
      qrUrl: "/images/alipay-qr.jpg",
      contact: "wechat:zema",
      accountName: "Emmanuel E.",
    });
  });
});

describe("alipayPriceFor", () => {
  it("formats the published yuan price in whole yuan", () => {
    expect(alipayPriceFor("STARTER")).toBe("¥350");
    expect(alipayPriceFor("PRO")).toBe("¥1,050");
  });

  it("has no price for the tiers that are not sold this way", () => {
    expect(alipayPriceFor("ENTERPRISE")).toBeNull();
  });

  it("lets a deployment override the price", () => {
    process.env.ALIPAY_PRICE_PRO_FEN = "88800";
    expect(alipayPriceFor("PRO")).toBe("¥888");
  });

  it("ignores a non-numeric override rather than rendering NaN", () => {
    process.env.ALIPAY_PRICE_PRO_FEN = "¥888";
    expect(alipayPriceFor("PRO")).toBe("¥1,050");
  });

  it("shows decimals only when the override is not whole yuan", () => {
    process.env.ALIPAY_PRICE_PRO_FEN = "88850";
    expect(alipayPriceFor("PRO")).toBe("¥888.50");
  });
});

describe("alipayReference", () => {
  it("is stable for the same organization and tier", () => {
    const id = "clx9a8b7c6d5e4f3g2h1";
    expect(alipayReference(id, "PRO")).toBe(alipayReference(id, "PRO"));
  });

  it("distinguishes tiers so two transfers are never confused", () => {
    const id = "clx9a8b7c6d5e4f3g2h1";
    expect(alipayReference(id, "PRO")).not.toBe(alipayReference(id, "STARTER"));
  });

  it("is short, uppercase and safe to type into a transfer note", () => {
    const reference = alipayReference("clx9a8b7c6d5e4f3g2h1", "STARTER");
    expect(reference).toMatch(/^ZI-[A-Z]{3}-[A-Z0-9]{1,6}$/);
    expect(reference.length).toBeLessThanOrEqual(14);
  });
});

describe("validatePassword", () => {
  it("accepts a reasonable passphrase", () => {
    expect(validatePassword("correct horse battery")).toBeNull();
  });

  it("rejects anything under the minimum length", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))?.code).toBe("too_short");
  });

  it("rejects the passwords credential stuffing tries first", () => {
    expect(validatePassword("password123")?.code).toBe("too_common");
    expect(validatePassword("PassWord123")?.code).toBe("too_common");
  });

  it("rejects a passphrase bcrypt would silently truncate", () => {
    // Under 72 characters but over 72 UTF-8 bytes: the case a length check in
    // characters alone would wave through.
    expect(validatePassword("密".repeat(25))?.code).toBe("too_long");
    expect(validatePassword("密".repeat(24))).toBeNull();
  });
});
