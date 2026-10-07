import { streamText, gateway } from "ai";

export const maxDuration = 60;

const SUPABASE_URL = "https://dhzozfjzhsniyewblwpv.supabase.co";
const SUPABASE_KEY = "sb_publishable_f_pIVqMK-6ToF3-eYe5n5A_-yb_vpZR";

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
    messages?: ChatMsg[];
  };
  const messages = (body.messages ?? []).slice(-16); // 控制上下文长度
  if (!messages.length) return new Response("empty", { status: 400 });

  const system = [
    "你是「墨架」私人图书馆的阅读伴读。读者正在读一本书，会把选段或问题发给你。",
    body.bookTitle ? `当前书目：《${body.bookTitle}》${body.author ? `，作者 ${body.author}` : ""}。` : "",
    "规则：默认用中文回答（读者明确要求其他语言除外）；紧扣选段和这本书的语境；",
    "解释要讲到点子上——给高层理解和关键脉络，不逐句复述原文；",
    "翻译时先给译文，再用一两句点出不易直译的关键词；",
    "回答保持精炼，优先回应问题本身，不加免责声明和客套。",
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
