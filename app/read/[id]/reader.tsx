"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, type Book } from "@/lib/supabase";
import { useI18n, LangSwitch } from "@/lib/i18n";

const BUCKET = "inkshelf-books";
const FONT_STEPS = [90, 100, 115, 130, 150];
const IDLE_MS = 180_000; // 无翻页/滚动超 3 分钟 → 停表（挂机不计）
const SPLIT_MS = 300_000; // 超 5 分钟静默 → 断为新一场阅读

type EpubContents = { window: Window };
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  prev: () => void;
  next: () => void;
  on(event: "relocated", cb: (loc: EpubLocation) => void): void;
  on(event: "selected", cb: (cfiRange: string, contents: EpubContents) => void): void;
  resize: (width?: number, height?: number) => void;
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
type PdfTextItem = { str?: string };
type PdfPage = {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};
type PdfRef = object;
type PdfOutlineItem = { title: string; dest: string | unknown[] | null };
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  getOutline: () => Promise<PdfOutlineItem[] | null>;
  getDestination: (id: string) => Promise<unknown[] | null>;
  getPageIndex: (ref: PdfRef) => Promise<number>;
};
type PdfTask = { promise: Promise<unknown>; destroy: () => Promise<void> };
type EpubNavItem = { label: string; href: string; subitems?: EpubNavItem[] };
type TocEntry = { label: string; target: string; depth: number };

