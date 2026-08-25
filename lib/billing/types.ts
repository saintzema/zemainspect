import type { PaymentProvider, PlanTier } from "@/lib/generated/prisma";

export interface CheckoutRequest {
  organizationId: string;
  organizationName: string;
  email: string;
  tier: Exclude<PlanTier, "TRIAL" | "ENTERPRISE">;
  /** Absolute URL the provider returns the customer to after payment. */
  callbackUrl: string;
}

export interface CheckoutResult {
  /** Hosted payment page to redirect the browser to. */
  redirectUrl: string;
  reference?: string;
}

export interface PortalRequest {
  organizationId: string;
  email: string;
  returnUrl: string;
}

/**
 * A normalised subscription state, derived from whichever provider's webhook
 * or API produced it, so the rest of the app never branches on provider.
 */
export interface NormalisedSubscription {
  provider: PaymentProvider;
  tier: PlanTier;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  currentPeriodEnd: Date;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackEmailToken?: string | null;
  paystackPlanCode?: string | null;
  customerRef?: string | null;
}

export interface BillingProvider {
  readonly id: PaymentProvider;
  /** True when the environment carries the credentials this provider needs. */
  isConfigured(): boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /**
   * A self-serve management surface. Stripe has a real portal; Paystack
   * exposes a per-subscription management link instead.
   */
  createPortalLink(req: PortalRequest): Promise<string | null>;
  cancelSubscription(organizationId: string): Promise<void>;
}

export class BillingNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Billing provider "${provider}" is not configured`);
    this.name = "BillingNotConfiguredError";
  }
}
