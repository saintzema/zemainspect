import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import zh from "@/lib/i18n/zh.json";
import { DOCS_INTRO, DOC_SECTIONS, pick, type Block } from "@/lib/docs/reference";

/** Every localised string reachable from the docs content tree. */
function localisedStrings(): { path: string; en: string; zh: string }[] {
  const out: { path: string; en: string; zh: string }[] = [];
  out.push({ path: "intro", ...DOCS_INTRO });

  for (const section of DOC_SECTIONS) {
    out.push({ path: `${section.id}.title`, ...section.title });
    section.blocks.forEach((block: Block, i) => {
      const at = `${section.id}.block[${i}]`;
      switch (block.kind) {
        case "p":
        case "h3":
        case "note":
          out.push({ path: at, ...block.text });
          break;
        case "list":
          block.items.forEach((item, j) => out.push({ path: `${at}.item[${j}]`, ...item }));
          break;
        case "code":
          if (block.caption) out.push({ path: `${at}.caption`, ...block.caption });
          break;
        case "table":
          block.head.forEach((c, j) => out.push({ path: `${at}.head[${j}]`, ...c }));
          block.rows.forEach((row, r) =>
            row.forEach((c, j) => out.push({ path: `${at}.row[${r}][${j}]`, ...c })),
          );
          break;
      }
    });
  }
  return out;
}

describe("docs reference content", () => {
  it("has no untranslated string", () => {
    // A half-Chinese docs page in front of a Chinese buyer is the exact
    // failure this structure exists to prevent, so it fails the build.
    const missing = localisedStrings().filter((s) => !s.en.trim() || !s.zh.trim());
    expect(missing.map((m) => m.path)).toEqual([]);
  });

  it("does not pass English off as Chinese in prose", () => {
    /*
     * Identical en/zh is legitimate for a bare identifier ("line_id", "400")
     * or a list of them ("missing_image / invalid_body") but never for a
     * sentence. So count only plain alphabetic words — tokens with an
     * underscore, digit or slash are code, not prose — and require a zh field
     * with actual Chinese in it once there are enough of them to be a sentence.
     */
    const hasCjk = (s: string) => /[一-鿿]/.test(s);
    const proseWords = (s: string) =>
      s.trim().split(/\s+/).filter((w) => /^[A-Za-z]+[.,;:]?$/.test(w)).length;
    const suspect = localisedStrings().filter(
      (s) => proseWords(s.en) > 4 && !hasCjk(s.zh),
    );
    expect(suspect.map((m) => `${m.path}: ${m.zh.slice(0, 40)}`)).toEqual([]);
  });

  it("gives every section a unique anchor for the table of contents", () => {
    const ids = DOC_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("keeps every table rectangular", () => {
    for (const section of DOC_SECTIONS) {
      for (const block of section.blocks) {
        if (block.kind !== "table") continue;
        for (const row of block.rows) {
          expect(row.length, `${section.id} row width`).toBe(block.head.length);
        }
      }
    }
  });

  it("documents the endpoints the app actually serves", () => {
    // Cheap guard against the docs drifting from the routes they describe.
    const all = DOC_SECTIONS.flatMap((s) =>
      s.blocks.map((b) => ("code" in b ? b.code : "") + JSON.stringify(b)),
    ).join("\n");
    expect(all).toContain("/api/v1/inspect");
    expect(all).toContain("X-ZemaInspect-Signature");
    expect(all).toContain("X-ZemaInspect-Timestamp");
    expect(all).toContain("format=csv");
  });

  it("picks the language the reader chose", () => {
    expect(pick({ en: "Quick start", zh: "快速开始" }, "en")).toBe("Quick start");
    expect(pick({ en: "Quick start", zh: "快速开始" }, "zh")).toBe("快速开始");
  });
});

describe("i18n dictionaries", () => {
  const paths = (obj: unknown, prefix = ""): string[] =>
    typeof obj === "object" && obj !== null
      ? Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
          typeof v === "object" && v !== null
            ? paths(v, `${prefix}${k}.`)
            : [`${prefix}${k}`],
        )
      : [];

  it("define exactly the same keys", () => {
    // The docs page reads t("docs.*"); a key present in one dictionary only
    // renders the raw key string to the operator.
    const a = paths(en).sort();
    const b = paths(zh).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]);
    expect(b.filter((k) => !a.includes(k))).toEqual([]);
  });

  it("carries the docs page strings in both languages", () => {
    for (const key of ["title", "getKey", "onThisPage", "helpTitle", "helpBody"] as const) {
      expect(en.docs[key]).toBeTruthy();
      expect(zh.docs[key]).toBeTruthy();
      expect(zh.docs[key]).not.toBe(en.docs[key]);
    }
  });
});
