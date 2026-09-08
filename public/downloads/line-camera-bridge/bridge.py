#!/usr/bin/env python3
"""
ZemaInspect line-camera bridge.

The dashboard's Edge inspector runs the model inside a browser tab, using
getUserMedia — which only ever sees a webcam attached to whatever device is
running that browser. It cannot see an RTSP feed from a CCTV encoder, a
GigE/USB machine-vision camera bolted over the line, or an existing NVR's
output — the cameras most plants already have.

This script is the other side of the same REST API the edge inspector calls
(POST /api/v1/inspect, documented at <your-deployment>/docs): it reads frames
from whatever camera a line PC can already reach, and posts them the same
way. It does not run inference itself and does not need a GPU — the model
runs on the server. Point it at any of:

  - An RTSP URL      --source rtsp://192.168.1.50:554/stream1
  - An HTTP MJPEG/IP camera stream --source http://192.168.1.50/video
  - A USB/V4L2 webcam by index      --source 0
  - A video file, for a dry run before wiring a real camera --source clip.mp4

All four are the same OpenCV VideoCapture underneath, which is why one
script covers them: the differences between camera hardware live in the
camera's own network config, not in this code.

Usage:
    python3 bridge.py --config bridge.ini
    python3 bridge.py --source rtsp://... --api-key zi_live_... \\
        --base-url https://zemainspect.vercel.app --line-id PRESS-SHOP-1

See README.md in this directory for the systemd unit (Linux line PC) and
Task Scheduler notes (Windows line PC) that keep this running unattended.
"""

from __future__ import annotations

import argparse
import configparser
import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

try:
    import cv2
except ImportError:  # pragma: no cover - guidance path, not a code branch to test
    print(
        "OpenCV is required: pip install opencv-python-headless\n"
        "(see requirements.txt in this directory)",
        file=sys.stderr,
    )
    raise

log = logging.getLogger("zemainspect-bridge")


@dataclass
class BridgeConfig:
    source: str
    """Camera source: an RTSP/HTTP URL, a USB device index, or a video file path."""
    base_url: str
    api_key: str
    line_id: str
    product_category: str = "steel"
    interval_seconds: float = 5.0
    """
    Seconds between inspections, not between frames read. A camera streams at
    15-30fps; a production line does not need — and a plan's quota cannot
    absorb — an inspection at that rate. Every frame in between is read and
    discarded to keep the capture buffer from filling with stale frames,
    which is what produces the "camera feed is several seconds behind
    reality" symptom on a long-running capture.
    """
    confidence: Optional[float] = None
    store_image: bool = True
    reconnect_delay_seconds: float = 5.0
    request_timeout_seconds: float = 15.0
    max_consecutive_failures_before_backoff: int = 5


def load_config(args: argparse.Namespace) -> BridgeConfig:
    """
    CLI flags win over a config file, which wins over nothing. A factory IT
    engineer editing bridge.ini to point at their own camera should not also
    have to re-type the flags they are not changing.
    """
    file_values: dict[str, str] = {}
    if args.config:
        parser = configparser.ConfigParser()
        read_files = parser.read(args.config)
        if not read_files:
            raise SystemExit(f"Could not read config file: {args.config}")
        if parser.has_section("bridge"):
            file_values = dict(parser.items("bridge"))

    def get(flag_value, key: str, default=None, cast=str):
        if flag_value is not None:
            return flag_value
        if key in file_values:
            return cast(file_values[key])
        return default

    source = get(args.source, "source")
    base_url = get(args.base_url, "base_url")
    api_key = get(args.api_key, "api_key")
    line_id = get(args.line_id, "line_id")
    if not source or not base_url or not api_key or not line_id:
        raise SystemExit(
            "Missing required setting(s): source, base_url, api_key, line_id "
            "(pass as flags or put them in --config bridge.ini)"
        )

    return BridgeConfig(
        source=source,
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        line_id=line_id,
        product_category=get(args.product_category, "product_category", "steel"),
        interval_seconds=get(args.interval, "interval_seconds", 5.0, float),
        confidence=get(args.confidence, "confidence", None, float),
        store_image=get(None, "store_image", True, lambda v: v.strip().lower() not in ("0", "false", "no")),
        reconnect_delay_seconds=get(None, "reconnect_delay_seconds", 5.0, float),
        request_timeout_seconds=get(None, "request_timeout_seconds", 15.0, float),
        max_consecutive_failures_before_backoff=get(
            None, "max_consecutive_failures_before_backoff", 5, int
        ),
    )


def open_capture(source: str) -> "cv2.VideoCapture":
    """
    A bare integer string ("0", "1") means a local USB/V4L2 device by index;
    anything else (rtsp://, http://, a file path) is passed straight to
    OpenCV, which already knows how to open all of them.
    """
    resolved = int(source) if source.isdigit() else source
    capture = cv2.VideoCapture(resolved)
    # A modest buffer keeps the read loop from ever serving a frame more than
    # one interval stale; OpenCV's default buffering can otherwise queue up
    # tens of seconds of frames the loop never asked for.
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return capture


