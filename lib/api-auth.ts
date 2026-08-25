import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { bearerFrom, hashApiKey } from "@/lib/api-key";
import { effectiveTier, isTrialExpired, planFor } from "@/lib/plans";
import type { Organization, Subscription } from "@/lib/generated/prisma";

export interface ApiContext {
  organization: Organization;
  subscription: Subscription | null;
  apiKeyId: string;
  tier: ReturnType<typeof effectiveTier>;
  limit: number;
  used: number;
}

export type ApiAuthResult =
  | { ok: true; ctx: ApiContext }
  | { ok: false; response: NextResponse };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Authenticate an /api/v1 request and confirm the caller still has quota.
 *
 * The key is looked up by hash — the plaintext is never stored, so a database
 * leak does not hand out working credentials.
 */
export async function authenticateApiRequest(
  request: Request,
): Promise<ApiAuthResult> {
  const token = bearerFrom(request.headers.get("authorization"));
  if (!token) {
    return {
      ok: false,
      response: errorResponse(
        401,
        "missing_api_key",
        "Provide your API key as: Authorization: Bearer <key>",
      ),
    };
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { organization: { include: { subscription: true } } },
  });

  if (!record || record.revokedAt) {
    return {
      ok: false,
      response: errorResponse(401, "invalid_api_key", "This API key is not valid."),
    };
  }

  const organization = record.organization;
  const subscription = organization.subscription;
  const tier = effectiveTier(organization);

  if (isTrialExpired(organization)) {
    return {
      ok: false,
      response: errorResponse(
        402,
        "trial_expired",
        "Your free trial has ended. Upgrade your plan to continue inspecting.",
      ),
    };
  }

  if (subscription?.status === "CANCELLED") {
    return {
      ok: false,
      response: errorResponse(
        402,
        "subscription_inactive",
        "This subscription is cancelled. Reactivate it to continue inspecting.",
      ),
    };
  }

  const limit = subscription?.monthlyInspectionLimit ?? planFor(tier).monthlyInspectionLimit;
  const used = subscription?.inspectionsUsedThisCycle ?? 0;

  // Paid tiers absorb overage as a line item rather than stopping the line —
  // a factory hates being cut off mid-shift more than it hates a small bill.
  const allowsOverage = tier !== "TRIAL";
  if (used >= limit && !allowsOverage) {
    return {
      ok: false,
      response: errorResponse(
        429,
        "quota_exceeded",
        `Monthly inspection limit of ${limit} reached. Upgrade your plan to continue.`,
      ),
    };
  }

  // Fire-and-forget: never make an inspection wait on a bookkeeping write.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    ok: true,
    ctx: { organization, subscription, apiKeyId: record.id, tier, limit, used },
  };
}
