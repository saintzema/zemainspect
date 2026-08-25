import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Translate dynamic content that has no entry in the static dictionaries —
 * customer-entered line names, defect notes, and anything the inference layer
 * returns in English only.
 *
 * Every result is cached by hash of (text + target language), so the same
 * string is never paid for twice. DeepL is preferred for Chinese quality;
 * Google Translate is the fallback.
 */

const schema = z.object({
  texts: z.array(z.string().max(4000)).min(1).max(50),
  targetLang: z.enum(["en", "zh"]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { texts: string[], targetLang: 'en' | 'zh' }" },
      { status: 400 },
    );
  }
  const { texts, targetLang } = parsed.data;

  const hashes = texts.map((text) => hashFor(text, targetLang));
  const cached = await prisma.translationCache.findMany({
    where: { sourceHash: { in: hashes } },
    select: { sourceHash: true, translatedText: true },
  });
  const byHash = new Map(cached.map((row) => [row.sourceHash, row.translatedText]));

  const missingIndexes = texts
    .map((_, index) => index)
    .filter((index) => !byHash.has(hashes[index]));

  if (missingIndexes.length > 0) {
    const missingTexts = missingIndexes.map((index) => texts[index]);
    let translated: string[] | null = null;

    try {
      translated = await translateBatch(missingTexts, targetLang);
    } catch (err) {
      console.error("Translation provider failed:", err);
    }

    if (translated) {
      await prisma.translationCache.createMany({
        data: missingIndexes.map((index, i) => ({
          sourceHash: hashes[index],
          sourceText: texts[index],
          targetLang,
          translatedText: translated![i],
        })),
        skipDuplicates: true,
      });
      missingIndexes.forEach((index, i) => byHash.set(hashes[index], translated![i]));
    }
  }

  // Anything still missing echoes the source rather than rendering blank.
  return NextResponse.json({
    translations: texts.map((text, index) => byHash.get(hashes[index]) ?? text),
  });
}

function hashFor(text: string, targetLang: string) {
  return createHash("sha256").update(`${targetLang}:${text}`, "utf8").digest("hex");
}

async function translateBatch(
  texts: string[],
  targetLang: "en" | "zh",
): Promise<string[] | null> {
  if (process.env.DEEPL_API_KEY) return translateWithDeepL(texts, targetLang);
  if (process.env.GOOGLE_TRANSLATE_API_KEY) return translateWithGoogle(texts, targetLang);
  return null;
}

async function translateWithDeepL(texts: string[], targetLang: "en" | "zh") {
  const key = process.env.DEEPL_API_KEY!;
  // Free-tier keys carry a :fx suffix and use a different host.
  const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";

  const res = await fetch(`https://${host}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: texts,
      target_lang: targetLang === "zh" ? "ZH" : "EN-GB",
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`DeepL responded ${res.status}`);
  const data = (await res.json()) as { translations: Array<{ text: string }> };
  return data.translations.map((t) => t.text);
}

async function translateWithGoogle(texts: string[], targetLang: "en" | "zh") {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY!;
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: texts,
        target: targetLang === "zh" ? "zh-CN" : "en",
        format: "text",
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) throw new Error(`Google Translate responded ${res.status}`);
  const data = (await res.json()) as {
    data: { translations: Array<{ translatedText: string }> };
  };
  return data.data.translations.map((t) => t.translatedText);
}
