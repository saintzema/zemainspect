import type { PaymentProvider } from "@/lib/generated/prisma";
import type { BillingProvider } from "@/lib/billing/types";
import { paystackProvider } from "@/lib/billing/paystack";
import { stripeProvider } from "@/lib/billing/stripe";

export * from "@/lib/billing/types";

const PROVIDERS: Record<PaymentProvider, BillingProvider> = {
  PAYSTACK: paystackProvider,
  STRIPE: stripeProvider,
};

export function billingProvider(id: PaymentProvider): BillingProvider {
  return PROVIDERS[id];
}

export function configuredProviders(): BillingProvider[] {
  return Object.values(PROVIDERS).filter((p) => p.isConfigured());
}

/**
 * Pick a provider for an organization that has not paid before.
 *
 * Paystack settles in NGN and accepts Nigerian cards and bank transfer, so it
 * is the default for the African market. Stripe covers everyone else. If only
 * one is configured, that one wins regardless of currency.
 */
export function defaultProviderFor(currency: string): PaymentProvider {
  const available = configuredProviders().map((p) => p.id);
  if (available.length === 1) return available[0];

  const african = ["NGN", "GHS", "ZAR", "KES"];
  const preferred: PaymentProvider = african.includes(currency.toUpperCase())
    ? "PAYSTACK"
    : "STRIPE";

  return available.includes(preferred) ? preferred : (available[0] ?? "PAYSTACK");
}
