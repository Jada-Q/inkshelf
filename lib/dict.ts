/** 离线英中词典（ECDICT 精简版）——点词即时查，脱离 LLM / API。
 *  首次查词时懒加载 /dict/ecdict-common.json（~3.2MB，之后浏览器缓存）。 */

type Raw = { e: Record<string, [string, string]>; f: Record<string, string> };
export type DictEntry = { word: string; phonetic: string; tr: string };

let DICT: Raw | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (DICT) return;
  if (!loading) {
    loading = fetch("/dict/ecdict-common.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Raw | null) => {
        if (j && j.e) DICT = j;
      })
      .catch(() => {
        /* 加载失败则查词返回 null，不影响阅读 */
      });
  }
  await loading;
}

/** 规范化：取英文词干字符，小写。非英文词直接返回 null。 */
function normalize(raw: string): string | null {
  const w = raw.trim().toLowerCase().replace(/[^a-z'-]/g, "");
  if (!w || !/[a-z]/.test(w)) return null;
  return w;
}

export async function lookupWord(raw: string): Promise<DictEntry | null> {
  const w = normalize(raw);
  if (!w) return null;
  await ensureLoaded();
  if (!DICT) return null;
  let hit = DICT.e[w];
  if (!hit) {
    const lemma = DICT.f[w];
    if (lemma) hit = DICT.e[lemma];
  }
  if (!hit) return null;
  return { word: w, phonetic: hit[0], tr: hit[1] };
}
