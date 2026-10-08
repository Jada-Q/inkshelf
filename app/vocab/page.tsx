"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useI18n, LangSwitch } from "@/lib/i18n";

type V = {
  id: string;
  book_id: string | null;
  term: string;
  translation: string | null;
  context: string | null;
  created_at: string;
  inkshelf_books: { title: string } | null;
};

export default function VocabPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<V[]>([]);
  const [sideOpen, setSideOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("inkshelf_vocab")
      .select("id,book_id,term,translation,context,created_at,inkshelf_books(title)")
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
      md += `- **${v.term}**${v.translation ? ` — ${v.translation}` : ""}`;
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
        <button className="mobile-menu" onClick={() => setSideOpen(true)}>{t("menu")}</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 className="page-title">{t("nav_vocab")}</h1>
          {rows.length > 0 && <button className="btn" onClick={exportMd}>{t("export_md")}</button>}
        </div>

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
                  {v.translation && <span className="vocab-tr">{v.translation}</span>}
                  <button className="note-del" onClick={() => del(v.id)}>{t("del")}</button>
                </div>
                {v.context && <div className="vocab-ctx">{v.context}</div>}
                {v.inkshelf_books?.title && (
                  <Link href={`/read/${v.book_id}`} className="vocab-src">
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
