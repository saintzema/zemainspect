# Line-camera bridge

Connects a camera a plant already has — an RTSP IP camera, a CCTV encoder, a
USB machine-vision camera, an existing NVR's output — to ZemaInspect. The
dashboard's in-browser Edge inspector only ever sees a webcam attached to
whatever device is running the browser tab; it cannot reach an RTSP stream
from a camera bolted over the line. This script is the bridge: it reads
frames from the camera and POSTs them to the same `/v1/inspect` REST API a
curl one-liner or the edge inspector's own upload path calls, documented at
`<your-deployment>/docs`.

It does not run any inference itself and needs no GPU — the model runs on
the server. It just needs to reach the camera on one side and the internet
(or your on-prem deployment) on the other.

## Requirements

- Python 3.9+
- A camera reachable from the machine running this script — a line PC, an
  edge gateway, or even a Raspberry Pi is enough

```bash
pip install -r requirements.txt
```

## Quick start

```bash
cp bridge.example.ini bridge.ini
# edit bridge.ini: source, base_url, api_key, line_id
python3 bridge.py --config bridge.ini
```

Or without a config file:

```bash
python3 bridge.py \
  --source rtsp://192.168.1.50:554/stream1 \
  --base-url https://zemainspect.vercel.app \
  --api-key zi_live_... \
  --line-id PRESS-SHOP-1
```

Test the whole path before wiring a real camera by pointing `--source` at a
video file of the part instead — same code path, no camera required.

## Finding your camera's RTSP URL

The two encoder brands most common on a Chinese factory floor:

| Brand | Typical RTSP URL |
|---|---|
| Hikvision | `rtsp://<user>:<pass>@<ip>:554/Streaming/Channels/101` |
| Dahua | `rtsp://<user>:<pass>@<ip>:554/cam/realmonitor?channel=1&subtype=0` |

`channel=1`/`Channels/101` addresses the first camera on a multi-channel NVR;
adjust the number for another channel. Most encoders also expose an ONVIF
discovery port (commonly 80 or 8000) if the RTSP path isn't documented on the
device itself — the vendor's own configuration tool (iVMS-4200 for
Hikvision, SmartPSS for Dahua) will show the exact stream URL under the
camera's network settings.

A GigE Vision or USB3 machine-vision camera (Basler, Hikrobot, MindVision)
typically ships with its own SDK rather than exposing RTSP; for those,
`--source 0` (or `1`, `2`, ...) works if the vendor's driver registers it as
a standard V4L2/DirectShow device, which most do.

## Running unattended

An operator restarting a script by hand every time a line PC reboots is not
a deployment. Pick the one that matches your line PC's OS.

### Linux: systemd

```ini
# /etc/systemd/system/zemainspect-bridge.service
[Unit]
Description=ZemaInspect line-camera bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/zemainspect-bridge
ExecStart=/usr/bin/python3 /opt/zemainspect-bridge/bridge.py --config /opt/zemainspect-bridge/bridge.ini
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zemainspect-bridge
journalctl -u zemainspect-bridge -f   # watch it live
```

### Windows: Task Scheduler

1. Task Scheduler → Create Task → General: run whether user is logged on or
   not; "Run with highest privileges".
2. Triggers: "At startup".
3. Actions: Start a program — `python.exe`, arguments
   `bridge.py --config bridge.ini`, "Start in" set to this folder.
4. Settings: check "If the task fails, restart every" and set it to 1
   minute, restart up to a large number of times — this is what plays the
   role of systemd's `Restart=always` on Windows.

## What it does and does not do

- Reads frames, encodes JPEG, POSTs to `/v1/inspect` — nothing else. Alerts,
  dashboards, and MES/ERP notification are the server's job: configure a
  result webhook under Settings once, and every inspection this bridge
  posts — from any line, any camera — reaches it the same way.
- Samples on an interval (`interval_seconds`, default 5s), not every camera
  frame. A production line does not need, and a plan's quota cannot absorb,
  an inspection at 15-30fps.
- Reconnects on a dropped stream or a network blip and backs off on repeated
  failures rather than stopping — a script that needs a human to notice it
  died and restart it by hand defeats the point of running unattended.
- Never invents a verdict: a rejected frame (a bad key, quota reached, no
  model deployed for the selected category) is logged and the loop
  continues to the next interval, exactly as the API reports it.

## Troubleshooting

- **"could not open camera source"** — the RTSP URL, credentials, or network
  route is wrong before this script is ever involved; confirm the stream
  opens in VLC (`Media > Open Network Stream`) with the exact same URL
  first.
- **API key rejected (401)** — the key was revoked, or copied with a
  trailing space/newline from wherever it was stored.
- **429 / quota reached** — expected behaviour on a trial plan once the
  monthly limit is hit; a paid plan keeps inspecting and bills overage
  instead (see `/docs` → Errors).
- **503 / no model deployed** — `product_category` is set to `general` or
  `automotive` on a deployment that only ships the bundled steel model. Use
  `steel`, or deploy weights for that category first.
