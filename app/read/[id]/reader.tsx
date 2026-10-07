"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, type Book } from "@/lib/supabase";

const BUCKET = "inkshelf-books";
const FONT_STEPS = [90, 100, 115, 130, 150];

type EpubRendition = {
  display: (target?: string) => Promise<void>;
  prev: () => void;
  next: () => void;
  on: (event: string, cb: (loc: EpubLocation) => void) => void;
  themes: {
    register: (name: string, rules: Record<string, Record<string, string>>) => void;
    select: (name: string) => void;
    fontSize: (size: string) => void;
  };
  destroy: () => void;
};
type EpubLocation = { start: { cfi: string; percentage?: number } };
type EpubBook = {
  ready: Promise<void>;
  renderTo: (el: Element, opts: Record<string, unknown>) => EpubRendition;
  locations: { generate: (chars: number) => Promise<unknown>; percentageFromCfi: (cfi: string) => number; length: () => number };
  destroy: () => void;
};
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfTask = { promise: Promise<unknown>; destroy: () => Promise<void> };

export default function Reader({ id }: { id: string }) {
  const router = useRouter();

  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState("");
  const [surface, setSurface] = useState<"paper" | "night">("paper");
  const [fontIdx, setFontIdx] = useState(1);
  const [percent, setPercent] = useState(0);
  const [pageInfo, setPageInfo] = useState("");
  const [saved, setSaved] = useState(true);

  const epubViewRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const pdfDocRef = useRef<PdfDoc | null>(null);
  const pdfTaskRef = useRef<PdfTask | null>(null);
  const pdfPageRef = useRef(1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* debounced progress save */
  const saveProgress = useCallback(
    (position: string, pct: number) => {
      setSaved(false);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const { error } = await supabase
          .from("inkshelf_books")
          .update({ position, percent: pct, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (!error) setSaved(true);
      }, 1200);
    },
    [id]
  );

  /* load book row + file, mount the right engine */
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        router.replace("/login");
        return;
      }
      const { data, error } = await supabase.from("inkshelf_books").select("*").eq("id", id).single();
      if (error || !data) {
        setErr("找不到这本书");
        return;
      }
      const b = data as Book;
      if (cancelled) return;
      setBook(b);
      setPercent(b.percent);

      const { data: signed, error: sErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(b.file_path, 21600);
      if (sErr || !signed) {
        setErr(`取书失败：${sErr?.message ?? "无签名地址"}`);
        return;
      }
      const resp = await fetch(signed.signedUrl);
      if (!resp.ok) {
        setErr(`下载失败：HTTP ${resp.status}`);
        return;
      }
      const buf = await resp.arrayBuffer();
      if (cancelled) return;

      if (b.format === "epub") await mountEpub(b, buf);
      else await mountPdf(b, buf);
    }

    async function mountEpub(b: Book, buf: ArrayBuffer) {
      const ePub = (await import("epubjs")).default;
      const eb = ePub(buf) as EpubBook;
      epubBookRef.current = eb;
      await eb.ready;
      if (!epubViewRef.current) return;
      const rendition = eb.renderTo(epubViewRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      rendition.themes.register("paper", {
        body: { background: "#fcfaf5", color: "#2a2622", "line-height": "1.85" },
      });
      rendition.themes.register("night", {
        body: { background: "#1b1820", color: "#cfc9c0", "line-height": "1.85" },
      });
      rendition.themes.select("paper");
      rendition.themes.fontSize(`${FONT_STEPS[1]}%`);

      rendition.on("relocated", (loc: EpubLocation) => {
        const cfi = loc.start.cfi;
        let pct = loc.start.percentage ?? 0;
        if (!pct && epubBookRef.current && epubBookRef.current.locations.length() > 0) {
          pct = epubBookRef.current.locations.percentageFromCfi(cfi);
        }
        if (pct > 0) setPercent(pct);
        setPageInfo(cfi.slice(0, 28) + "…");
        saveProgress(cfi, pct > 0 ? pct : 0);
      });

      await rendition.display(b.position || undefined);
      // locations 用于精确百分比，后台生成
      eb.locations.generate(600).catch(() => {});
    }

    async function mountPdf(b: Book, buf: ArrayBuffer) {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ data: buf }) as unknown as PdfTask;
      pdfTaskRef.current = task;
      const doc = (await task.promise) as PdfDoc;
      pdfDocRef.current = doc;
      const startPage = Math.min(Math.max(parseInt(b.position || "1", 10) || 1, 1), doc.numPages);
      pdfPageRef.current = startPage;
      await renderPdfPage(startPage);
    }

    void Promise.resolve().then(boot);
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      renditionRef.current?.destroy();
      epubBookRef.current?.destroy();
      pdfTaskRef.current?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function renderPdfPage(n: number) {
    const doc = pdfDocRef.current;
    const canvas = pdfCanvasRef.current;
    if (!doc || !canvas) return;
    const page = await doc.getPage(n);
    const container = canvas.parentElement;
    const maxW = Math.min(container?.clientWidth ?? 800, 900) - 36;
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (maxW / vp1.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const pct = n / doc.numPages;
    setPercent(pct);
    setPageInfo(`P.${n} / ${doc.numPages}`);
    saveProgress(String(n), pct);
  }

  const go = useCallback(
    (dir: 1 | -1) => {
      if (book?.format === "epub") {
        if (dir === 1) renditionRef.current?.next();
        else renditionRef.current?.prev();
      } else if (pdfDocRef.current) {
        const next = Math.min(Math.max(pdfPageRef.current + dir, 1), pdfDocRef.current.numPages);
        if (next !== pdfPageRef.current) {
          pdfPageRef.current = next;
          renderPdfPage(next);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book?.format]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  function setFont(idx: number) {
    const i = Math.min(Math.max(idx, 0), FONT_STEPS.length - 1);
    setFontIdx(i);
    renditionRef.current?.themes.fontSize(`${FONT_STEPS[i]}%`);
  }
  function toggleSurface() {
    const next = surface === "paper" ? "night" : "paper";
    setSurface(next);
    renditionRef.current?.themes.select(next);
  }

  return (
    <div className="reader-shell">
      <div className="reader-top">
        <Link href="/" className="btn" style={{ textDecoration: "none", flexShrink: 0 }}>
          ← 书架
        </Link>
        <div className="reader-title">
          {book ? `${book.title}${book.author ? ` · ${book.author}` : ""}` : "…"}
        </div>
        <div className="reader-tools">
          {book?.format === "epub" && (
            <>
              <button onClick={() => setFont(fontIdx - 1)} aria-label="缩小字号">A−</button>
              <button onClick={() => setFont(fontIdx + 1)} aria-label="放大字号">A+</button>
            </>
          )}
          <button onClick={toggleSurface}>{surface === "paper" ? "夜" : "纸"}</button>
        </div>
      </div>

      <div className={`reader-stage ${surface}`}>
        {err ? (
          <div className="center-msg">{err}</div>
        ) : !book ? (
          <div className="center-msg">取书中…</div>
        ) : null}
        {book?.format === "epub" && <div id="epub-view" ref={epubViewRef} />}
        {book?.format === "pdf" && (
          <div className="pdf-scroll">
            <canvas ref={pdfCanvasRef} />
          </div>
        )}
        <div className="nav-zone left" onClick={() => go(-1)} aria-label="上一页" />
        <div className="nav-zone right" onClick={() => go(1)} aria-label="下一页" />
      </div>

      <div className="reader-foot">
        <span>{pageInfo}</span>
        <span>
          <span className="pct">{Math.round(percent * 100)}%</span>
          {" · "}
          {saved ? "已同步" : "保存中…"}
        </span>
      </div>
    </div>
  );
}
