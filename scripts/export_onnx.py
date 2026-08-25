#!/usr/bin/env python3
"""
Export trained YOLOv8 weights to the ONNX file ZemaInspect serves.

This is the one step that must run somewhere with the .pt file and internet
access — a Colab notebook, or any machine with the weights on disk.

    pip install "ultralytics>=8.3" onnx onnxslim onnxruntime
    python scripts/export_onnx.py --weights best.pt --out public/models/yolov8n-neu.onnx

Why these flags:

  opset=12      widely supported by onnxruntime-node AND onnxruntime-web
  imgsz=640     matches MODEL_INPUT_SIZE in lib/inference/model-source.ts
  dynamic=False a fixed 1x3x640x640 input lets the runtime plan more
                aggressively; the app always letterboxes to exactly this size
  simplify=True folds constants, which measurably cuts WASM startup cost
  nms=False     the app runs its own NMS in lib/inference/postprocess.ts, and
                that same code path is shared with the browser build. Baking
                NMS into the graph would change the output shape and break the
                decoder.

The exported graph must produce a single output of shape [1, 4+nc, anchors].
The script verifies that before it finishes, so a wrong export fails here
rather than silently mislabelling defects in production.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

# Must match configs/neu_defects.yaml in the ClosedMfgAI training repo,
# and NEU_CLASSES in lib/inference/labels.ts. Order is load-bearing.
EXPECTED_CLASSES = [
    "crazing",
    "inclusion",
    "patches",
    "pitted_surface",
    "rolled-in_scale",
    "scratches",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True, help="Path to best.pt")
    parser.add_argument(
        "--out",
        default="public/models/yolov8n-neu.onnx",
        help="Destination .onnx path",
    )
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--opset", type=int, default=12)
    args = parser.parse_args()

    weights = Path(args.weights)
    if not weights.is_file():
        print(f"error: no such weights file: {weights}", file=sys.stderr)
        return 1

    try:
        from ultralytics import YOLO
    except ImportError:
        print(
            'error: ultralytics is not installed. Run:\n'
            '  pip install "ultralytics>=8.3" onnx onnxslim onnxruntime',
            file=sys.stderr,
        )
        return 1

    model = YOLO(str(weights))

    names = model.names
    ordered = [names[i] for i in sorted(names)] if isinstance(names, dict) else list(names)
    print(f"Model classes ({len(ordered)}): {ordered}")

    if ordered != EXPECTED_CLASSES:
        print(
            "\nwarning: class names differ from the NEU order the app expects."
            f"\n  expected: {EXPECTED_CLASSES}"
            f"\n  found:    {ordered}"
            "\nUpdate NEU_CLASSES in lib/inference/labels.ts to match, or every"
            " detection will carry the wrong label.\n",
            file=sys.stderr,
        )

    exported = model.export(
        format="onnx",
        opset=args.opset,
        imgsz=args.imgsz,
        dynamic=False,
        simplify=True,
        nms=False,
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(exported), out)
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"\nWrote {out} ({size_mb:.1f} MB)")

    if not verify(out, args.imgsz, len(ordered)):
        return 1

    print("\nNext:")
    print(f"  • Commit it:  git add -f {out}")
    print("  • Or host it: upload to a Hugging Face model repo and set MODEL_URL")
    return 0


def verify(path: Path, imgsz: int, num_classes: int) -> bool:
    """Run one inference so a broken export fails here, not in production."""
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        print("note: onnxruntime not installed; skipping verification.")
        return True

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    inp = session.get_inputs()[0]
    outputs = session.get_outputs()

    print(f"\nInput:  {inp.name} {inp.shape}")
    for out in outputs:
        print(f"Output: {out.name} {out.shape}")

    if len(outputs) != 1:
        print(
            f"error: expected exactly 1 output, got {len(outputs)}."
            " Re-export with nms=False.",
            file=sys.stderr,
        )
        return False

    dummy = np.zeros((1, 3, imgsz, imgsz), dtype=np.float32)
    result = session.run(None, {inp.name: dummy})[0]
    print(f"Inference OK — output shape {result.shape}")

    if len(result.shape) != 3 or result.shape[1] != 4 + num_classes:
        print(
            f"error: expected shape [1, {4 + num_classes}, anchors],"
            f" got {result.shape}. The decoder in"
            " lib/inference/postprocess.ts will reject this.",
            file=sys.stderr,
        )
        return False

    return True


if __name__ == "__main__":
    raise SystemExit(main())