export default function Reader({ id }: { id: string }) {
  const router = useRouter();
  const { t, locale } = useI18n();

  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState("");
  const [surface, setSurface] = useState<"paper" | "night">("paper");
  const [fontIdx, setFontIdx] = useState(1);
  const [percent, setPercent] = useState(0);
  const [pageInfo, setPageInfo] = useState("");
  const [saved, setSaved] = useState(true);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [jumpPage, setJumpPage] = useState("");

  /* ── M2: AI 伴读 + 朗读 ── */
  const [selText, setSelText] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMsgs, setAiMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakAliveRef = useRef(false);
  const aiMsgsRef = useRef<HTMLDivElement>(null);

  const epubViewRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const pdfDocRef = useRef<PdfDoc | null>(null);
  const pdfTaskRef = useRef<PdfTask | null>(null);
  const pdfPageRef = useRef(1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── M1: 读书计时（会话表=真值，books.total_seconds=快速缓存）──
     诚实规则：切后台不计 / 超 IDLE_MS 无动作停表 / 超 SPLIT_MS 断为新一场 */
  const uidRef = useRef<string | null>(null);
  const lastActRef = useRef(0);
  const sitSecRef = useRef(0); // 本场累计秒
  const sitIdRef = useRef<string | null>(null);
  const flushBaseRef = useRef(0); // 上次落库时的秒数
  const [liveSecs, setLiveSecs] = useState(0);

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
      uidRef.current = sess.session.user.id;
      lastActRef.current = Date.now();
      const { data, error } = await supabase.from("inkshelf_books").select("*").eq("id", id).single();
      if (error || !data) {
        setErr(t("notfound"));
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
        body: { background: "#ffffff", color: "#37352f", "line-height": "1.85" },
      });
      rendition.themes.register("night", {
        body: { background: "#191919", color: "#d3d1cb", "line-height": "1.85" },
      });
      rendition.themes.select("paper");
      rendition.themes.fontSize(`${FONT_STEPS[1]}%`);

      rendition.on("selected", (_cfiRange: string, contents: EpubContents) => {
        const t = contents.window.getSelection()?.toString().trim() ?? "";
        if (t) setSelText(t);
      });

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

      // 目录：epub 导航树拍平两层
      try {
        const nav = (await (eb as unknown as { loaded: { navigation: Promise<{ toc: EpubNavItem[] }> } }).loaded.navigation);
        const entries: TocEntry[] = [];
        for (const it of nav.toc) {
          entries.push({ label: it.label.trim(), target: it.href, depth: 0 });
          for (const sub of it.subitems ?? []) {
            entries.push({ label: sub.label.trim(), target: sub.href, depth: 1 });
          }
        }
        setToc(entries);
      } catch {
        setToc([]);
      }
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

      // 目录：PDF 书签大纲 → 解析到页码（没有大纲则留空，抽屉里走页码跳转）
      try {
        const outline = await doc.getOutline();
        if (outline?.length) {
          const entries: TocEntry[] = [];
          for (const it of outline.slice(0, 300)) {
            let dest = it.dest;
            if (typeof dest === "string") dest = await doc.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) {
              try {
                const idx = await doc.getPageIndex(dest[0] as PdfRef);
                entries.push({ label: it.title, target: String(idx + 1), depth: 0 });
              } catch {
                /* 单条坏目的地跳过 */
              }
            }
          }
          setToc(entries);
        }
      } catch {
        setToc([]);
      }
    }

    void Promise.resolve().then(boot);
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      speakAliveRef.current = false;
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
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
      lastActRef.current = Date.now();
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

  /* 落库一次：session 行 + 原子累加 total_seconds */
  const flushClock = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    const secs = sitSecRef.current;
    const delta = secs - flushBaseRef.current;
    if (delta <= 0) return;
    const nowIso = new Date().toISOString();
    try {
      if (!sitIdRef.current) {
        const sid = crypto.randomUUID();
        const started = new Date(Date.now() - secs * 1000).toISOString();
        const { error } = await supabase.from("inkshelf_sessions").insert({
          id: sid,
          owner: uid,
          book_id: id,
          started_at: started,
          ended_at: nowIso,
          seconds: secs,
        });
        if (error) return;
        sitIdRef.current = sid;
      } else {
        await supabase
          .from("inkshelf_sessions")
          .update({ seconds: secs, ended_at: nowIso, updated_at: nowIso })
          .eq("id", sitIdRef.current);
      }
      await supabase.rpc("inkshelf_add_reading_time", { p_book: id, p_seconds: delta });
      flushBaseRef.current = secs;
    } catch {
      /* 下个 flush 周期重试 */
    }
  }, [id]);

  function jumpTo(target: string) {
    lastActRef.current = Date.now();
    setTocOpen(false);
    if (book?.format === "epub") {
      renditionRef.current?.display(target);
    } else if (pdfDocRef.current) {
      const n = Math.min(Math.max(parseInt(target, 10) || 1, 1), pdfDocRef.current.numPages);
      pdfPageRef.current = n;
      renderPdfPage(n);
    }
  }

  /* ── AI 伴读 ── */
  const streamAI = useCallback(
    async (userContent: string) => {
      setAiOpen(true);
      setAiBusy(true);
      const base = [...aiMsgs, { role: "user" as const, content: userContent }];
      setAiMsgs([...base, { role: "assistant", content: "…" }]);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const resp = await fetch("/api/ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({
            bookTitle: book?.title,
            author: book?.author,
            locale,
            messages: base,
          }),
        });
        if (!resp.ok || !resp.body) {
          setAiMsgs([...base, { role: "assistant", content: `出错了（HTTP ${resp.status}），请重试` }]);
          return;
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setAiMsgs([...base, { role: "assistant", content: acc }]);
        }
        if (!acc) {
          setAiMsgs([
            ...base,
            { role: "assistant", content: "AI 服务没有返回内容——通常是 AI Gateway 的额度/绑卡问题，去 Vercel 控制台 AI 页检查后重试。" },
          ]);
        }
      } catch {
        setAiMsgs([...base, { role: "assistant", content: "网络出错，请重试" }]);
      } finally {
        setAiBusy(false);
      }
    },
    [aiMsgs, book?.title, book?.author, locale]
  );

  function quickAsk(kind: "explain" | "translate" | "ask") {
    const quote = selText;
    if (!quote) return;
    setSelText("");
    if (kind === "ask") {
      setAiOpen(true);
      setAiInput(`关于这段：「${quote.slice(0, 120)}${quote.length > 120 ? "…" : ""}」 `);
      return;
    }
    const instruction =
      kind === "explain"
        ? "解释这段内容（含必要的背景和它在本书语境中的意思）："
        : "翻译这段（原文非中文则译成中文；原文是中文则译成英文）：";
    streamAI(`${instruction}\n\n${quote}`);
  }

  async function pdfCurrentPageText(): Promise<string> {
    const doc = pdfDocRef.current;
    if (!doc) return "";
    const page = await doc.getPage(pdfPageRef.current);
    const tc = await page.getTextContent();
    return tc.items.map((i) => i.str ?? "").join(" ").trim();
  }

  async function askAboutPdfPage() {
    const text = await pdfCurrentPageText();
    if (!text) {
      streamAI("这一页提取不到文字（可能是扫描版 PDF），请告诉读者这种页面暂时无法讲解。");
      return;
    }
    streamAI(`讲解这一页的内容（P.${pdfPageRef.current}）：\n\n${text.slice(0, 6000)}`);
  }

  /* ── 朗读（浏览器 speechSynthesis）── */
  function guessLang(text: string): string {
    if (book?.language?.trim()) return book.language;
    if (/[぀-ヿ]/.test(text)) return "ja-JP";
    if (/[一-鿿]/.test(text)) return "zh-CN";
    return "en-US";
  }

  function speakStop() {
    speakAliveRef.current = false;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function speakChunks(text: string, onAllDone?: () => void) {
    const synth = window.speechSynthesis;
    const lang = guessLang(text);
    const chunks = text.match(/[^。．.!?！？\n]+[。．.!?！？\n]?/g)?.filter((c) => c.trim()) ?? [];
    if (!chunks.length) {
      onAllDone?.();
      return;
    }
    let i = 0;
    const next = () => {
      if (!speakAliveRef.current) return;
      if (i >= chunks.length) {
        onAllDone?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = lang;
      u.onend = next;
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    };
    next();
  }

  async function speakToggle() {
    if (speaking) {
      speakStop();
      return;
    }
    speakAliveRef.current = true;
    setSpeaking(true);
    if (book?.format === "pdf") {
      const readPage = async () => {
        if (!speakAliveRef.current) return;
        const text = await pdfCurrentPageText();
        speakChunks(text || "（本页无可朗读文字）", async () => {
          const doc = pdfDocRef.current;
          if (speakAliveRef.current && doc && pdfPageRef.current < doc.numPages) {
            go(1);
            setTimeout(readPage, 600); // 等页面渲染与进度保存
          } else {
            speakStop();
          }
        });
      };
      readPage();
    } else {
      const iframe = document.querySelector("#epub-view iframe") as HTMLIFrameElement | null;
      const text = iframe?.contentDocument?.body?.innerText ?? "";
      speakChunks(text || "（本章无可朗读文字）", () => speakStop());
    }
  }

  function speakSelection() {
    if (!selText) return;
    speakAliveRef.current = true;
    setSpeaking(true);
    speakChunks(selText, () => speakStop());
    setSelText("");
  }

  /* ── 语音提问（webkitSpeechRecognition，按浏览器支持情况显示）── */
  type SR = { lang: string; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; onend: () => void; start: () => void };
  const srCtor = (typeof window !== "undefined"
    ? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
    : undefined);
  const [listening, setListening] = useState(false);
  function startDictation() {
    if (!srCtor) return;
    const rec = new srCtor();
    rec.lang = "zh-CN";
    rec.onresult = (e) => setAiInput((v) => v + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  useEffect(() => {
    aiMsgsRef.current?.scrollTo({ top: aiMsgsRef.current.scrollHeight });
  }, [aiMsgs]);

  /* AI 面板开合会改变正文宽度 → 让 epub/pdf 重排，避免被遮挡 */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (book?.format === "epub") {
        const el = epubViewRef.current;
        if (el && renditionRef.current?.resize) {
          renditionRef.current.resize(el.clientWidth, el.clientHeight);
        }
      } else if (pdfDocRef.current) {
        renderPdfPage(pdfPageRef.current);
      }
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen]);

  /* 触屏滑动翻页 */
  const touchX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    lastActRef.current = Date.now();
    touchX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 55) go(dx < 0 ? 1 : -1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  /* 读书计时主循环：每秒判定是否在真实阅读，每 20 秒落库 */
  useEffect(() => {
    let tick = 0;
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const idle = Date.now() - lastActRef.current;
      if (idle > IDLE_MS) {
        if (sitIdRef.current && idle > SPLIT_MS) {
          // 久未动作：结清本场，下次动作开新一场
          flushClock().then(() => {
            sitSecRef.current = 0;
            sitIdRef.current = null;
            flushBaseRef.current = 0;
            setLiveSecs(0);
          });
        }
        return;
      }
      sitSecRef.current += 1;
      setLiveSecs(sitSecRef.current);
      tick += 1;
      if (tick % 20 === 0) flushClock();
    }, 1000);
    const onVis = () => {
      if (document.hidden) flushClock();
    };
    const onHide = () => flushClock();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      flushClock();
    };
  }, [flushClock]);

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
          {t("back")}
        </Link>
        <div className="reader-title">
          {book ? `${book.title}${book.author ? ` · ${book.author}` : ""}` : "…"}
        </div>
        <div className="reader-tools">
          <button onClick={() => setTocOpen((v) => !v)} aria-expanded={tocOpen}>{t("toc")}</button>
          {book?.format === "epub" && (
            <>
              <button onClick={() => setFont(fontIdx - 1)} aria-label="A−">A−</button>
              <button onClick={() => setFont(fontIdx + 1)} aria-label="A+">A+</button>
            </>
          )}
          {book?.format === "pdf" && (
            <button onClick={askAboutPdfPage} disabled={aiBusy}>{t("ai_page")}</button>
          )}
          <button onClick={speakToggle} className={speaking ? "speaking" : ""}>
            {speaking ? t("stop") : t("read_aloud")}
          </button>
          <button onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen}>{t("ai")}</button>
          <button onClick={toggleSurface}>{surface === "paper" ? t("night") : t("paper")}</button>
          <LangSwitch compact />
        </div>
      </div>

      <div className="reader-body">
      <div className={`reader-stage ${surface}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {err ? (
          <div className="center-msg">{err}</div>
        ) : !book ? (
          <div className="center-msg">{t("getting")}</div>
        ) : null}
        {book?.format === "epub" && <div id="epub-view" ref={epubViewRef} />}
        {book?.format === "pdf" && (
          <div className="pdf-scroll" onScroll={() => { lastActRef.current = Date.now(); }}>
            <canvas ref={pdfCanvasRef} />
          </div>
        )}
        <div className="nav-zone left" onClick={() => go(-1)} aria-label="上一页" />
        <div className="nav-zone right" onClick={() => go(1)} aria-label="下一页" />
        <button className="nav-btn left" onClick={() => go(-1)} aria-label="上一页">‹</button>
        <button className="nav-btn right" onClick={() => go(1)} aria-label="下一页">›</button>

        {tocOpen && (
          <>
            <div className="toc-scrim" onClick={() => setTocOpen(false)} />
            <aside className="toc-drawer">
              <div className="mono-label" style={{ marginBottom: 12 }}>{t("toc")}</div>
              {toc.length ? (
                <ul className="toc-list">
                  {toc.map((t, i) => (
                    <li key={i} style={{ paddingLeft: t.depth * 14 }}>
                      <button onClick={() => jumpTo(t.target)}>{t.label}</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="toc-empty">
                  {t("toc_empty")}
                  {book?.format === "pdf" ? t("toc_pdf") : ""}
                </div>
              )}
              {book?.format === "pdf" && (
                <form
                  className="toc-jump"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (jumpPage) jumpTo(jumpPage);
                  }}
                >
                  <input
                    type="number"
                    min={1}
                    placeholder={t("pageno")}
                    value={jumpPage}
                    onChange={(e) => setJumpPage(e.target.value)}
                  />
                  <button type="submit">{t("jump")}</button>
                </form>
              )}
            </aside>
          </>
        )}

        {selText && (
        <div className="sel-actions" role="toolbar" aria-label="选段操作">
          <span className="sel-quote">「{selText.slice(0, 40)}{selText.length > 40 ? "…" : ""}」</span>
          <button onClick={() => quickAsk("explain")}>{t("explain")}</button>
          <button onClick={() => quickAsk("translate")}>{t("translate")}</button>
          <button onClick={() => quickAsk("ask")}>{t("ask_ai")}</button>
          <button onClick={speakSelection}>{t("read_aloud")}</button>
          <button onClick={() => setSelText("")} aria-label="关闭">✕</button>
        </div>
      )}
      </div>

      {aiOpen && (
        <aside className="ai-panel" aria-label="AI 伴读">
          <div className="ai-head">
            <span className="mono-label blush">{t("ai_companion")}</span>
            <button onClick={() => setAiOpen(false)} aria-label="收起">✕</button>
          </div>
          <div className="ai-msgs" ref={aiMsgsRef}>
            {aiMsgs.length === 0 && (
              <div className="ai-hint">
                {book?.format === "epub" ? t("ai_hint_epub") : t("ai_hint_pdf")}
              </div>
            )}
            {aiMsgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
          </div>
          <form
            className="ai-input"
            onSubmit={(e) => {
              e.preventDefault();
              const q = aiInput.trim();
              if (!q || aiBusy) return;
              setAiInput("");
              streamAI(q);
            }}
          >
            <input
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder={t("ai_ph")}
            />
            {srCtor && (
              <button
                type="button"
                onClick={startDictation}
                className={listening ? "speaking" : ""}
                aria-label={t("say")}
              >
                {listening ? t("listening") : t("say")}
              </button>
            )}
            <button type="submit" className="primary" disabled={aiBusy}>
              {aiBusy ? "…" : t("send")}
            </button>
          </form>
        </aside>
      )}
      </div>

      <div className="reader-foot">
        <span>{pageInfo}</span>
        <span>
          {liveSecs > 0 && (
            <>
              {t("this_time")} {liveSecs < 60 ? `${liveSecs} ${t("sec")}` : `${Math.floor(liveSecs / 60)} ${t("min")}`}
              {" · "}
            </>
          )}
          <span className="pct">{Math.round(percent * 100)}%</span>
          {" · "}
          {saved ? t("synced") : t("saving")}
        </span>
      </div>
    </div>
  );
}
