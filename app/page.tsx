"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, type Book } from "@/lib/supabase";

const BUCKET = "inkshelf-books";
const STATUS_LABEL: Record<Book["status"], string> = {
  reading: "在读",
  want: "想读",
  done: "读完",
};
const STATUS_NEXT: Record<Book["status"], Book["status"]> = {
  want: "reading",
  reading: "done",
  done: "want",
};

/* deterministic placeholder gradient per title */
function phGradient(title: string) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 22% 42%), hsl(${(h + 30) % 360} 26% 26%))`;
}

type EpubMeta = { title?: string; creator?: string; language?: string };
type PdfInfo = { Title?: string; Author?: string };

export default function ShelfPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | Book["status"]>("all");
  const [view, setView] = useState<"gallery" | "table">("gallery");
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
      setToast({ text: `读取书架失败：${error.message}`, err: true });
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
        setToast({ text: `${file.name}：只支持 .epub / .pdf`, err: true });
        continue;
      }
      setToast({ text: `正在上架 ${file.name} …` });
      try {
        const buf = await file.arrayBuffer();
        const meta = ext === "epub" ? await parseEpub(buf) : await parsePdf(buf);
        const bookId = crypto.randomUUID();
        const filePath = `${uid}/${bookId}.${ext}`;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(filePath, file, {
          contentType: ext === "epub" ? "application/epub+zip" : "application/pdf",
        });
        if (upErr) throw new Error(`上传失败：${upErr.message}`);

        let coverPath: string | null = null;
        if (meta.cover) {
          coverPath = `${uid}/${bookId}-cover.jpg`;
          const { error: cvErr } = await supabase.storage
            .from(BUCKET)
            .upload(coverPath, meta.cover, { contentType: "image/jpeg" });
          if (cvErr) coverPath = null; // 封面失败不拦上架
        }

        const { error: insErr } = await supabase.from("inkshelf_books").insert({
          id: bookId,
          owner: uid,
          title: meta.title?.trim() || file.name.replace(/\.(epub|pdf)$/i, ""),
          author: meta.author?.trim() || null,
          format: ext,
          file_path: filePath,
          cover_path: coverPath,
          language: meta.language || null,
          file_size: file.size,
        });
        if (insErr) throw new Error(`入库失败：${insErr.message}`);

        setToast({ text: `《${meta.title?.trim() || file.name}》已上架` });
        await loadBooks();
      } catch (err) {
        setToast({
          text: `${file.name}：${err instanceof Error ? err.message : "导入失败"}`,
          err: true,
        });
      }
    }
    setTimeout(() => setToast(null), 4000);
  }

  async function removeBook(b: Book) {
    if (!window.confirm(`把《${b.title}》从书架移除？文件会一并删除。`)) return;
    const paths = [b.file_path, ...(b.cover_path ? [b.cover_path] : [])];
    await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from("inkshelf_books").delete().eq("id", b.id);
    if (error) setToast({ text: `删除失败：${error.message}`, err: true });
    else loadBooks();
  }

  async function cycleStatus(b: Book) {
    const next = STATUS_NEXT[b.status];
    setBooks((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from("inkshelf_books").update({ status: next }).eq("id", b.id);
    if (error) {
      setToast({ text: `状态更新失败：${error.message}`, err: true });
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
          <span className="name">墨架</span>
        </div>
        <button className="side-item on">书架</button>
        <button className="side-item dim" title="M1 再来">笔记本 · 待建</button>
        <Link href="/stats" className="side-item">阅读统计</Link>
        <div className="side-foot">
          <label className="side-item" style={{ cursor: "pointer" }}>
            ＋ 导入书
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
            退出登录
          </button>
        </div>
      </aside>

      <main className="main">
        <button className="mobile-menu" onClick={() => setSideOpen(true)}>☰ 菜单</button>
        <h1 className="page-title">书架</h1>

        <div className="view-row">
          <button className={`tab ${view === "gallery" ? "on" : ""}`} onClick={() => setView("gallery")}>
            ⊞ 画廊
          </button>
          <button className={`tab ${view === "table" ? "on" : ""}`} onClick={() => setView("table")}>
            ☰ 表格
          </button>
          <span className="spacer" />
          <div className="filters">
            {(["all", "reading", "want", "done"] as const).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f === "all" ? `全部 ${books.length}` : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        {loaded && shown.length === 0 ? (
          <div className={`dropzone ${dragOver ? "over" : ""}`}>
            <div className="big">把 PDF / EPUB 拖到这里</div>
            <div>或点侧栏「＋ 导入书」——书和进度会同步到你的每台设备</div>
          </div>
        ) : view === "gallery" ? (
          <div className="grid">
            {shown.map((b) => (
              <div key={b.id} className="book-card">
                <Link href={`/read/${b.id}`} className="card-in" aria-label={`打开《${b.title}》`}>
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
                        title="点击切换状态"
                      >
                        {STATUS_LABEL[b.status]}
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
                        移除
                      </button>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <table className="db-table">
            <thead>
              <tr>
                <th>书名</th>
                <th>作者</th>
                <th>状态</th>
                <th>进度</th>
                <th>格式</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id}>
                  <td className="t-title">
                    <Link href={`/read/${b.id}`}>{b.title}</Link>
                  </td>
                  <td style={{ color: "var(--ink-2)" }}>{b.author ?? "—"}</td>
                  <td>
                    <button className={`tag ${b.status}`} onClick={() => cycleStatus(b)}>
                      {STATUS_LABEL[b.status]}
                    </button>
                  </td>
                  <td className="num">{Math.round(b.percent * 100)}%</td>
                  <td className="num">{b.format.toUpperCase()}</td>
                  <td>
                    <button className="rm" style={{ fontSize: 12 }} onClick={() => removeBook(b)}>
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      {dragOver && books.length > 0 && <div className="toast">松手即上架 (.epub / .pdf)</div>}
      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}
