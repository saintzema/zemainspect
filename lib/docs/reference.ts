import type { Language } from "@/lib/i18n/language-context";

/**
 * The integration reference, as data.
 *
 * This is the page a Chinese plant's IT engineer opens while the demo is still
 * running, to answer one question: "how does this talk to the system we
 * already have?" It has to be bilingual and it has to be true — a docs page
 * that promises a field the API does not accept is worse than no docs page,
 * because it fails on their line rather than in the meeting.
 *
 * Content lives here rather than in the dictionary JSON because `t()` resolves
 * strings only, and this page is tables, code and prose in a fixed order. The
 * shape is checked by tests/docs-reference.test.ts, which fails the build if
 * any block is missing a translation — half-Chinese docs in front of a Chinese
 * buyer is exactly the failure this structure exists to prevent.
 */

/** A string that exists in both languages. Code samples are not one of these. */
export interface Localised {
  en: string;
  zh: string;
}

export type Block =
  | { kind: "p"; text: Localised }
  | { kind: "h3"; text: Localised }
  | { kind: "list"; items: Localised[] }
  | { kind: "note"; tone: "info" | "warn"; text: Localised }
  | { kind: "code"; language: string; code: string; caption?: Localised }
  | { kind: "table"; head: Localised[]; rows: Localised[][] };

export interface DocSection {
  /** Anchor id, also the table-of-contents target. */
  id: string;
  title: Localised;
  blocks: Block[];
}

export function pick(value: Localised, language: Language): string {
  return language === "zh" ? value.zh : value.en;
}

const L = (en: string, zh: string): Localised => ({ en, zh });

/* -------------------------------------------------------------------------- */

const quickstart: DocSection = {
  id: "quickstart",
  title: L("Quick start", "快速开始"),
  blocks: [
    {
      kind: "p",
      text: L(
        "Three steps from a running line to results in your MES. Create a key in the dashboard, POST a frame, read the verdict. Everything else on this page is detail.",
        "从产线到 MES 只需三步：在控制台创建密钥、POST 一帧图像、读取判定结果。本页其余内容都是细节说明。",
      ),
    },
    {
      kind: "code",
      language: "bash",
      caption: L(
        "Inspect a single frame from any machine on the shop floor.",
        "从车间任意一台设备检测单帧图像。",
      ),
      code: `curl -X POST https://zemainspect.vercel.app/api/v1/inspect \\
  -H "Authorization: Bearer zi_live_..." \\
  -F "image=@coil.jpg" \\
  -F "line_id=PRESS-SHOP-1" \\
  -F "product_category=steel"`,
    },
    {
      kind: "code",
      language: "json",
      caption: L("A failing part, in the response body.", "响应体中的不合格判定。"),
      code: `{
  "inspection_id": "insp_cm3x...",
  "result": "fail",
  "defects": [
    { "type": "scratches", "confidence": 0.9134, "bbox": [120, 64, 88, 32] }
  ],
  "model_variant": "yolov8n-neu-onnx",
  "processing_time_ms": 42,
  "processed_at": "2026-09-01T12:00:00.000Z"
}`,
    },
    {
      kind: "note",
      tone: "info",
      text: L(
        "No SDK to install and no agent to deploy. If your line PC can run curl or open an HTTPS socket, it can drive ZemaInspect.",
        "无需安装 SDK，也无需部署代理程序。只要产线工控机能运行 curl 或建立 HTTPS 连接，就能接入 ZemaInspect。",
      ),
    },
  ],
};

const auth: DocSection = {
  id: "authentication",
  title: L("Authentication", "身份认证"),
  blocks: [
    {
      kind: "p",
      text: L(
        "Every request carries an API key created under API keys in the dashboard. Issue one key per line PC or per integration, so revoking a compromised station never stops the rest of the plant.",
        "每个请求都需携带在控制台「API 密钥」页面创建的密钥。建议为每台产线工控机或每个集成单独签发一把密钥，这样吊销某一工位的密钥不会影响全厂其他产线。",
      ),
    },
    {
      kind: "code",
      language: "http",
      code: `Authorization: Bearer zi_live_...`,
    },
    {
      kind: "note",
      tone: "warn",
      text: L(
        "Keys are stored only as a SHA-256 hash, so the plaintext is shown exactly once at creation — copy it then. Revocation takes effect immediately, on the next request.",
        "密钥仅以 SHA-256 哈希形式存储，明文只在创建时显示一次，请当场复制保存。吊销在下一个请求时立即生效。",
      ),
    },
  ],
};

