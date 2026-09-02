"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  CircleStop,
  Cpu,
  Expand,
  Maximize2,
  Minimize2,
  Shrink,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";

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
import { DEFAULT_CONFIDENCE, type Detection } from "@/lib/inference/postprocess";
import { playClearTone, playDefectAlert } from "@/lib/inference/alert-sound";
import { severityColor, severityTone } from "@/lib/inference/severity";
import { cn } from "@/lib/utils";
import type { InferenceSession } from "onnxruntime-web";

/** Upload at most one result every this many ms, to protect the plan quota. */
const UPLOAD_THROTTLE_MS = 3000;

/**
 * Minimum time between alert sounds while defects keep appearing.
 *
 * Without this, a defect that sits in frame for several seconds — the normal
 * case, since parts move past a fixed camera at line speed — would re-trigger
 * the tone on every single inference, which is closer to a siren than an
 * alert. A cooldown keeps it "something needs attention" rather than noise an
 * operator learns to tune out.
 */
const ALERT_COOLDOWN_MS = 4000;

/**
 * Sensitivity range shown to the operator.
 *
 * Below DEFAULT_CONFIDENCE, more detections pass the threshold — including
 * fainter, smaller or more ambiguous defects — at the cost of more false
 * positives. This does not change what the model is capable of seeing; it
 * changes how confident it has to be before a detection counts. Lowering it
 * is the honest way to chase "catch the smallest defect" with a fixed model:
 * trade precision for recall, visibly and reversibly, rather than silently.
 */
const MIN_SENSITIVITY = 0.1;
const MAX_SENSITIVITY = 0.75;
const SENSITIVITY_STEP = 0.05;

const WIDE_KEY = "zemainspect:edge-wide";

type Status = "idle" | "loading" | "ready" | "running" | "error";

