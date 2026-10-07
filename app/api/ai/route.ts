import { streamText, gateway } from "ai";

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Vercel AI Gateway slug（点号版本）；可用 env 覆盖。部署后用 GET /api/ai 实查可用清单后锁定。
const MODEL = process.env.INKSHELF_AI_MODEL?.trim() || "anthropic/claude-opus-5";

/** 只允许本库登录用户调用——开放的 LLM 端点等于把 Gateway 额度交给全网 */
async function isAuthed(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: auth },
  });
  return r.ok;
}

type ChatMsg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  if (!(await isAuthed(req))) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = (await req.json()) as {
    bookTitle?: string;
    author?: string;
    locale?: string;
    messages?: ChatMsg[];
  };
  const messages = (body.messages ?? []).slice(-16); // 控制上下文长度
  if (!messages.length) return new Response("empty", { status: 400 });

  const LANG: Record<string, string> = {
    zh: "Chinese (中文)",
    ja: "Japanese (日本語)",
    ko: "Korean (한국어)",
    en: "English",
    fr: "French (français)",
    es: "Spanish (español)",
  };
  const answerLang = LANG[body.locale ?? "zh"] ?? "the user's UI language";

  const system = [
    "You are the reading companion inside the personal library app Inkshelf. The reader is reading a book and sends you a passage or a question.",
    body.bookTitle ? `Current book: "${body.bookTitle}"${body.author ? ` by ${body.author}` : ""}.` : "",
    `Answer in ${answerLang} unless the reader explicitly asks for another language.`,
    "Stay anchored to the passage and this book's context; for explanations give the high-level understanding and key threads rather than restating the text line by line.",
    "When translating, give the translation first, then a sentence or two on the terms that don't translate cleanly.",
    "Keep answers concise and address the question directly — no disclaimers or filler.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = streamText({
    model: MODEL,
    system,
    messages,
    providerOptions: {
      gateway: { tags: ["app:inkshelf"] },
    },
  });

  return result.toTextStreamResponse();
}

/** 临时端点：实查 Gateway 上可用的 anthropic 模型 slug（锁定 MODEL 后可删） */
export async function GET() {
  try {
    const res = (await gateway.getAvailableModels()) as unknown as {
      models?: { id: string }[];
    };
    const ids = (res.models ?? [])
      .map((m) => m.id)
      .filter((id) => id.startsWith("anthropic/"));
    return Response.json({ current: MODEL, available: ids });
  } catch (err) {
    return Response.json(
      { current: MODEL, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