const inspect: DocSection = {
  id: "inspect",
  title: L("POST /v1/inspect", "POST /v1/inspect"),
  blocks: [
    {
      kind: "p",
      text: L(
        "Inspect one frame. Body is multipart/form-data.",
        "检测单帧图像。请求体为 multipart/form-data。",
      ),
    },
    {
      kind: "table",
      head: [
        L("Field", "字段"),
        L("Type", "类型"),
        L("Required", "必填"),
        L("Notes", "说明"),
      ],
      rows: [
        [
          L("image", "image"),
          L("file", "文件"),
          L("yes", "是"),
          L("JPEG / PNG / WebP, max 12 MB", "JPEG / PNG / WebP，最大 12 MB"),
        ],
        [
          L("product_category", "product_category"),
          L("string", "字符串"),
          L("no", "否"),
          L(
            "steel (default), general, automotive",
            "steel（默认）、general、automotive",
          ),
        ],
        [
          L("line_id", "line_id"),
          L("string", "字符串"),
          L("no", "否"),
          L(
            "Free-form. Appears in the feed and trends, so use your own line codes.",
            "自由格式。会显示在实时列表和趋势分析中，建议直接使用贵厂的产线编号。",
          ),
        ],
        [
          L("store_image", "store_image"),
          L("boolean", "布尔值"),
          L("no", "否"),
          L(
            "false skips image retention on high-volume lines.",
            "设为 false 可在高产量产线上跳过图像留存。",
          ),
        ],
        [
          L("confidence", "confidence"),
          L("number", "数值"),
          L("no", "否"),
          L("0.01–0.99, default 0.25", "0.01–0.99，默认 0.25"),
        ],
      ],
    },
    {
      kind: "p",
      text: L(
        "result is \"fail\" when at least one defect scores above the threshold, otherwise \"pass\". bbox is [x, y, width, height] in pixels of the original submitted image, top-left origin — no rescaling needed on your side.",
        "当至少有一个缺陷得分超过阈值时 result 为 \"fail\"，否则为 \"pass\"。bbox 为 [x, y, 宽, 高]，单位是所提交原图的像素，原点在左上角——贵方无需再做任何坐标换算。",
      ),
    },
    {
      kind: "note",
      tone: "info",
      text: L(
        "A \"degraded\": true field means the high-accuracy service was unreachable and the local model served the request instead. The response is still valid; treat it as a signal to check the link, not to stop the line.",
        "若响应中出现 \"degraded\": true，表示高精度服务不可达，该请求由本地模型完成。结果依然有效；这是提示检查网络链路的信号，而非停线信号。",
      ),
    },
  ],
};

const batch: DocSection = {
  id: "batch",
  title: L("Batch inspection", "批量检测"),
  blocks: [
    {
      kind: "p",
      text: L(
        "For end-of-shift review rather than live line inspection. POST /v1/inspect/batch takes 1–20 images per call as the images field, plus the same product_category, line_id and store_images options.",
        "适用于交接班后的复检，而非产线实时检测。POST /v1/inspect/batch 通过 images 字段每次接收 1–20 张图像，并支持相同的 product_category、line_id 与 store_images 参数。",
      ),
    },
    {
      kind: "code",
      language: "json",
      caption: L("202 Accepted", "202 Accepted"),
      code: `{
  "batch_id": "batch_cm3x...",
  "status": "completed",
  "total": 12,
  "processed": 12,
  "failed": 0,
  "status_url": "/api/v1/inspect/batch/batch_cm3x..."
}`,
    },
    {
      kind: "p",
      text: L(
        "Poll status_url (GET /v1/inspect/batch/:id) for the per-image results. A status of \"partial\" means the call hit its time budget before finishing — resubmit the remainder as a new batch. Images are processed in order and each one counts against your monthly quota.",
        "轮询 status_url（GET /v1/inspect/batch/:id）可获取每张图像的结果。status 为 \"partial\" 表示本次调用在完成前达到了时间上限——将剩余图像作为新批次重新提交即可。图像按顺序处理，每张均计入月度用量。",
      ),
    },
  ],
};

