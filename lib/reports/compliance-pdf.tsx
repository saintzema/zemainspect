import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import { DEFECT_LABELS, type NeuClass } from "@/lib/inference/labels";
import type { DefectCount, SummaryStats } from "@/lib/analytics";

/**
 * Compliance report.
 *
 * Note on language: @react-pdf's built-in faces are Latin-only, so a Chinese
 * report needs a CJK font registered. Set PDF_CJK_FONT_URL to a .ttf and the
 * report renders in Chinese; otherwise it falls back to English labels rather
 * than emitting boxes an auditor cannot read.
 */

let cjkRegistered: boolean | null = null;

async function ensureCjkFont(): Promise<boolean> {
  if (cjkRegistered !== null) return cjkRegistered;
  const url = process.env.PDF_CJK_FONT_URL;
  if (!url) {
    cjkRegistered = false;
    return false;
  }
  try {
    Font.register({ family: "CJK", src: url });
    cjkRegistered = true;
  } catch (err) {
    console.error("Could not register CJK font for PDF:", err);
    cjkRegistered = false;
  }
  return cjkRegistered;
}

export interface ComplianceReportData {
  organizationName: string;
  from: Date;
  to: Date;
  stats: SummaryStats;
  byType: DefectCount[];
  capability: number | null;
  language: "en" | "zh";
  /** True when Chinese was requested but no CJK font is available. */
  languageDowngraded: boolean;
}

const COPY = {
  en: {
    title: "Inspection & Defect Report",
    subtitle: "Prepared for ISO 9001 / IATF 16949 evidence",
    org: "Organization",
    period: "Reporting period",
    generated: "Generated",
    summary: "Summary",
    totalInspections: "Total inspections",
    totalDefects: "Frames with defects",
    defectRate: "Defect rate",
    capability: "Process capability (Cpk-style estimate)",
    capabilityNote:
      "Derived from the observed fraction defective under a one-sided normal assumption. This is an attribute-based proxy and is not a substitute for a dimensional process capability study.",
    byType: "Defects by class",
    class: "Class",
    count: "Count",
    share: "Share",
    method: "Method",
    methodBody:
      "Images were inspected by a YOLOv8 object detection model trained on the NEU Surface Defect Database. A frame is recorded as failing when one or more defects are detected above the configured confidence threshold.",
    reliability: "Model reliability by class",
    reliabilityBody:
      "Validation mAP@0.5 varies materially by class. Crazing (50.6%) and rolled-in scale (55.6%) are the weakest classes; patches (91.8%) and scratches (84.4%) the strongest. Low-confidence detections on weak classes should be treated as a prompt for human review.",
    noDefects: "No defects were detected in this period.",
    downgraded:
      "Requested in Chinese; rendered in English because no CJK font is configured on this deployment.",
    footer: "ZemaInspect · Zema AI Labs",
  },
  zh: {
    title: "检测与缺陷报告",
    subtitle: "用于 ISO 9001 / IATF 16949 审核证据",
    org: "组织",
    period: "报告周期",
    generated: "生成时间",
    summary: "摘要",
    totalInspections: "检测总数",
    totalDefects: "存在缺陷的画面数",
    defectRate: "缺陷率",
    capability: "过程能力（Cpk 估算）",
    capabilityNote:
      "依据实测不良率在单侧正态假设下推算。此为计数型代理指标，不能替代正式的尺寸过程能力分析。",
    byType: "按缺陷类别统计",
    class: "类别",
    count: "数量",
    share: "占比",
    method: "方法",
    methodBody:
      "图像由基于 NEU 表面缺陷数据库训练的 YOLOv8 目标检测模型进行检测。当画面中检出一个或多个高于设定置信度阈值的缺陷时，该画面记为不合格。",
    reliability: "各类别模型可靠度",
    reliabilityBody:
      "各类别的验证 mAP@0.5 差异显著。龟裂（50.6%）与压入氧化皮（55.6%）为最弱类别，斑块（91.8%）与划痕（84.4%）为最强类别。对弱类别的低置信度检出，应作为人工复检提示处理。",
    noDefects: "本周期内未检出缺陷。",
    downgraded: "",
    footer: "ZemaInspect · Zema AI Labs",
  },
} as const;

