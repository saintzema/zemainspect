import { env, envOr } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import type { PlanTier } from "@/lib/generated/prisma";

/**
 * Alipay, as a manually-settled payment option.
 *
 * This is deliberately NOT a payments integration. Alipay's merchant API needs
 * a registered Chinese business entity, which is exactly the thing a founder
 * selling into Zhejiang before incorporating there does not have yet. What
 * they do have is a personal Alipay receive-money QR code, and Chinese
 * customers will scan it without a second thought — it is the ordinary way
 * small B2B payments are made there.
 *
 * So the product shows the QR, the exact amount in yuan, and a reference the
 * buyer types into the transfer note. The founder reconciles the payment by
 * hand and switches the account on with the existing "grant access" control in
 * the admin console. No webhook, no settlement, no pretending otherwise: the
 * UI says the account is activated after the payment is confirmed.
 *
 * The whole option disappears unless ALIPAY_QR_URL is set, so a deployment
 * without a QR code on file never shows a payment method that goes nowhere.
 */
export interface AlipayConfig {
  qrUrl: string;
  /** Where the buyer sends proof of payment. */
  contact: string;
  /** Display name shown on the Alipay account, so the buyer can sanity-check it. */
  accountName: string | null;
}

export function alipayConfig(): AlipayConfig | null {
  const qrUrl = env("ALIPAY_QR_URL");
  if (!qrUrl) return null;

  const contact = env("ALIPAY_CONTACT") ?? env("ADMIN_EMAIL");
  if (!contact) return null;

  return {
    qrUrl,
    contact,
    accountName: env("ALIPAY_ACCOUNT_NAME") ?? null,
  };
}

/** The yuan price of a tier, formatted for display (e.g. "¥350"). */
export function alipayPriceFor(tier: PlanTier): string | null {
  const override = env(`ALIPAY_PRICE_${tier}_FEN`);
  const fen =
    override && /^\d+$/.test(override) ? Number(override) : PLANS[tier].priceCnyFen;
  if (fen === null || fen === undefined) return null;

  // Fen are hundredths of a yuan. Prices here are whole yuan, so only show
  // decimals when a deployment has overridden with a fractional amount.
  const yuan = fen / 100;
  return `${envOr("ALIPAY_CURRENCY_SYMBOL", "¥")}${
    Number.isInteger(yuan) ? yuan.toLocaleString("zh-CN") : yuan.toFixed(2)
  }`;
}

/**
 * A short, unambiguous reference for the buyer to put in the transfer note.
 *
 * Derived from the organization id rather than random, so it is stable across
 * retries and the admin can match it back without storing anything new.
 * Uppercased and stripped of characters that are easy to misread.
 */
export function alipayReference(organizationId: string, tier: PlanTier): string {
  const suffix = organizationId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  return `ZI-${tier.slice(0, 3)}-${suffix}`;
}
