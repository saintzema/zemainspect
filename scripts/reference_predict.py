#!/usr/bin/env python3
"""
Produce reference detections with Ultralytics' own pipeline.

Companion to scripts/verify-parity.ts. Run this first, then the TypeScript
side compares against its output:

    .venv/bin/python scripts/reference_predict.py ref.json samples/*.jpg
    npx tsx scripts/verify-parity.ts ./samples ./ref.json

Thresholds here must match the ones in verify-parity.ts.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

MODEL = "public/models/yolov8n-neu.onnx"
CONFIDENCE = 0.05
IOU = 0.45
IMGSZ = 640


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: reference_predict.py <out.json> <image> [image ...]", file=sys.stderr)
        return 2

    try:
        from ultralytics import YOLO
    except ImportError:
        print('error: pip install "ultralytics>=8.3" onnxruntime', file=sys.stderr)
        return 1

    out_path = Path(sys.argv[1])
    images = sys.argv[2:]

    if not Path(MODEL).is_file():
        print(f"error: {MODEL} not found — run scripts/export_onnx.py first", file=sys.stderr)
        return 1

    model = YOLO(MODEL, task="detect")
    results: dict[str, list[dict]] = {}

    for image in images:
        r = model.predict(image, imgsz=IMGSZ, conf=CONFIDENCE, iou=IOU, verbose=False)[0]
        detections = []
        for box in r.boxes:
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            detections.append(
                {
                    "type": r.names[int(box.cls[0])],
                    "confidence": round(float(box.conf[0]), 4),
                    # [x, y, w, h], matching the app's Detection shape.
                    "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
                }
            )
        detections.sort(key=lambda d: -d["confidence"])
        results[Path(image).name] = detections

    out_path.write_text(json.dumps(results, indent=2))
    total = sum(len(v) for v in results.values())
    print(f"Wrote {out_path} — {total} detections across {len(results)} images")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
