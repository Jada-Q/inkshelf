"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useI18n, LangSwitch } from "@/lib/i18n";

type HL = {
  id: string;
  book_id: string;
  cfi: string | null;
  page: number | null;
  quote: string;
  note: string | null;
  created_at: string;
  inkshelf_books: { title: string } | null;
};

export default function NotesPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<HL[]>([]);
  const [sideOpen, setSideOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("inkshelf_highlights")
      .select("id,book_id,cfi,page,quote,note,created_at,inkshelf_books(title)")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as HL[]);
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
    await supabase.from("inkshelf_highlights").delete().eq("id", id);
  }

  function exportMd() {
    const byBook = new Map<string, HL[]>();
    for (const r of rows) {
      const k = r.inkshelf_books?.title ?? "—";
      byBook.set(k, [...(byBook.get(k) ?? []), r]);
    }
    let md = `# ${t("nav_notes")}\n\n`;
    for (const [book, list] of byBook) {
      md += `## ${book}\n\n`;
      for (const h of list) {
        md += `> ${h.quote}\n`;
        if (h.note) md += `\n${h.note}\n`;
        md += `\n`;
      }
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inkshelf-notes.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  // 按书分组
  const groups: { title: string; items: HL[] }[] = [];
  for (const r of rows) {
    const title = r.inkshelf_books?.title ?? "—";
    const g = groups.find((x) => x.title === title);
    if (g) g.items.push(r);
    else groups.push({ title, items: [r] });
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
        <button className="side-item on">{t("nav_notes")}</button>
        <Link href="/vocab" className="side-item">{t("nav_vocab")}</Link>
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
          <h1 className="page-title">{t("nav_notes")}</h1>
          {rows.length > 0 && <button className="btn" onClick={exportMd}>{t("export_md")}</button>}
        </div>

        {!loaded ? (
          <div style={{ color: "var(--ink-3)", padding: "20px 0" }}>{t("computing")}</div>
        ) : rows.length === 0 ? (
          <div className="dropzone">
            <div className="big">{t("notes_empty")}</div>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.title} className="stat-sec">
              <h2 className="stat-h2">{g.title}</h2>
              <div className="note-list">
                {g.items.map((h) => (
                  <div key={h.id} className="note-card">
                    <Link
                      href={h.cfi ? `/read/${h.book_id}#${encodeURIComponent(h.cfi)}` : `/read/${h.book_id}`}
                      className="note-quote"
                    >
                      {h.quote}
                    </Link>
                    {h.note && <div className="note-body">{h.note}</div>}
                    <button className="note-del" onClick={() => del(h.id)}>{t("del")}</button>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
