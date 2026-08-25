"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleStop, Cpu, TriangleAlert } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import {
  Badge,
  FieldLabel,
  GlassButton,
  GlassCard,
  GlassInput,
  GlassSelect,
} from "@/components/ui/glass";
import {
  WEB_MODEL_VARIANT,
  edgeBackend,
  loadWebSession,
  runWebInference,
} from "@/lib/inference/onnx-web";
import { PRODUCT_CATEGORIES, labelFor } from "@/lib/inference/labels";
import type { Detection } from "@/lib/inference/postprocess";
import type { InferenceSession } from "onnxruntime-web";

/** Upload at most one result every this many ms, to protect the plan quota. */
const UPLOAD_THROTTLE_MS = 3000;

type Status = "idle" | "loading" | "ready" | "running" | "error";

export function EdgeInspector({ modelUrl }: { modelUrl: string | null }) {
  const { t, language } = useTranslation();

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<InferenceSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastUploadRef = useRef(0);
  const runningRef = useRef(false);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [latency, setLatency] = useState(0);
  const [fps, setFps] = useState(0);
  const [lineId, setLineId] = useState("");
  const [category, setCategory] = useState<(typeof PRODUCT_CATEGORIES)[number]>("steel");
  const [upload, setUpload] = useState(true);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus("ready");
    setFps(0);
  }, []);

  // Always release the camera when the operator navigates away.
  useEffect(() => stop, [stop]);

  const drawOverlay = useCallback(
    (dets: Detection[], width: number, height: number) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = Math.max(2, Math.round(width / 320));
      ctx.font = `${Math.max(12, Math.round(width / 40))}px system-ui, sans-serif`;
      ctx.textBaseline = "top";

      for (const det of dets) {
        const [x, y, w, h] = det.bbox;
        ctx.strokeStyle = "rgba(248, 113, 113, 0.95)";
        ctx.strokeRect(x, y, w, h);

        const text = `${labelFor(det.type, language)} ${Math.round(det.confidence * 100)}%`;
        const metrics = ctx.measureText(text);
        const padding = 4;
        const boxH = Math.max(16, Math.round(width / 32));

        ctx.fillStyle = "rgba(248, 113, 113, 0.95)";
        ctx.fillRect(x, Math.max(0, y - boxH), metrics.width + padding * 2, boxH);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, x + padding, Math.max(0, y - boxH) + 2);
      }
    },
    [language],
  );

  const start = useCallback(async () => {
    if (!modelUrl) return;
    setError(null);
    setStatus("loading");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(t("edge.notSupported"));
      }

      sessionRef.current ??= await loadWebSession(modelUrl);
      if (!workCanvasRef.current) workCanvasRef.current = document.createElement("canvas");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();

      runningRef.current = true;
      setStatus("running");

      let frames = 0;
      let windowStart = performance.now();

      const loop = async () => {
        if (!runningRef.current) return;
        const session = sessionRef.current;
        const work = workCanvasRef.current;

        if (session && work && video.videoWidth > 0) {
          try {
            const result = await runWebInference(
              session,
              video,
              video.videoWidth,
              video.videoHeight,
              work,
            );
            setDetections(result.detections);
            setLatency(result.processingTimeMs);
            drawOverlay(result.detections, video.videoWidth, video.videoHeight);

            frames += 1;
            const elapsed = performance.now() - windowStart;
            if (elapsed >= 1000) {
              setFps(Math.round((frames * 1000) / elapsed));
              frames = 0;
              windowStart = performance.now();
            }

            if (upload && Date.now() - lastUploadRef.current > UPLOAD_THROTTLE_MS) {
              lastUploadRef.current = Date.now();
              void postResult(result.detections, result.processingTimeMs, work);
            }
          } catch (err) {
            console.error("Edge inference failed:", err);
          }
        }

        rafRef.current = requestAnimationFrame(() => void loop());
      };

      const postResult = async (
        dets: Detection[],
        ms: number,
        work: HTMLCanvasElement,
      ) => {
        // A small thumbnail only — the full frame stays inside the plant.
        let thumbnail: string | undefined;
        try {
          const thumb = document.createElement("canvas");
          thumb.width = 192;
          thumb.height = 108;
          thumb.getContext("2d")?.drawImage(work, 0, 0, thumb.width, thumb.height);
          thumbnail = thumb.toDataURL("image/jpeg", 0.6);
        } catch {
          thumbnail = undefined;
        }

        await fetch("/api/edge/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            result: dets.length > 0 ? "FAIL" : "PASS",
            defects: dets,
            product_category: category,
            line_id: lineId || undefined,
            processing_time_ms: ms,
            model_variant: `${WEB_MODEL_VARIANT}-${edgeBackend()}`,
            thumbnail,
          }),
        }).catch(() => undefined);
      };

      void loop();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t("edge.noCamera"));
    }
  }, [modelUrl, t, drawOverlay, upload, category, lineId]);

  if (!modelUrl) {
    return (
      <GlassCard title={t("edge.title")} description={t("edge.subtitle")}>
        <p className="flex items-center gap-2 text-sm text-warn">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {t("edge.modelMissing")}
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard
      title={t("edge.title")}
      description={t("edge.subtitle")}
      action={
        status === "running" ? (
          <GlassButton size="sm" variant="danger" onClick={stop}>
            <CircleStop className="h-3.5 w-3.5" aria-hidden />
            {t("edge.stop")}
          </GlassButton>
        ) : (
          <GlassButton size="sm" onClick={() => void start()} loading={status === "loading"}>
            <Camera className="h-3.5 w-3.5" aria-hidden />
            {status === "loading" ? t("edge.loadingModel") : t("edge.start")}
          </GlassButton>
        )
      }
    >
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="relative overflow-hidden rounded-xl bg-black/80">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-video w-full object-contain"
          />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
          {status === "running" && (
            <div className="absolute left-2 top-2 flex gap-1.5">
              <Badge tone="accent">
                <Cpu className="h-3 w-3" aria-hidden /> {edgeBackend()}
              </Badge>
              <Badge>{t("edge.fps", { value: fps })}</Badge>
              <Badge>{t("edge.inferenceMs", { value: latency })}</Badge>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <FieldLabel htmlFor="edge-line">{t("dashboard.line")}</FieldLabel>
            <GlassInput
              id="edge-line"
              value={lineId}
              placeholder={t("onboarding.lineNamePlaceholder")}
              onChange={(event) => setLineId(event.target.value)}
            />
          </div>

          <div>
            <FieldLabel htmlFor="edge-category">{t("dashboard.category")}</FieldLabel>
            <GlassSelect
              id="edge-category"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as (typeof PRODUCT_CATEGORIES)[number])
              }
            >
              {PRODUCT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`categories.${value}`)}
                </option>
              ))}
            </GlassSelect>
          </div>

          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={upload}
              onChange={(event) => setUpload(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/40 accent-[rgb(var(--accent))]"
            />
            <span>
              {t("edge.uploadResults")}
              <span className="mt-0.5 block text-xs text-ink-muted">
                {t("edge.uploadResultsHint")}
              </span>
            </span>
          </label>

          {detections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detections.map((det, index) => (
                <Badge key={index} tone="fail">
                  {labelFor(det.type, language)} {Math.round(det.confidence * 100)}%
                </Badge>
              ))}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 text-sm text-fail">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
