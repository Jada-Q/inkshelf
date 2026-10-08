"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, type Book } from "@/lib/supabase";
import { useI18n, LangSwitch } from "@/lib/i18n";

const BUCKET = "inkshelf-books";
const STATUS_NEXT: Record<Book["status"], Book["status"]> = {
  want: "reading",
  reading: "done",
  done: "want",
};

function phGradient(title: string) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 22% 42%), hsl(${(h + 30) % 360} 26% 26%))`;
}

type EpubMeta = { title?: string; creator?: string; language?: string };
type PdfInfo = { Title?: string; Author?: string };

export default function ShelfPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [uid, setUid] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | Book["status"]>("all");
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const loadBooks = useCallback(async () => {
    const { data, error } = await supabase
      .from("inkshelf_books")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      setToast({ text: error.message, err: true });
      return;
    }
    const list = (data ?? []) as Book[];
    setBooks(list);
    setLoaded(true);
    const paths = list.filter((b) => b.cover_path).map((b) => b.cover_path as string);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (signed) {
        const map: Record<string, string> = {};
        signed.forEach((s) => {
          if (s.signedUrl && s.path) map[s.path] = s.signedUrl;
        });
        setCovers(map);
      }
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setUid(data.session.user.id);
      loadBooks();
    });
  }, [router, loadBooks]);

  async function parseEpub(buf: ArrayBuffer) {
    const ePub = (await import("epubjs")).default;
    const book = ePub(buf.slice(0));
    await book.ready;
    const meta = (await book.loaded.metadata) as EpubMeta;
    let cover: Blob | null = null;
    try {
      const coverUrl: string | null = await book.coverUrl();
      if (coverUrl) cover = await (await fetch(coverUrl)).blob();
    } catch {
      cover = null;
    }
    book.destroy();
    return { title: meta.title, author: meta.creator, language: meta.language, cover };
  }

  async function parsePdf(buf: ArrayBuffer) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: buf.slice(0) });
    const doc = await task.promise;
    let title: string | undefined, author: string | undefined;
    try {
      const md = await doc.getMetadata();
      const info = md?.info as PdfInfo | undefined;
      title = info?.Title || undefined;
      author = info?.Author || undefined;
    } catch {
      /* metadata optional */
    }
    let cover: Blob | null = null;
    try {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 400 / vp.width;
      const sv = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = sv.width;
      canvas.height = sv.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        await page.render({ canvas, canvasContext: ctx, viewport: sv }).promise;
        cover = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
      }
    } catch {
      cover = null;
    }
    await task.destroy();
    return { title, author, language: undefined, cover };
  }

  async function importFiles(files: FileList | File[]) {
    if (!uid) return;
    for (const file of Array.from(files)) {
      const ext = file.name.toLowerCase().endsWith(".epub")
        ? "epub"
        : file.name.toLowerCase().endsWith(".pdf")
          ? "pdf"
          : null;
      if (!ext) {
        setToast({ text: t("t_badfmt", { name: file.name }), err: true });
        continue;
      }
      setToast({ text: t("t_importing", { name: file.name }) });
      try {
        const buf = await file.arrayBuffer();
        const meta = ext === "epub" ? await parseEpub(buf) : await parsePdf(buf);
        const bookId = crypto.randomUUID();
        const filePath = `${uid}/${bookId}.${ext}`;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(filePath, file, {
          contentType: ext === "epub" ? "application/epub+zip" : "application/pdf",
        });
        if (upErr) throw new Error(upErr.message);

        let coverPath: string | null = null;
        if (meta.cover) {
          coverPath = `${uid}/${bookId}-cover.jpg`;
          const { error: cvErr } = await supabase.storage
            .from(BUCKET)
            .upload(coverPath, meta.cover, { contentType: "image/jpeg" });
          if (cvErr) coverPath = null;
        }

        const title = meta.title?.trim() || file.name.replace(/\.(epub|pdf)$/i, "");
        const { error: insErr } = await supabase.from("inkshelf_books").insert({
          id: bookId,
          owner: uid,
          title,
          author: meta.author?.trim() || null,
          format: ext,
          file_path: filePath,
          cover_path: coverPath,
          language: meta.language || null,
          file_size: file.size,
        });
        if (insErr) throw new Error(insErr.message);

        setToast({ text: t("t_shelved", { title }) });
        await loadBooks();
      } catch (err) {
        setToast({
          text: `${file.name}: ${err instanceof Error ? err.message : "error"}`,
          err: true,
        });
      }
    }
    setTimeout(() => setToast(null), 4000);
  }

  async function removeBook(b: Book) {
    if (!window.confirm(t("remove") + " 《" + b.title + "》?")) return;
    const paths = [b.file_path, ...(b.cover_path ? [b.cover_path] : [])];
    await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from("inkshelf_books").delete().eq("id", b.id);
    if (error) setToast({ text: error.message, err: true });
    else loadBooks();
  }

  async function cycleStatus(b: Book) {
    const next = STATUS_NEXT[b.status];
    setBooks((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from("inkshelf_books").update({ status: next }).eq("id", b.id);
    if (error) {
      setToast({ text: error.message, err: true });
      loadBooks();
    }
  }

  const shown = filter === "all" ? books : books.filter((b) => b.status === filter);

  return (
    <div
      className="ws"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
      }}
    >
      <div className={`side-scrim ${sideOpen ? "show" : ""}`} onClick={() => setSideOpen(false)} />
      <aside className={`side ${sideOpen ? "open" : ""}`}>
        <div className="side-brand">
          <span className="glyph">墨</span>
          <span className="name">{t("brand")}</span>
        </div>
        <button className="side-item on">{t("nav_shelf")}</button>
        <Link href="/notes" className="side-item">{t("nav_notes")}</Link>
        <Link href="/vocab" className="side-item">{t("nav_vocab")}</Link>
        <Link href="/stats" className="side-item">{t("nav_stats")}</Link>
        <div className="side-foot">
          <LangSwitch />
          <label className="side-item" style={{ cursor: "pointer" }}>
            {t("import")}
            <input
              type="file"
              accept=".epub,.pdf"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) importFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
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
        <h1 className="page-title">{t("nav_shelf")}</h1>

        <div className="view-row">
          <div className="filters">
            {(["all", "reading", "want", "done"] as const).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f === "all" ? `${t("all")} ${books.length}` : t(f)}
              </button>
            ))}
          </div>
        </div>

        {loaded && shown.length === 0 ? (
          <div className={`dropzone ${dragOver ? "over" : ""}`}>
            <div className="big">{t("drop_big")}</div>
            <div>{t("drop_sub")}</div>
          </div>
        ) : (
          <div className="grid">
            {shown.map((b) => (
              <div key={b.id} className="book-card">
                <Link href={`/read/${b.id}`} className="card-in" aria-label={b.title}>
                  <div className="cover">
                    {b.cover_path && covers[b.cover_path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={covers[b.cover_path]} alt="" />
                    ) : (
                      <div className="ph" style={{ background: phGradient(b.title) }}>
                        {b.title}
                      </div>
                    )}
                  </div>
                  <div className="card-body">
                    <span className="card-title">{b.title}</span>
                    <div className="card-props">
                      <button
                        className={`tag ${b.status}`}
                        onClick={(e) => {
                          e.preventDefault();
                          cycleStatus(b);
                        }}
                        title={t("switch_status")}
                      >
                        {t(b.status)}
                      </button>
                      <span className="pct">{Math.round(b.percent * 100)}%</span>
                    </div>
                    <div className="prog">
                      <i style={{ width: `${Math.round(b.percent * 100)}%` }} />
                    </div>
                    <div className="card-meta">
                      <span>{b.author ?? b.format.toUpperCase()}</span>
                      <button
                        className="rm"
                        onClick={(e) => {
                          e.preventDefault();
                          removeBook(b);
                        }}
                      >
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>

      {dragOver && books.length > 0 && <div className="toast">{t("drop_toast")}</div>}
      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}