const webhooks: DocSection = {
  id: "webhooks",
  title: L("Webhooks", "Webhook 回调"),
  blocks: [
    {
      kind: "p",
      text: L(
        "ZemaInspect POSTs every result to a URL you configure under Settings → Result webhook, so your MES or ERP never has to poll.",
        "ZemaInspect 会将每条检测结果 POST 到您在「设置 → 结果 Webhook」中配置的地址，贵方 MES / ERP 无需轮询。",
      ),
    },
    {
      kind: "code",
      language: "http",
      code: `POST https://mes.yourfactory.com/hooks/zemainspect
Content-Type: application/json
X-ZemaInspect-Signature: 3f9a1c...
X-ZemaInspect-Timestamp: 1756089600`,
    },
    {
      kind: "code",
      language: "json",
      code: `{
  "inspection_id": "insp_cm3x...",
  "organization_id": "org_cm3x...",
  "result": "fail",
  "defects": [
    { "type": "scratches", "confidence": 0.9134, "bbox": [120, 64, 88, 32] }
  ],
  "product_category": "steel",
  "line_id": "press-line-1",
  "image_url": "https://....public.blob.vercel-storage.com/...",
  "model_variant": "yolov8n-neu-onnx",
  "processing_time_ms": 42,
  "processed_at": "2026-09-01T12:00:00.000Z"
}`,
    },
    {
      kind: "h3",
      text: L("Verifying the signature", "验证签名"),
    },
    {
      kind: "p",
      text: L(
        "Do this before trusting the payload. The signature is HMAC-SHA256(secret, \"{timestamp}.{raw_body}\"), hex-encoded. The timestamp is inside the signed material specifically so a captured request cannot be replayed later.",
        "在信任负载内容之前请务必验证。签名为 HMAC-SHA256(密钥, \"{timestamp}.{原始请求体}\")，十六进制编码。时间戳被纳入签名内容，正是为了防止请求被截获后重放。",
      ),
    },
    {
      kind: "code",
      language: "javascript",
      caption: L("Node.js", "Node.js"),
      code: `import { createHmac, timingSafeEqual } from "crypto";

function verify(rawBody, headers, secret) {
  const signature = headers["x-zemainspect-signature"];
  const timestamp = Number(headers["x-zemainspect-timestamp"]);

  // Reject stale requests (replay protection).
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature ?? "", "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}`,
    },
    {
      kind: "code",
      language: "python",
      caption: L("Python", "Python"),
      code: `import hmac, hashlib, time

def verify(raw_body: bytes, headers, secret: str) -> bool:
    signature = headers.get("X-ZemaInspect-Signature", "")
    try:
        timestamp = int(headers.get("X-ZemaInspect-Timestamp", "0"))
    except ValueError:
        return False

    if abs(time.time() - timestamp) > 300:
        return False

    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)`,
    },
    {
      kind: "note",
      tone: "warn",
      text: L(
        "Use the raw request bytes. Re-serialising the parsed JSON changes whitespace and key order, and the signature will not match.",
        "必须使用原始请求字节。将解析后的 JSON 重新序列化会改变空白字符和键顺序，导致签名校验失败。",
      ),
    },
    {
      kind: "h3",
      text: L("Delivery behaviour", "投递行为"),
    },
    {
      kind: "p",
      text: L(
        "Delivery is fire-and-forget with a 5-second timeout and no retry. A slow or down endpoint must never hold up an inspection response or stall the line. If you need guaranteed delivery, treat the webhook as a fast path and reconcile against GET /api/inspections or the CSV export on a schedule.",
        "投递采用「发送即忘」策略，超时 5 秒且不重试。任何缓慢或宕机的接收端都不应拖慢检测响应或造成停线。如需保证不漏单，请将 Webhook 视为快速通道，并定期通过 GET /api/inspections 或 CSV 导出进行对账。",
      ),
    },
    {
      kind: "p",
      text: L(
        "Use Send test event in Settings to fire a representative payload. It is signed identically, so it exercises your verification code for real before the line starts.",
        "可在「设置」中点击「发送测试事件」触发一条示例负载。其签名方式完全一致，可在开线前真实验证贵方的校验代码。",
      ),
    },
  ],
};

