"use client";

import { useState } from "react";
import { Copy, QrCode } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { Badge, GlassButton, GlassCard } from "@/components/ui/glass";

export interface AlipayOffer {
  tier: "STARTER" | "PRO";
  price: string;
  reference: string;
}

/**
 * Pay by scanning an Alipay QR code.
 *
 * Settlement is manual — the payment lands in a personal Alipay account and an
 * admin activates the plan afterwards. The copy says so plainly rather than
 * implying an instant upgrade, because a customer who pays and then watches
 * their plan not change will assume the payment failed and pay again.
 */
export function AlipayPanel({
  qrUrl,
  contact,
  accountName,
  offers,
}: {
  qrUrl: string;
  contact: string;
  accountName: string | null;
  offers: AlipayOffer[];
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  // A QR that fails to load is worse than none: the buyer sees an empty
  // frame and no way to pay, with nothing saying why.
  const [imageBroken, setImageBroken] = useState(false);

  if (offers.length === 0) return null;

  return (
    <GlassCard title={t("billing.alipayTitle")} description={t("billing.alipayBody")}>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0">
          <div className="overflow-hidden rounded-2xl bg-white p-2">
            {/*
              A plain <img>, deliberately, not next/image. Two reasons, both
              practical: running a dense QR through an image optimizer risks
              resampling artefacts that stop a phone camera locking onto it,
              and next/image would reject an ALIPAY_QR_URL pointing anywhere
              outside this origin unless the host is added to next.config. A
              bare img means the URL can be a committed file, an external link
              or a data: URI, and the operator does not have to redeploy the
              app to change their payment QR.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={t("billing.alipayQrAlt")}
              width={220}
              height={220}
              className="h-[220px] w-[220px] object-contain"
              onError={() => setImageBroken(true)}
            />
          </div>
          {imageBroken && (
            <p role="alert" className="mt-2 max-w-[220px] text-center text-xs text-fail">
              {t("billing.alipayQrMissing")}
            </p>
          )}
          {accountName && !imageBroken && (
            <p className="mt-2 text-center text-xs text-ink-muted">{accountName}</p>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {offers.map((offer) => (
            <div
              key={offer.tier}
              className="rounded-xl border border-white/40 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-ink">{t(`pricing.tier${offer.tier}`)}</span>
                <span className="text-lg font-semibold tabular-nums text-ink">
                  {offer.price}
                </span>
                <span className="text-xs text-ink-muted">{t("common.perMonth")}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-muted">{t("billing.alipayReference")}</span>
                <code className="rounded-lg bg-white/70 px-2 py-1 font-mono text-xs text-ink dark:bg-white/10">
                  {offer.reference}
                </code>
                <GlassButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(offer.reference)
                      .then(() => setCopied(offer.tier))
                      .catch(() => undefined);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {copied === offer.tier ? t("common.copied") : t("common.copy")}
                </GlassButton>
              </div>
            </div>
          ))}

          <ol className="space-y-1.5 text-sm text-ink-muted">
            <li className="flex gap-2">
              <Badge tone="accent">1</Badge>
              <span>{t("billing.alipayStep1")}</span>
            </li>
            <li className="flex gap-2">
              <Badge tone="accent">2</Badge>
              <span>{t("billing.alipayStep2")}</span>
            </li>
            <li className="flex gap-2">
              <Badge tone="accent">3</Badge>
              <span>{t("billing.alipayStep3", { contact })}</span>
            </li>
          </ol>

          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("billing.alipayManualNote")}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}