function styles(fontFamily: string) {
  return StyleSheet.create({
    page: { padding: 44, fontSize: 10, fontFamily, color: "#111827" },
    h1: { fontSize: 19, marginBottom: 3 },
    sub: { fontSize: 10, color: "#6b7280", marginBottom: 18 },
    h2: { fontSize: 12, marginTop: 18, marginBottom: 7 },
    metaRow: { flexDirection: "row", marginBottom: 3 },
    metaKey: { width: 130, color: "#6b7280" },
    metaValue: { flex: 1 },
    statGrid: { flexDirection: "row", gap: 10, marginTop: 4 },
    stat: {
      flex: 1,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderRadius: 6,
      padding: 10,
    },
    statLabel: { fontSize: 8, color: "#6b7280", marginBottom: 3 },
    statValue: { fontSize: 15 },
    tableHead: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderColor: "#111827",
      paddingBottom: 4,
      marginBottom: 3,
    },
    row: {
      flexDirection: "row",
      paddingVertical: 3,
      borderBottomWidth: 1,
      borderColor: "#f3f4f6",
    },
    cellName: { flex: 2 },
    cellNum: { flex: 1, textAlign: "right" },
    note: { fontSize: 8, color: "#6b7280", marginTop: 5, lineHeight: 1.5 },
    body: { lineHeight: 1.5, color: "#374151" },
    warn: {
      fontSize: 8,
      color: "#92400e",
      backgroundColor: "#fef3c7",
      padding: 6,
      borderRadius: 4,
      marginBottom: 12,
    },
    footer: {
      position: "absolute",
      bottom: 24,
      left: 44,
      right: 44,
      fontSize: 8,
      color: "#9ca3af",
      textAlign: "center",
    },
  });
}

function ComplianceReport(data: ComplianceReportData) {
  const copy = COPY[data.language];
  const s = styles(data.language === "zh" ? "CJK" : "Helvetica");
  const totalDefects = data.byType.reduce((sum, d) => sum + d.count, 0);
  const dateFmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <Document title={`${copy.title} — ${data.organizationName}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{copy.title}</Text>
        <Text style={s.sub}>{copy.subtitle}</Text>

        {data.languageDowngraded && <Text style={s.warn}>{COPY.en.downgraded}</Text>}

        <View style={s.metaRow}>
          <Text style={s.metaKey}>{copy.org}</Text>
          <Text style={s.metaValue}>{data.organizationName}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaKey}>{copy.period}</Text>
          <Text style={s.metaValue}>
            {dateFmt(data.from)} — {dateFmt(data.to)}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaKey}>{copy.generated}</Text>
          <Text style={s.metaValue}>{new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</Text>
        </View>

        <Text style={s.h2}>{copy.summary}</Text>
        <View style={s.statGrid}>
          <View style={s.stat}>
            <Text style={s.statLabel}>{copy.totalInspections}</Text>
            <Text style={s.statValue}>{data.stats.total.toLocaleString()}</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statLabel}>{copy.totalDefects}</Text>
            <Text style={s.statValue}>{data.stats.failed.toLocaleString()}</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statLabel}>{copy.defectRate}</Text>
            <Text style={s.statValue}>{(data.stats.defectRate * 100).toFixed(2)}%</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statLabel}>{copy.capability}</Text>
            <Text style={s.statValue}>
              {data.capability === null ? "—" : data.capability.toFixed(2)}
            </Text>
          </View>
        </View>
        <Text style={s.note}>{copy.capabilityNote}</Text>

        <Text style={s.h2}>{copy.byType}</Text>
        {data.byType.length === 0 ? (
          <Text style={s.body}>{copy.noDefects}</Text>
        ) : (
          <View>
            <View style={s.tableHead}>
              <Text style={s.cellName}>{copy.class}</Text>
              <Text style={s.cellNum}>{copy.count}</Text>
              <Text style={s.cellNum}>{copy.share}</Text>
            </View>
            {data.byType.map((row) => {
              const label =
                DEFECT_LABELS[row.type as NeuClass]?.[data.language] ?? row.type;
              return (
                <View key={row.type} style={s.row}>
                  <Text style={s.cellName}>{label}</Text>
                  <Text style={s.cellNum}>{row.count.toLocaleString()}</Text>
                  <Text style={s.cellNum}>
                    {totalDefects ? `${((row.count / totalDefects) * 100).toFixed(1)}%` : "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <Text style={s.h2}>{copy.method}</Text>
        <Text style={s.body}>{copy.methodBody}</Text>

        <Text style={s.h2}>{copy.reliability}</Text>
        <Text style={s.body}>{copy.reliabilityBody}</Text>

        <Text style={s.footer} fixed>
          {copy.footer}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderComplianceReport(
  data: Omit<ComplianceReportData, "languageDowngraded">,
): Promise<Buffer> {
  let language = data.language;
  let languageDowngraded = false;

  if (language === "zh" && !(await ensureCjkFont())) {
    language = "en";
    languageDowngraded = true;
  }

  return renderToBuffer(
    <ComplianceReport {...data} language={language} languageDowngraded={languageDowngraded} />,
  );
}