const alerts: DocSection = {
  id: "alerts",
  title: L("Defect-rate alerts", "缺陷率告警"),
  blocks: [
    {
      kind: "p",
      text: L(
        "Set a defect-rate threshold under Settings and the same webhook endpoint also receives a rollup event — the signal a shift supervisor acts on, as opposed to a single part's verdict.",
        "在「设置」中配置缺陷率阈值后，同一 Webhook 地址还会收到汇总事件——这是值班班长需要据以行动的信号，而非单个零件的判定。",
      ),
    },
    {
      kind: "code",
      language: "json",
      code: `{
  "event": "defect_rate_threshold_exceeded",
  "organization_id": "org_cm3x...",
  "window_start": "2026-09-01T11:00:00.000Z",
  "window_end": "2026-09-01T12:00:00.000Z",
  "defect_rate": 0.0731,
  "threshold": 0.05,
  "inspections": 342,
  "defects": 25
}`,
    },
    {
      kind: "p",
      text: L(
        "Checked every 15 minutes over a rolling one-hour window. A window with fewer than 20 inspections is skipped — too small a sample to act on — and at most one alert fires per organization per hour.",
        "系统每 15 分钟基于滚动 1 小时窗口检查一次。检测数少于 20 次的窗口会被跳过（样本量不足以据此行动），且每个组织每小时最多触发一次告警。",
      ),
    },
    {
      kind: "note",
      tone: "info",
      text: L(
        "The threshold is a fraction, not a percentage: 0.05 means 5%.",
        "阈值为小数而非百分数：0.05 表示 5%。",
      ),
    },
  ],
};

const errors: DocSection = {
  id: "errors",
  title: L("Errors", "错误码"),
  blocks: [
    {
      kind: "p",
      text: L("Every error has the same shape.", "所有错误返回相同结构。"),
    },
    {
      kind: "code",
      language: "json",
      code: `{ "error": { "code": "quota_exceeded", "message": "..." } }`,
    },
    {
      kind: "table",
      head: [L("Status", "状态码"), L("Code", "错误码"), L("Meaning", "含义")],
      rows: [
        [
          L("400", "400"),
          L("missing_image / invalid_parameters / invalid_body", "missing_image / invalid_parameters / invalid_body"),
          L("Malformed request", "请求格式错误"),
        ],
        [
          L("401", "401"),
          L("missing_api_key / invalid_api_key", "missing_api_key / invalid_api_key"),
          L("Bad or revoked key", "密钥无效或已被吊销"),
        ],
        [
          L("402", "402"),
          L("trial_expired / subscription_inactive", "trial_expired / subscription_inactive"),
          L("Upgrade needed", "需要升级套餐"),
        ],
        [
          L("413", "413"),
          L("image_too_large / batch_too_large", "image_too_large / batch_too_large"),
          L("Over the size cap", "超出体积上限"),
        ],
        [
          L("422", "422"),
          L("inference_failed", "inference_failed"),
          L("The file was not a readable image", "文件不是可解析的图像"),
        ],
        [
          L("429", "429"),
          L("quota_exceeded", "quota_exceeded"),
          L("Monthly limit reached on a trial", "试用版已达月度上限"),
        ],
        [
          L("503", "503"),
          L("model_unavailable", "model_unavailable"),
          L("No weights deployed for that category", "该品类尚未部署模型权重"),
        ],
      ],
    },
    {
      kind: "note",
      tone: "info",
      text: L(
        "Quota behaviour differs by plan on purpose. Trials stop at the limit; paid plans keep inspecting and bill overage. A factory hates being cut off mid-shift more than it hates a small line item.",
        "不同套餐的用量策略是有意区分的：试用版达到上限即停止，付费套餐会继续检测并按超额计费。对工厂而言，班中被切断服务远比账单上多一行更难接受。",
      ),
    },
  ],
};

