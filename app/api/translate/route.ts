import { generateText } from "ai";

export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const MODEL = process.env.INKSHELF_AI_MODEL?.trim() || "anthropic/claude-opus-5";

const LANG: Record<string, string> = {
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  en: "English",
  fr: "French",
  es: "Spanish",
};

async function isAuthed(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: auth },
  });
  return r.ok;
}

export async function POST(req: Request) {
  if (!(await isAuthed(req))) return new Response("unauthorized", { status: 401 });
  const { term, context, target } = (await req.json()) as {
    term?: string;
    context?: string;
    target?: string;
  };
  if (!term?.trim()) return Response.json({ translation: "" });
  const lang = LANG[target ?? "zh"] ?? "Chinese";

  try {
    const { text } = await generateText({
      model: MODEL,
      system:
        `Translate the given word or phrase into ${lang} for a vocabulary notebook. ` +
        "Output only the translation — if it's a single word, give the ONE most fitting meaning in this context plus part of speech if useful; if a phrase, give a natural rendering. No explanations, no quotes, keep it under 20 words.",
      prompt: context?.trim()
        ? `Word/phrase: ${term}\nSentence it appeared in: ${context}`
        : `Word/phrase: ${term}`,
      providerOptions: { gateway: { tags: ["app:inkshelf", "feature:vocab"] } },
    });
    return Response.json({ translation: text.trim() });
  } catch {
    return Response.json({ translation: "" });
  }
}
