import { NextResponse } from "next/server";
import { languageName } from "../../../lib/languages";

const PROVIDER = process.env.TRANSLATE_PROVIDER || "stub";
const LIBRE_URL = process.env.LIBRETRANSLATE_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function translateWithLibre({ text, sourceLang, targetLang }) {
  if (!LIBRE_URL) {
    throw new Error("LIBRETRANSLATE_URL is not set");
  }

  const response = await fetch(`${LIBRE_URL.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: sourceLang || "auto",
      target: targetLang,
      format: "text"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LibreTranslate error: ${response.status} ${body}`);
  }

  const data = await response.json();
  return data.translatedText;
}

async function translateWithGemini({ text, sourceLang, targetLang }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const sourceName = sourceLang ? languageName(sourceLang) : "auto-detect";
  const targetName = languageName(targetLang);
  const instruction = `Translate from ${sourceName} to ${targetName}. Output only the translation.`;
  const isGemma = GEMINI_MODEL.toLowerCase().startsWith("gemma");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(
        isGemma
          ? {
              contents: [
                {
                  parts: [{ text: `${instruction}\n\nText:\n${text}` }]
                }
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 200,
                topP: 0.9,
                topK: 40
              }
            }
          : {
              system_instruction: {
                parts: [{ text: instruction }]
              },
              contents: [
                {
                  parts: [{ text }]
                }
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 200,
                topP: 0.9,
                topK: 40
              }
            }
      )
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini error: ${response.status} ${body}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const output = candidate?.content?.parts?.map((part) => part.text).join("")?.trim();

  if (!output) {
    throw new Error("Gemini returned no translation");
  }

  return output;
}

export async function POST(request) {
  try {
    const { text, sourceLang, targetLang } = await request.json();

    if (!text || !targetLang) {
      return NextResponse.json({ translation: "", provider: PROVIDER });
    }

    if (PROVIDER === "libre") {
      const translation = await translateWithLibre({ text, sourceLang, targetLang });
      return NextResponse.json({ translation, provider: PROVIDER });
    }

    if (PROVIDER === "gemini") {
      const translation = await translateWithGemini({ text, sourceLang, targetLang });
      return NextResponse.json({ translation, provider: PROVIDER });
    }

    const translation = `[${targetLang}] ${text}`;
    return NextResponse.json({ translation, provider: "stub" });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Translation failed" },
      { status: 500 }
    );
  }
}