const coverage: DocSection = {
  id: "coverage",
  title: L("Model coverage — read this before you pilot", "模型覆盖范围——试点前请务必阅读"),
  blocks: [
    {
      kind: "p",
      text: L(
        "One model ships today: YOLOv8n trained on the NEU Surface Defect Database, six classes of rolled-steel surface defect — crazing, inclusion, patches, pitted_surface, rolled-in_scale, scratches.",
        "目前随产品提供的模型只有一个：基于 NEU 表面缺陷数据库训练的 YOLOv8n，覆盖六类热轧钢材表面缺陷——龟裂（crazing）、夹杂（inclusion）、斑块（patches）、麻点（pitted_surface）、氧化铁皮压入（rolled-in_scale）、划痕（scratches）。",
      ),
    },
    {
      kind: "note",
      tone: "warn",
      text: L(
        "Accuracy is not uniform across those six. patches and scratches validate above 84% mAP@0.5; crazing and rolled-in_scale sit around 50–56%. Treat a low-confidence hit on a weak class as a prompt for human review, not a verdict. These figures come from the NEU held-out test set, not from your line.",
        "六个类别的精度并不一致：斑块与划痕在 mAP@0.5 上可达 84% 以上，而龟裂与氧化铁皮压入约为 50–56%。对弱类别的低置信度命中，应作为提请人工复核的提示，而非最终判定。以上数据来自 NEU 留出测试集，并非贵厂产线的实测结果。",
      ),
    },
    {
      kind: "p",
      text: L(
        "general and automotive are accepted by the API but have no model behind them on a default deployment, and the live inspector marks them unavailable rather than running steel weights on a plastic moulding and reporting steel class names. Bringing up a new category is a data-collection and training project — a few thousand labelled frames from your own line — not a configuration change.",
        "API 接受 general 与 automotive 两个品类，但默认部署下并没有对应模型；实时检测界面会将其标记为不可用，而不会用钢材权重去检测塑料件并输出钢材缺陷类名。新增一个品类是数据采集与模型训练项目（需要贵厂产线上数千张标注图像），而不是改一项配置就能完成的事。",
      ),
    },
    {
      kind: "p",
      text: L(
        "Once those weights exist, they drop in without an application change: point NEXT_PUBLIC_MODEL_URL_<CATEGORY> at the ONNX file and list its classes in NEXT_PUBLIC_MODEL_CLASSES_<CATEGORY>. Loading, labelling, the frame guard and the UI follow automatically.",
        "一旦权重就绪，无需修改应用代码即可接入：将 NEXT_PUBLIC_MODEL_URL_<品类> 指向 ONNX 文件，并在 NEXT_PUBLIC_MODEL_CLASSES_<品类> 中列出其类别名。模型加载、标签显示、画面校验与界面都会自动跟随。",
      ),
    },
  ],
};

const surfaces: DocSection = {
  id: "other-surfaces",
  title: L("Other integration surfaces", "其他集成方式"),
  blocks: [
    {
      kind: "list",
      items: [
        L(
          "CSV — GET /api/inspections?format=csv (session-authenticated), or the Export button on the feed and trends pages. The path every plant falls back on.",
          "CSV —— GET /api/inspections?format=csv（会话认证），或在实时列表与趋势页点击「导出」。这是每家工厂最终都会用到的兜底方式。",
        ),
        L(
          "Compliance PDF — GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&lang=en (session-authenticated, Pro and above). lang=zh renders the report in Chinese.",
          "合规 PDF 报告 —— GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&lang=en（会话认证，Pro 及以上套餐）。设为 lang=zh 可生成中文报告。",
        ),
        L(
          "In-browser edge inspection — the operator's camera runs the model locally, so a line keeps inspecting through a network outage. Nothing leaves the machine unless the operator saves a frame.",
          "浏览器端边缘检测 —— 模型在操作员本机摄像头端运行，网络中断时产线仍可继续检测。除非操作员主动保存画面，否则数据不出本机。",
        ),
      ],
    },
    {
      kind: "note",
      tone: "info",
      text: L(
        "Deploying inside the plant network, behind your own firewall, is available on Enterprise. Ask us — it is a configuration we support, not a special build.",
        "企业版支持在厂区内网、贵方防火墙之内进行私有化部署。欢迎与我们联系——这是我们已支持的部署配置，而非定制开发。",
      ),
    },
  ],
};

export const DOC_SECTIONS: readonly DocSection[] = [
  quickstart,
  auth,
  inspect,
  batch,
  webhooks,
  alerts,
  errors,
  coverage,
  surfaces,
];

export const DOCS_INTRO: Localised = L(
  "The REST API, webhooks and export paths ZemaInspect exposes, and exactly what the model behind them can and cannot do.",
  "ZemaInspect 对外开放的 REST 接口、Webhook 回调与数据导出方式，以及背后模型的能力边界说明。",
);