def encode_jpeg(frame) -> bytes:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return buffer.tobytes()


class InspectionError(Exception):
    """Raised for a response the caller should log and move past, not retry immediately."""


def post_inspection(config: BridgeConfig, jpeg_bytes: bytes, session: requests.Session) -> dict:
    """
    The same POST /api/v1/inspect a curl one-liner or the edge inspector's
    own upload path calls — this script has no special access, on purpose:
    anything wrong with a request built here would be equally wrong for any
    other integration built against the documented API.
    """
    files = {"image": ("frame.jpg", jpeg_bytes, "image/jpeg")}
    data = {
        "product_category": config.product_category,
        "line_id": config.line_id,
        "store_image": "true" if config.store_image else "false",
    }
    if config.confidence is not None:
        data["confidence"] = str(config.confidence)

    response = session.post(
        f"{config.base_url}/api/v1/inspect",
        headers={"Authorization": f"Bearer {config.api_key}"},
        files=files,
        data=data,
        timeout=config.request_timeout_seconds,
    )

    if response.status_code == 401:
        raise InspectionError("API key rejected (401) — check it hasn't been revoked")
    if response.status_code == 402:
        raise InspectionError("Subscription inactive or trial expired (402)")
    if response.status_code == 429:
        raise InspectionError("Monthly quota reached (429)")
    if response.status_code == 503:
        raise InspectionError("No model deployed for this product category (503)")
    if not response.ok:
        raise InspectionError(f"HTTP {response.status_code}: {response.text[:300]}")

    return response.json()


def run(config: BridgeConfig) -> None:
    log.info(
        "starting: source=%s line=%s category=%s interval=%.1fs -> %s",
        config.source, config.line_id, config.product_category,
        config.interval_seconds, config.base_url,
    )

    session = requests.Session()
    consecutive_failures = 0

    while True:
        capture = open_capture(config.source)
        if not capture.isOpened():
            log.error(
                "could not open camera source %r — retrying in %.0fs",
                config.source, config.reconnect_delay_seconds,
            )
            capture.release()
            time.sleep(config.reconnect_delay_seconds)
            continue

        log.info("camera opened")
        last_inspection_at = 0.0

        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    # OpenCV reports end-of-stream and a genuinely dropped
                    # connection identically. For a live camera this is a
                    # real drop; for a finite test file (the dry-run
                    # workflow in README.md) this is just its end, and the
                    # reconnect below is what loops it. Worded to not alarm
                    # someone deliberately testing with a short clip.
                    log.warning("camera stream ended or dropped — reconnecting")
                    break

                now = time.monotonic()
                if now - last_inspection_at < config.interval_seconds:
                    continue
                last_inspection_at = now

                try:
                    jpeg_bytes = encode_jpeg(frame)
                    result = post_inspection(config, jpeg_bytes, session)
                    consecutive_failures = 0
                    verdict = result.get("result", "?")
                    defects = result.get("defects", [])
                    if verdict == "fail":
                        names = ", ".join(f"{d['type']} {d['confidence']:.0%}" for d in defects)
                        log.warning("FAIL  inspection=%s  %s", result.get("inspection_id"), names)
                    else:
                        log.info("pass  inspection=%s", result.get("inspection_id"))
                except InspectionError as exc:
                    consecutive_failures += 1
                    log.error("inspection rejected: %s", exc)
                except requests.RequestException as exc:
                    consecutive_failures += 1
                    log.error("network error posting inspection: %s", exc)

                # Back off, not stop: a network blip or a momentary 5xx must
                # not need a human to restart the service. A line running
                # unattended overnight is the entire point of this script.
                if consecutive_failures >= config.max_consecutive_failures_before_backoff:
                    backoff = min(60.0, config.interval_seconds * consecutive_failures)
                    log.error(
                        "%d consecutive failures — backing off %.0fs",
                        consecutive_failures, backoff,
                    )
                    time.sleep(backoff)
        finally:
            capture.release()

        time.sleep(config.reconnect_delay_seconds)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, help="Path to a bridge.ini config file")
    parser.add_argument("--source", help="rtsp://..., http://..., a USB device index, or a video file")
    parser.add_argument("--base-url", dest="base_url", help="e.g. https://zemainspect.vercel.app")
    parser.add_argument("--api-key", dest="api_key", help="zi_live_... from Dashboard > API keys")
    parser.add_argument("--line-id", dest="line_id", help="Free-form line identifier, e.g. PRESS-SHOP-1")
    parser.add_argument("--product-category", dest="product_category", help="steel (default), general, automotive")
    parser.add_argument("--interval", type=float, help="Seconds between inspections (default 5.0)")
    parser.add_argument("--confidence", type=float, help="Override the server's default detection threshold")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
    )
    config = load_config(args)
    try:
        run(config)
    except KeyboardInterrupt:
        log.info("stopped")


if __name__ == "__main__":
    main()