export function EdgeInspector({ modelUrl }: { modelUrl: string | null }) {
  const { t, language } = useTranslation();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<InferenceSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastUploadRef = useRef(0);
  const lastAlertRef = useRef(0);
  const wasFailingRef = useRef(false);
  const runningRef = useRef(false);
  const sensitivityRef = useRef(DEFAULT_CONFIDENCE);
  const soundEnabledRef = useRef(true);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [latency, setLatency] = useState(0);
  const [fps, setFps] = useState(0);
  const [lineId, setLineId] = useState("");
  const [category, setCategory] = useState<(typeof PRODUCT_CATEGORIES)[number]>("steel");
  const [upload, setUpload] = useState(true);
  const [sensitivity, setSensitivity] = useState(DEFAULT_CONFIDENCE);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [wide, setWide] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Read the saved layout preference after mount, same reasoning as the
  // sidebar's collapsed state: the server can't know it, so matching the
  // server's render (not wide) on first paint avoids a hydration mismatch.
  useEffect(() => {
    try {
      setWide(localStorage.getItem(WIDE_KEY) === "1");
    } catch {
      // No storage available — default layout is fine.
    }
  }, []);

  const toggleWide = () => {
    setWide((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(WIDE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to persist to; the toggle still works for this session.
      }
      return next;
    });
  };

  /*
   * A ticking counter while the model loads, not a bare spinner.
   *
   * A first-time load genuinely runs to 30-40+ seconds on a real network —
   * onnxruntime-web's published WebGPU bundle always downloads and compiles a
   * ~26 MB WASM runtime, a fixed cost of the library itself, not something
   * this app's own network speed or code can shrink. A silent spinner for
   * that long reads as frozen; a number that keeps moving reads as working.
   */
  useEffect(() => {
    if (status !== "loading") {
      setLoadingElapsedSec(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setLoadingElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Reflect real browser fullscreen state, including exits the operator
  // triggers with Esc rather than this component's own button.
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === videoContainerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await videoContainerRef.current?.requestFullscreen();
      }
    } catch {
      // Some browsers refuse fullscreen outside a few specific gestures, or
      // it's disabled by policy — the button simply does nothing rather than
      // throwing into the inspection loop.
    }
  }, []);

  const isFailing = status === "running" && detections.length > 0;

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus("ready");
    setFps(0);
    setDetections([]);
    wasFailingRef.current = false;

    // The last frame's bounding boxes otherwise linger on screen after the
    // camera has stopped, over a now-frozen video — a stale defect box on a
    // dead feed reads as a detection that is still happening.
    const canvas = overlayRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
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
      const lineWidth = Math.max(2, Math.round(width / 320));
      const cornerLen = Math.max(12, Math.round(width / 40));
      ctx.font = `600 ${Math.max(12, Math.round(width / 44))}px system-ui, sans-serif`;
      ctx.textBaseline = "top";

      for (const det of dets) {
        const [x, y, w, h] = det.bbox;
        const color = severityColor(det.confidence);

        // A faint glass fill inside the box, plus corner brackets rather than
        // a plain rectangle — reads as an active targeting reticle rather
        // than a static outline, and stays legible over a busy background.
        ctx.fillStyle = color.replace(/[\d.]+\)$/, "0.12)");
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        const c = Math.min(cornerLen, w / 2.5, h / 2.5);
        const corners: Array<[number, number, number, number]> = [
          [x, y, 1, 1],
          [x + w, y, -1, 1],
          [x, y + h, 1, -1],
          [x + w, y + h, -1, -1],
        ];
        for (const [cx, cy, dx, dy] of corners) {
          ctx.beginPath();
          ctx.moveTo(cx, cy + c * dy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + c * dx, cy);
          ctx.stroke();
        }

        const text = `${labelFor(det.type, language)} ${Math.round(det.confidence * 100)}%`;
        const metrics = ctx.measureText(text);
        const padding = 5;
        const boxH = Math.max(18, Math.round(width / 30));
        const labelY = Math.max(0, y - boxH);

        ctx.fillStyle = color;
        ctx.fillRect(x, labelY, metrics.width + padding * 2, boxH);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, x + padding, labelY + (boxH - Math.max(12, width / 44)) / 2);
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
      if (!workCanvasRef.current) workCanvasRef.current = document.createElement("canvas");

      /*
       * Camera permission and model loading are independent concerns, so
       * request both at once. Sequencing them — model first, camera second —
       * means a slow or failing model load silently withholds the permission
       * prompt an operator is staring at the screen waiting for, which reads
       * as "the browser never asked for my camera" when the real story is
       * "it never got that far."
       *
       * allSettled, NOT all: `Promise.all` rejects the instant either side
       * fails, which orphans whatever the other side produced. When the model
       * failed, that meant a camera stream that had already been granted —
       * hardware light on — was dropped on the floor without ever being
       * attached to the video element OR stopped. The operator saw an active
       * camera light above a black frame, which looks like a broken camera
       * when the real failure was the model. Settling both lets us release
       * the camera deliberately when we can't use it.
       */
      const [cameraResult, sessionResult] = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" },
          audio: false,
        }),
        sessionRef.current ? Promise.resolve(sessionRef.current) : loadWebSession(modelUrl),
      ]);

      if (cameraResult.status === "fulfilled" && sessionResult.status !== "fulfilled") {
        // Never hold a camera we aren't about to draw. Releasing the tracks
        // turns the hardware indicator back off, so the light always tells
        // the truth about whether we are actually capturing.
        cameraResult.value.getTracks().forEach((track) => track.stop());
      }

      if (sessionResult.status === "rejected") throw sessionResult.reason;
      if (cameraResult.status === "rejected") throw cameraResult.reason;

      const stream = cameraResult.value;
      sessionRef.current = sessionResult.value;
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();

      runningRef.current = true;
      wasFailingRef.current = false;
      lastAlertRef.current = 0;
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
              sensitivityRef.current,
            );

            // Stop() can land while this inference call is in flight — it
            // clears the overlay and releases the camera, but this promise
            // still resolves afterwards. Without this check, a frame that
            // finishes after stop redraws a bounding box onto the now-frozen
            // video, which reads as a defect that's still being detected.
            if (!runningRef.current) return;

            setDetections(result.detections);
            setLatency(result.processingTimeMs);
            drawOverlay(result.detections, video.videoWidth, video.videoHeight);

            const failingNow = result.detections.length > 0;
            const now = Date.now();
            if (failingNow) {
              if (soundEnabledRef.current && now - lastAlertRef.current > ALERT_COOLDOWN_MS) {
                lastAlertRef.current = now;
                playDefectAlert();
              }
            } else if (wasFailingRef.current && soundEnabledRef.current) {
              playClearTone();
            }
            wasFailingRef.current = failingNow;

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
        <div className="flex items-center gap-2">
          <GlassButton
            size="sm"
            variant="ghost"
            onClick={toggleWide}
            aria-label={wide ? t("edge.narrowPanel") : t("edge.widenPanel")}
            title={wide ? t("edge.narrowPanel") : t("edge.widenPanel")}
          >
            {wide ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            )}
          </GlassButton>
          {status === "running" && (
            <GlassButton
              size="sm"
              variant="ghost"
              onClick={() => setSoundEnabled((v) => !v)}
              aria-label={soundEnabled ? t("edge.muteAlerts") : t("edge.unmuteAlerts")}
              title={soundEnabled ? t("edge.muteAlerts") : t("edge.unmuteAlerts")}
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <VolumeX className="h-3.5 w-3.5" aria-hidden />
              )}
            </GlassButton>
          )}
          {status === "running" ? (
            <GlassButton size="sm" variant="danger" onClick={stop}>
              <CircleStop className="h-3.5 w-3.5" aria-hidden />
              {t("edge.stop")}
            </GlassButton>
          ) : (
            <GlassButton size="sm" onClick={() => void start()} loading={status === "loading"}>
              <Camera className="h-3.5 w-3.5" aria-hidden />
              {status === "loading"
                ? t("edge.loadingModelElapsed", { seconds: loadingElapsedSec })
                : t("edge.start")}
            </GlassButton>
          )}
        </div>
      }
    >
      <div className={cn("grid gap-4", wide ? "grid-cols-1" : "lg:grid-cols-[2fr_1fr]")}>
        <div
          ref={videoContainerRef}
          className={cn(
            "relative overflow-hidden bg-black/80 ring-2 ring-transparent transition-all duration-200",
            isFailing && "animate-pulse ring-fail",
            // In real fullscreen this element becomes the entire viewport —
            // fill that space edge to edge rather than keeping the card's
            // rounded corners and fixed aspect ratio.
            isFullscreen ? "rounded-none" : "rounded-xl",
          )}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn(
              "w-full object-contain",
              isFullscreen ? "h-dvh max-h-none" : "aspect-video",
            )}
          />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
          <div className="absolute right-2 bottom-2">
            <GlassButton
              size="sm"
              variant="ghost"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? t("edge.exitFullscreen") : t("edge.fullscreen")}
              title={isFullscreen ? t("edge.exitFullscreen") : t("edge.fullscreen")}
              className="bg-black/40 text-white hover:bg-black/60"
            >
              {isFullscreen ? (
                <Shrink className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Expand className="h-3.5 w-3.5" aria-hidden />
              )}
            </GlassButton>
          </div>
          {status === "running" && (
            <>
              <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                <Badge tone="accent">
                  <Cpu className="h-3 w-3" aria-hidden /> {edgeBackend()}
                </Badge>
                <Badge>{t("edge.fps", { value: fps })}</Badge>
                <Badge>{t("edge.inferenceMs", { value: latency })}</Badge>
              </div>
              <div className="absolute right-2 top-2">
                {isFailing ? (
                  <Badge tone="fail" className="animate-pulse px-2.5 py-1 text-xs font-semibold">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    {t("edge.statusFail")}
                  </Badge>
                ) : (
                  <Badge tone="pass" className="px-2.5 py-1 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    {t("edge.statusPass")}
                  </Badge>
                )}
              </div>
            </>
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

          <div>
            <FieldLabel htmlFor="edge-sensitivity" hint={t("edge.sensitivityHint")}>
              {t("edge.sensitivity")} — {Math.round(sensitivity * 100)}%
            </FieldLabel>
            <input
              id="edge-sensitivity"
              type="range"
              min={MIN_SENSITIVITY}
              max={MAX_SENSITIVITY}
              step={SENSITIVITY_STEP}
              value={sensitivity}
              onChange={(event) => setSensitivity(Number(event.target.value))}
              className="h-2 w-full cursor-pointer accent-[rgb(var(--accent))]"
            />
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
                <Badge key={index} tone={severityTone(det.confidence)}>
                  {labelFor(det.type, language)} {Math.round(det.confidence * 100)}%
                </Badge>
              ))}
            </div>
          )}

          {status === "loading" && loadingElapsedSec >= 5 && (
            <p className="text-xs text-ink-muted">{t("edge.loadingModelHint")}</p>
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
