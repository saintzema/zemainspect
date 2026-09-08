"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Download, Pause, Play, Check, Undo2 } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { Badge, EmptyState, GlassButton, GlassCard, GlassSelect } from "@/components/ui/glass";
import { labelFor, reliabilityOf } from "@/lib/inference/labels";
import type { FeedItem } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 5000;

/**
 * How often new results may trigger a server re-render.
 *
 * The counters above this feed (inspections, pass rate, defect rate, average
 * latency) and the usage bar beside it are rendered on the server when the
 * page loads. This list polls its own endpoint, so it used to be the only
 * thing that moved: an operator running the edge inspector watched results
 * stream in below a headline that still read "Inspections 0" and "0 of 5,000
 * used". The numbers contradicted the list directly underneath them.
 *
 * `router.refresh()` re-runs the server component and updates all of it. It
 * is throttled well above the poll interval because it costs a full render
 * and several queries, and those counters do not need per-second precision.
 */
const STATS_REFRESH_INTERVAL_MS = 15000;

/** Build the feed query string from the current filter selection. */
function feedQuery(lineId: string, onlyUnreviewed: boolean): string {
  const params = new URLSearchParams({ limit: "40" });
  if (lineId) params.set("lineId", lineId);
  if (onlyUnreviewed) params.set("unreviewed", "true");
  return params.toString();
}

export function InspectionFeed({
  initialItems,
  lines,
}: {
  initialItems: FeedItem[];
  /** Distinct line names this org has inspected under — backs the filter. */
  lines: string[];
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [live, setLive] = useState(true);
  const [lineFilter, setLineFilter] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Held in a ref so the polling effect never re-subscribes on data change.
  const latestAt = useRef(initialItems[0]?.createdAt ?? null);
  const lastStatsRefreshAt = useRef(0);
  /**
   * Guards against exactly the race this filter set makes likely: a filter
   * change fires an immediate fetch (see the effect below) while the 5s poll
   * interval may already have an unfiltered request in flight from a moment
   * earlier. Network timing is not ordered by when a request was sent —
   * fetch #1 (poll, unfiltered) can resolve after fetch #2 (the filter
   * change) and, with no guard, its `.then` would blindly overwrite the
   * correctly-filtered state with stale, wrongly-scoped data. Each call
   * stamps its own sequence number and only applies its result if nothing
   * newer has started since.
   */
  const requestSeq = useRef(0);

  const refresh = useCallback(async (lineId: string, unreviewed: boolean) => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`/api/inspections?${feedQuery(lineId, unreviewed)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items: FeedItem[] };
      if (seq !== requestSeq.current) return; // superseded by a newer request

      const newest = data.items[0]?.createdAt ?? null;
      const hasNewResults = newest !== null && newest !== latestAt.current;

      setItems(data.items);
      latestAt.current = newest ?? latestAt.current;

      // Only when something actually arrived, and not more than once per
      // interval — a quiet line should cost nothing beyond this poll.
      if (hasNewResults && Date.now() - lastStatsRefreshAt.current > STATS_REFRESH_INTERVAL_MS) {
        lastStatsRefreshAt.current = Date.now();
        router.refresh();
      }
    } catch {
      // A dropped poll is not worth surfacing; the next tick retries.
    }
  }, [router]);

  useEffect(() => {
    if (!live) return;
    // Pause polling when the tab is hidden — a dashboard left open on a
    // factory office PC should not bill a request every 5s all night.
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(lineFilter, onlyUnreviewed);
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [live, lineFilter, onlyUnreviewed, refresh]);

  // A filter change should not wait for the next poll tick to take effect.
  useEffect(() => {
    void refresh(lineFilter, onlyUnreviewed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable via useCallback; re-running it on every render would defeat the point
  }, [lineFilter, onlyUnreviewed]);

  async function setReviewed(id: string, reviewed: boolean) {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/inspections?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewed }),
      });
      if (!res.ok) return;

      // Optimistic: the whole point of this action is a fast triage pass
      // across many open items, and re-fetching after every click would
      // undercut that. onlyUnreviewed removes the row entirely once marked,
      // matching what the next poll would show anyway.
      setItems((prev) =>
        onlyUnreviewed && reviewed
          ? prev.filter((item) => item.id !== id)
          : prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    reviewedAt: reviewed ? new Date().toISOString() : null,
                    reviewedByName: reviewed ? t("dashboard.you") : null,
                  }
                : item,
            ),
      );
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const openFailCount = items.filter((i) => i.result === "FAIL" && !i.reviewedAt).length;

  return (
    <GlassCard
      title={t("dashboard.recent")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {lines.length > 0 && (
            <GlassSelect
              aria-label={t("dashboard.filterByLine")}
              value={lineFilter}
              onChange={(event) => setLineFilter(event.target.value)}
              className="h-8 py-0 text-xs"
            >
              <option value="">{t("dashboard.allLines")}</option>
              {lines.map((line) => (
                <option key={line} value={line}>
                  {line}
                </option>
              ))}
            </GlassSelect>
          )}
          <GlassButton
            size="sm"
            variant={onlyUnreviewed ? "primary" : "ghost"}
            onClick={() => setOnlyUnreviewed((value) => !value)}
            aria-pressed={onlyUnreviewed}
          >
            {t("dashboard.needsReview")}
            {openFailCount > 0 && !onlyUnreviewed && (
              <Badge tone="fail" className="ml-1">
                {openFailCount}
              </Badge>
            )}
          </GlassButton>
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
          <a href={`/api/inspections?format=csv&${feedQuery(lineFilter, onlyUnreviewed)}`} download>
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
        <EmptyState
          title={t("common.empty")}
          body={onlyUnreviewed ? t("dashboard.noOpenItems") : t("dashboard.noInspections")}
        />
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
                  {item.result === "FAIL" &&
                    (item.reviewedAt ? (
                      <Badge tone="pass" title={item.reviewedByName ?? undefined}>
                        {t("dashboard.reviewed")}
                      </Badge>
                    ) : (
                      <Badge tone="warn">{t("dashboard.open")}</Badge>
                    ))}
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

              {item.result === "FAIL" && (
                <GlassButton
                  size="sm"
                  variant="ghost"
                  disabled={pendingIds.has(item.id)}
                  onClick={() => setReviewed(item.id, !item.reviewedAt)}
                  title={item.reviewedAt ? t("dashboard.markUnreviewed") : t("dashboard.markReviewed")}
                >
                  {item.reviewedAt ? (
                    <Undo2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  )}
                </GlassButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
