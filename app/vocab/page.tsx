"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useI18n, LangSwitch } from "@/lib/i18n";
import { ThemeToggle } from "@/lib/theme";

type V = {
  id: string;
  book_id: string | null;
  term: string;
  translation: string | null;
  reading: string | null;
  context: string | null;
  created_at: string;
  inkshelf_books: { title: string } | null;
};

/* 读音播放：浏览器内置 TTS，无需联网/额度 */
function speakWord(term: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(term);
  // 粗略判断语种：有 CJK 就按中文读，否则英文
  u.lang = /[一-鿿]/.test(term)
    ? "zh-CN"
    : /[぀-ヿ]/.test(term)
      ? "ja-JP"
      : /[가-힣]/.test(term)
        ? "ko-KR"
        : "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export default function VocabPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<V[]>([]);
  const [sideOpen, setSideOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("inkshelf_vocab")
      .select("id,book_id,term,translation,reading,context,created_at,inkshelf_books(title)")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as V[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      load();
    });
  }, [router, load]);

  async function del(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
    await supabase.from("inkshelf_vocab").delete().eq("id", id);
  }

  function exportMd() {
    let md = `# ${t("nav_vocab")}\n\n`;
    for (const v of rows) {
      md += `- **${v.term}**${v.reading ? ` ${v.reading}` : ""}${v.translation ? ` — ${v.translation}` : ""}`;
      if (v.context) md += `\n  <br>${v.context}`;
      md += `\n`;
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inkshelf-vocab.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="ws">
      <div className={`side-scrim ${sideOpen ? "show" : ""}`} onClick={() => setSideOpen(false)} />
      <aside className={`side ${sideOpen ? "open" : ""}`}>
        <div className="side-brand">
          <span className="glyph">墨</span>
          <span className="name">{t("brand")}</span>
        </div>
        <Link href="/" className="side-item">{t("nav_shelf")}</Link>
        <Link href="/notes" className="side-item">{t("nav_notes")}</Link>
        <button className="side-item on">{t("nav_vocab")}</button>
        <Link href="/stats" className="side-item">{t("nav_stats")}</Link>
        <div className="side-foot">
          <LangSwitch />
          <ThemeToggle />
          <button
            className="side-item"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          >
            {t("signout")}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="m-topbar">
          <div className="brand">
            <span className="glyph">墨</span>
            <span className="wm">{t("brand")}</span>
          </div>
          <button className="menu-btn" onClick={() => setSideOpen(true)} aria-label={t("menu")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 className="page-title">{t("nav_vocab")}</h1>
          {rows.length > 0 && <button className="btn" onClick={exportMd}>{t("export_md")}</button>}
        </div>
        <p className="page-sub">{t("vocab_sub")}</p>

        {!loaded ? (
          <div style={{ color: "var(--ink-3)", padding: "20px 0" }}>{t("computing")}</div>
        ) : rows.length === 0 ? (
          <div className="dropzone">
            <div className="big">{t("vocab_empty")}</div>
          </div>
        ) : (
          <div className="vocab-list">
            {rows.map((v) => (
              <div key={v.id} className="vocab-card">
                <div className="vocab-head">
                  <span className="vocab-term">{v.term}</span>
                  {v.reading && <span className="vocab-reading">{v.reading}</span>}
                  <button
                    className="vocab-speak"
                    onClick={() => speakWord(v.term)}
                    aria-label={t("read_aloud")}
                    title={t("read_aloud")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.8a4.5 4.5 0 0 1 0 6.4" /></svg>
                  </button>
                  <button className="note-del" onClick={() => del(v.id)}>{t("del")}</button>
                </div>
                {v.translation && <div className="vocab-tr">{v.translation}</div>}
                {v.context && <div className="vocab-ctx">{v.context}</div>}
                {v.inkshelf_books?.title && (
                  <Link href={`/read?id=${v.book_id}`} className="vocab-src">
                    {t("in_book")} 《{v.inkshelf_books.title}》
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
