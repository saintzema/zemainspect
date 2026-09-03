"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { useTranslation } from "@/lib/i18n/language-context";
import { Badge, GlassButton, GlassPanel } from "@/components/ui/glass";
import {
  DOCS_INTRO,
  DOC_SECTIONS,
  pick,
  type Block,
  type DocSection,
} from "@/lib/docs/reference";
import { cn } from "@/lib/utils";

/**
 * The integration reference.
 *
 * The header has linked to /docs since the first deploy and it returned 404 —
 * a buyer clicking "Docs" mid-demo hit a dead page, on the exact claim the
 * pitch rests on ("connects to your existing systems"). Content comes from
 * lib/docs/reference.ts so it stays bilingual by construction.
 */

function CodeBlock({ block }: { block: Extract<Block, { kind: "code" }> }) {
  const { language, t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure origin, locked-down factory browser).
      // The code is selectable on the page, so this is not worth an error.
    }
  }

  return (
    <figure className="my-4">
      {block.caption && (
        <figcaption className="mb-1.5 text-xs text-ink-muted">
          {pick(block.caption, language)}
        </figcaption>
      )}
      <div className="group relative">
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t("common.copied") : t("common.copy")}
          className={cn(
            "absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-lg",
            "border border-white/20 bg-black/40 px-2 py-1 text-xs text-white/80",
            "opacity-0 transition hover:bg-black/60 hover:text-white",
            "focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
        <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-4 text-xs leading-relaxed text-slate-100">
          <code>{block.code}</code>
        </pre>
      </div>
    </figure>
  );
}

function BlockView({ block }: { block: Block }) {
  const { language } = useTranslation();

  switch (block.kind) {
    case "p":
      return (
        <p className="my-3 text-sm leading-relaxed text-ink-muted">
          {pick(block.text, language)}
        </p>
      );

    case "h3":
      return (
        <h3 className="mb-2 mt-6 text-sm font-semibold tracking-tight text-ink">
          {pick(block.text, language)}
        </h3>
      );

    case "list":
      return (
        <ul className="my-3 space-y-2">
          {block.items.map((item, i) => (
            <li
              key={i}
              className="flex gap-2 text-sm leading-relaxed text-ink-muted"
            >
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
              <span>{pick(item, language)}</span>
            </li>
          ))}
        </ul>
      );

    case "note":
      return (
        <div
          className={cn(
            "my-4 rounded-2xl border px-4 py-3 text-sm leading-relaxed",
            block.tone === "warn"
              ? "border-warn/30 bg-warn/10 text-ink"
              : "border-accent/25 bg-accent/10 text-ink",
          )}
        >
          {pick(block.text, language)}
        </div>
      );

    case "code":
      return <CodeBlock block={block} />;

    case "table":
      return (
        // Wide tables scroll inside their own box rather than the page.
        <div className="my-4 overflow-x-auto rounded-2xl border border-white/25 dark:border-white/10">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/25 bg-white/30 dark:border-white/10 dark:bg-white/5">
                {block.head.map((cell, i) => (
                  <th key={i} className="px-3 py-2 font-medium text-ink">
                    {pick(cell, language)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr
                  key={r}
                  className="border-b border-white/15 last:border-0 dark:border-white/5"
                >
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={cn(
                        "px-3 py-2 align-top text-ink-muted",
                        c === 0 && "font-mono text-xs text-ink",
                      )}
                    >
                      {pick(cell, language)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function SectionView({ section }: { section: DocSection }) {
  const { language } = useTranslation();

  return (
    <section id={section.id} className="scroll-mt-24">
      <h2 className="mb-1 text-xl font-semibold tracking-tight text-ink">
        {pick(section.title, language)}
      </h2>
      {section.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </section>
  );
}

export default function DocsPage() {
  const { language, t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <header className="max-w-3xl">
        <Badge tone="accent">{t("nav.docs")}</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t("docs.title")}
        </h1>
        <p className="mt-3 text-ink-muted">{pick(DOCS_INTRO, language)}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/api-keys">
            <GlassButton size="sm">{t("docs.getKey")}</GlassButton>
          </Link>
          <Link href="/pricing">
            <GlassButton variant="secondary" size="sm">
              {t("nav.pricing")}
            </GlassButton>
          </Link>
        </div>
      </header>

      <div className="mt-10 gap-10 lg:flex lg:items-start">
        {/* Table of contents — sticky on desktop, a plain list on a tablet. */}
        <nav
          aria-label={t("docs.onThisPage")}
          className="mb-8 lg:sticky lg:top-24 lg:mb-0 lg:w-56 lg:shrink-0"
        >
          <GlassPanel className="p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {t("docs.onThisPage")}
            </p>
            <ul className="space-y-1">
              {DOC_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded-lg px-2 py-1 text-sm text-ink-muted transition hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
                  >
                    {pick(section.title, language)}
                  </a>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </nav>

        <div className="min-w-0 flex-1 space-y-12">
          {DOC_SECTIONS.map((section) => (
            <SectionView key={section.id} section={section} />
          ))}

          <GlassPanel className="p-5">
            <h2 className="text-base font-semibold tracking-tight text-ink">
              {t("docs.helpTitle")}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{t("docs.helpBody")}</p>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
