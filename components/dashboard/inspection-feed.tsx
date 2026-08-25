"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, Download, Pause, Play } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { Badge, EmptyState, GlassButton, GlassCard } from "@/components/ui/glass";
import { labelFor, reliabilityOf } from "@/lib/inference/labels";
import type { FeedItem } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 5000;

export function InspectionFeed({ initialItems }: { initialItems: FeedItem[] }) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState(initialItems);
  const [live, setLive] = useState(true);
  // Held in a ref so the polling effect never re-subscribes on data change.
  const latestAt = useRef(initialItems[0]?.createdAt ?? null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/inspections?limit=40", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: FeedItem[] };
      setItems(data.items);
      latestAt.current = data.items[0]?.createdAt ?? latestAt.current;
    } catch {
      // A dropped poll is not worth surfacing; the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    // Pause polling when the tab is hidden — a dashboard left open on a
    // factory office PC should not bill a request every 5s all night.
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [live, refresh]);

  return (
    <GlassCard
      title={t("dashboard.recent")}
      action={
        <div className="flex items-center gap-2">
          <GlassButton
            size="sm"
            variant="ghost"
            onClick={() => setLive((value) => !value)}
            aria-pressed={live}
          >
            {live ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden />
                {t("dashboard.live")}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden />
                {t("dashboard.paused")}
              </>
            )}
          </GlassButton>
          <a href="/api/inspections?format=csv" download>
            <GlassButton size="sm" variant="secondary">
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t("common.export")}
            </GlassButton>
          </a>
        </div>
      }
      flush
    >
      {items.length === 0 ? (
        <EmptyState title={t("common.empty")} body={t("dashboard.noInspections")} />
      ) : (
        <ul className="divide-y divide-white/25 dark:divide-white/10">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 px-5 py-3">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  item.result === "PASS" ? "bg-pass/15 text-pass" : "bg-fail/15 text-fail",
                )}
                aria-hidden
              >
                {item.result === "PASS" ? (
                  <CircleCheck className="h-4.5 w-4.5" />
                ) : (
                  <CircleX className="h-4.5 w-4.5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-ink">
                    {item.result === "PASS" ? t("dashboard.pass") : t("dashboard.fail")}
                  </span>
                  {item.defects.slice(0, 3).map((defect, index) => {
                    const reliability = reliabilityOf(defect.type);
                    return (
                      <Badge
                        key={`${item.id}-${index}`}
                        tone={reliability === "low" ? "warn" : "fail"}
                        title={t(`trends.reliability${reliability === "low" ? "Low" : reliability === "high" ? "High" : "Medium"}`)}
                      >
                        {labelFor(defect.type, language)}{" "}
                        <span className="tabular-nums opacity-80">
                          {Math.round(defect.confidence * 100)}%
                        </span>
                      </Badge>
                    );
                  })}
                  {item.defects.length > 3 && (
                    <Badge>+{item.defects.length - 3}</Badge>
                  )}
                </div>

                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {new Date(item.createdAt).toLocaleString(
                    language === "zh" ? "zh-CN" : "en-GB",
                  )}
                  {item.lineId ? ` · ${item.lineId}` : ""} · {item.processingTimeMs}ms
                  {item.inferenceSource === "edge" ? " · edge" : ""}
                </p>
              </div>

              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- blob URLs are external and unoptimised by design
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="hidden h-12 w-16 shrink-0 rounded-lg object-cover sm:block"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
