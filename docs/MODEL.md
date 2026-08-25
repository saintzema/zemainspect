# The detection model

**The model is already in this repo and working.** You only need this document
to re-export it, swap in a retrained checkpoint, or move it off-repo.

| File | What it is |
|---|---|
| `weights/yolov8n_neu_best.pt` | the trained YOLOv8n checkpoint (6.0 MB, 3,006,818 params) |
| `public/models/yolov8n-neu.onnx` | the deployed export (11.7 MB, opset 12) |

The export was verified against Ultralytics' own inference — see
`scripts/verify-parity.ts` and the README section on it.

## 1. Where the weights came from

The trained YOLOv8 runs live in Google Drive under `ClosedMfgAI/`:

| Variant | Path | Size | mAP@0.5 |
|---|---|---|---|
| **YOLOv8n** | `yolov8n_neu-2/weights/best.pt` | 6.3 MB | **73.6%** |
| YOLOv8s | `yolov8s_neu-3/weights/best.pt` | 21 MB | 73.3% |
| YOLOv8m | `yolov8m_neu-2/weights/best.pt` | 52 MB | 73.2% |
| YOLOv8l | `yolov8l_neu/weights/best.pt` | 87.7 MB | 74.1% |

Use **yolov8n**. It is within 0.5 points of the large model, 14× smaller, and
the only one small enough to run in a browser on a factory tablet.

## 2. Export to ONNX

```bash
pip install "ultralytics>=8.3" onnx onnxslim onnxruntime
python scripts/export_onnx.py \
  --weights /path/to/yolov8n_neu-2/weights/best.pt \
  --out public/models/yolov8n-neu.onnx
```

The script pins the flags the app depends on and then **verifies the export**:
it loads the result in onnxruntime, runs one inference, and fails if the output
is not a single `[1, 10, anchors]` tensor. A silently wrong export is the worst
failure mode here — it produces confident, wrongly-labelled boxes — so this
check is not optional.

It also compares the class names baked into the checkpoint against
`NEU_CLASSES` in `lib/inference/labels.ts` and warns on any mismatch. **Class
order is load-bearing**: index 0 must be `crazing`, index 5 must be
`scratches`. Reordering silently mislabels every detection.

The exported file is roughly 12 MB.

## 3. Deploy it

Two options; both are supported and cost nothing.

### Option A — commit it (simplest)

```bash
git add -f public/models/yolov8n-neu.onnx    # -f: *.onnx is gitignored
git commit -m "chore: add exported NEU detection weights"
```

The deploy is then hermetic — no runtime fetch, no external dependency. 12 MB
is fine for git.

### Option B — host on Hugging Face (keeps binaries out of git)

```bash
pip install huggingface_hub
huggingface-cli login
huggingface-cli upload <user>/zemainspect-neu \
  public/models/yolov8n-neu.onnx yolov8n-neu.onnx
```

Then set:

```
MODEL_URL="https://huggingface.co/<user>/zemainspect-neu/resolve/main/yolov8n-neu.onnx"
```

A public HF model repo needs no token and no payment. For a private repo, also
set `HUGGINGFACE_TOKEN`. The server fetches once per cold start and caches to
the function's tmp disk; warm invocations pay nothing.

**Note:** the browser edge path loads the model from `/models/...` on this
app's own origin, not from `MODEL_URL`. If you use Option B and want edge
inference too, either also commit the file or add a small proxy route — a
factory network that blocks Hugging Face would otherwise break the edge path,
which is exactly the case it exists to serve.

## 4. Verify

```bash
curl -X POST https://<your-app>/api/v1/inspect \
  -H "Authorization: Bearer zi_live_..." \
  -F "image=@a-defective-sample.jpg" \
  -F "product_category=steel"
```

A correct deployment returns detections with `model_variant: "yolov8n-neu-onnx"`.
`503 model_unavailable` means neither the committed file nor `MODEL_URL`
resolved.

## Higher accuracy (optional)

For Pro/Enterprise customers who need YOLOv8l, deploy a FastAPI service on a
GPU host (Modal, RunPod, Fly GPU) exposing `POST /predict` and returning
`{ detections: [{ type, confidence, bbox }] }`. Set `INFERENCE_SERVICE_URL` and
`INFERENCE_SERVICE_API_KEY`; Pro and Enterprise organizations route there
automatically, and fall back to the local nano model if it is unreachable —
a factory line should not stop because a GPU host blipped.

Only worth the hosting cost once a customer is paying for it. The benchmark
says the accuracy gain is 0.5 points.
