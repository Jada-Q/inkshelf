"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, type Book } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { lookupWord, type DictEntry } from "@/lib/dict";
import { getCachedBook, putCachedBook, putBookMeta, getBookMeta } from "@/lib/bookcache";

const BUCKET = "inkshelf-books";
const FONT_STEPS = [90, 100, 115, 130, 150];
const IDLE_MS = 180_000; // 无翻页/滚动超 3 分钟 → 停表（挂机不计）
const SPLIT_MS = 300_000; // 超 5 分钟静默 → 断为新一场阅读

type EpubContents = { window: Window; document: Document; cfiFromRange: (r: Range) => string };
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  prev: () => void;
  next: () => void;
  on(event: "relocated", cb: (loc: EpubLocation) => void): void;
  on(event: "selected", cb: (cfiRange: string, contents: EpubContents) => void): void;
  resize: (width?: number, height?: number) => void;
  hooks: { content: { register: (fn: (contents: EpubContents) => void) => void } };
  getContents: () => EpubContents[];
  annotations: {
    add: (type: string, cfiRange: string, data?: object, cb?: () => void, className?: string, styles?: object) => void;
    remove: (cfiRange: string, type: string) => void;
  };
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
  const { t } = useI18n();

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

  /* ── M1: 划线 / 笔记 / 生词 ── */
  const selCfiRef = useRef<string>("");
  const selCtxRef = useRef<string>("");
  const [selPos, setSelPos] = useState<{ x: number; y: number } | null>(null);
  const [rToast, setRToast] = useState<string | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
  /* 进入即静默：chromeOff=true 时隐藏顶/底栏与翻页键，只剩正文 */
  const [chromeOff, setChromeOff] = useState(false);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 触屏能力只能在挂载后(客户端)测，SSR 无 window
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTouch(
      (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
        "ontouchstart" in window
    );
  }, []);


  /* ── M2: 点词翻译 + 朗读 ── */
  const [selText, setSelText] = useState("");
  const [dictHit, setDictHit] = useState<DictEntry | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const speakAliveRef = useRef(false);

  const marksObsRef = useRef<MutationObserver | null>(null);
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

  /* debounced progress save.
     pct 传 null = 只存位置、不动已存百分比（epub locations 还没生成时 pct=0，
     若写进去会把真实进度清零——这里保护它）。 */
  const saveProgress = useCallback(
    (position: string, pct: number | null) => {
      setSaved(false);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const patch: { position: string; updated_at: string; percent?: number } =
          pct == null
            ? { position, updated_at: new Date().toISOString() }
            : { position, percent: pct, updated_at: new Date().toISOString() };
        const { error } = await supabase.from("inkshelf_books").update(patch).eq("id", id);
        if (!error) setSaved(true);
      }, 1200);
    },
    [id]
  );

  /* 浮条定位 + 填充选区信息（桌面拖选 & 触屏点词共用）*/
  const presentRange = useCallback((range: Range, cfi: string, text: string) => {
    try {
      const ir = epubViewRef.current?.querySelector("iframe")?.getBoundingClientRect();
      const rr = range.getBoundingClientRect();
      if (ir) {
        const vw = window.innerWidth;
        const half = Math.min(180, vw * 0.45);
        const x = vw <= 560 ? vw / 2 : Math.max(half, Math.min(vw - half, ir.left + rr.left + rr.width / 2));
        let y = ir.top + rr.bottom + 10;
        if (y > window.innerHeight - 70) y = Math.max(8, ir.top + rr.top - 46);
        setSelPos({ x, y });
      } else {
        setSelPos(null);
      }
    } catch {
      setSelPos(null);
    }
    setSelText(text);
    selCfiRef.current = cfi;
    try {
      const el = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : (range.startContainer as Element);
      const ctx = (el?.textContent ?? "").trim();
      selCtxRef.current = ctx.length > 240 ? ctx.slice(0, 240) : ctx;
    } catch {
      selCtxRef.current = "";
    }
  }, []);

  /* 触屏：在主文档上盖一层透明触摸层（iframe 内的 touch 事件在 iOS 不稳定）→
     滑动翻页 or 点一个词选取（绕开 iOS 原生文字菜单）*/
  const pickWordFromPoint = useCallback(
    (clientX: number, clientY: number): boolean => {
      const rend = renditionRef.current;
      const iframe = epubViewRef.current?.querySelector("iframe");
      const idoc = iframe?.contentDocument as
        | (Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
            caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
          })
        | undefined;
      if (!rend || !iframe || !idoc) return false;
      const ir = iframe.getBoundingClientRect();
      const lx = clientX - ir.left;
      const ly = clientY - ir.top;
      let base: Range | null = null;
      if (idoc.caretRangeFromPoint) base = idoc.caretRangeFromPoint(lx, ly);
      else if (idoc.caretPositionFromPoint) {
        const pos = idoc.caretPositionFromPoint(lx, ly);
        if (pos) { base = idoc.createRange(); base.setStart(pos.offsetNode, pos.offset); base.collapse(true); }
      }
      if (!base) return false;
      const node = base.startContainer;
      if (node.nodeType !== 3 || !node.textContent) return false;
      const tt = node.textContent;
      const isW = (c: string) => !!c && !/\s/.test(c);
      let s = base.startOffset, e = base.startOffset;
      while (s > 0 && isW(tt[s - 1])) s--;
      while (e < tt.length && isW(tt[e])) e++;
      if (e <= s) return false;
      const wr = idoc.createRange();
      wr.setStart(node, s); wr.setEnd(node, e);
      const word = tt.slice(s, e).trim();
      if (!word) return false;
      let cfi = "";
      try { cfi = rend.getContents()[0]?.cfiFromRange(wr) ?? ""; } catch {}
      presentRange(wr, cfi, word);
      return true;
    },
    [presentRange]
  );

  /* chrome 显隐控制 */
  const scheduleHide = useCallback(() => {
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = setTimeout(() => setChromeOff(true), 3500);
  }, []);
  const revealChrome = useCallback(() => {
    setChromeOff(false);
    scheduleHide();
  }, [scheduleHide]);
  const toggleChrome = useCallback(() => {
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    setChromeOff((o) => !o);
  }, []);

  const onLayerStart = useCallback((ev: React.TouchEvent) => {
    const t0 = ev.touches[0];
    touchStartRef.current = { x: t0.clientX, y: t0.clientY, t: Date.now() };
  }, []);

  const onLayerEnd = useCallback(
    (ev: React.TouchEvent) => {
      // 轻点：命中词→选词；没命中（点空白）→ 切换 chrome 显隐。滑动交给 reader-stage 翻页。
      const t0 = ev.changedTouches[0];
      const { x, y, t } = touchStartRef.current;
      const dx = t0.clientX - x, dy = t0.clientY - y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - t < 600) {
        const hit = pickWordFromPoint(t0.clientX, t0.clientY);
        if (!hit) toggleChrome();
      }
    },
    [pickWordFromPoint, toggleChrome]
  );

  /* load book row + file, mount the right engine */
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // getSession 离线时可能卡在 token 刷新上 → 加超时，别让启动挂死
      let session: { user: { id: string } } | null = null;
      try {
        session = await Promise.race([
          supabase.auth.getSession().then((r) => r.data.session),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
      } catch {
        session = null;
      }
      if (session) uidRef.current = session.user.id;
      // 没登录态：有本地缓存就离线只读打开；否则去登录
      if (!session && !getBookMeta<Book>(id)) {
        router.replace("/login");
        return;
      }
      lastActRef.current = Date.now();
      let b: Book | null = null;
      try {
        const { data } = await supabase.from("inkshelf_books").select("*").eq("id", id).single();
        if (data) {
          b = data as Book;
          putBookMeta(id, b); // 缓存元数据，离线时备用
        }
      } catch {
        /* 离线：下面回退到缓存的元数据 */
      }
      if (!b) b = getBookMeta<Book>(id); // 离线回退
      if (!b) {
        setErr(t("notfound"));
        return;
      }
      if (cancelled) return;
      setBook(b);
      setPercent(b.percent);

      // 优先用本地缓存（断网也能开）；没缓存才联网下载一次并缓存
      let buf = await getCachedBook(b.id);
      if (!buf) {
        const { data: signed, error: sErr } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(b.file_path, 21600);
        if (sErr || !signed) {
          setErr(t("book_need_net"));
          return;
        }
        let resp: Response;
        try {
          resp = await fetch(signed.signedUrl);
        } catch {
          setErr(t("book_need_net")); // 没缓存又离线
          return;
        }
        if (!resp.ok) {
          setErr(`下载失败：HTTP ${resp.status}`);
          return;
        }
        buf = await resp.arrayBuffer();
        if (cancelled) return;
        void putCachedBook(b.id, buf.slice(0)); // 缓存一份副本，供下次离线打开
      }

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
      // 监听标注层变化（翻页重绘 / 新增划线）→ 把 underline 改画成波浪线
      if (epubViewRef.current && typeof MutationObserver !== "undefined") {
        marksObsRef.current?.disconnect();
        const obs = new MutationObserver(() => wavifyMarks());
        obs.observe(epubViewRef.current, { childList: true, subtree: true });
        marksObsRef.current = obs;
      }
      // 触屏设备：禁用原生选区（iOS 的文字编辑菜单无法用 CSS 关掉）→ 改用透明触摸层「点词选取」
      const touchDevice =
        typeof window !== "undefined" &&
        ((window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window);
      const selCss: Record<string, string> = touchDevice
        ? { "-webkit-user-select": "none", "user-select": "none", "-webkit-touch-callout": "none" }
        : { "-webkit-user-select": "text", "user-select": "text" };
      rendition.themes.register("paper", {
        body: { background: "#ffffff", color: "#37352f", "line-height": "1.85", ...selCss },
      });
      rendition.themes.register("night", {
        body: { background: "#15120e", color: "#ece4d6", "line-height": "1.85", ...selCss },
      });
      // 应用持久化的阅读偏好（字号 / 夜间）
      const storedSurf = localStorage.getItem("inkshelf-surface") === "night" ? "night" : "paper";
      const storedFontRaw = Number(localStorage.getItem("inkshelf-font"));
      const storedFont = storedFontRaw >= 0 && storedFontRaw < FONT_STEPS.length ? storedFontRaw : 1;
      rendition.themes.select(storedSurf);
      rendition.themes.fontSize(`${FONT_STEPS[storedFont]}%`);
      setSurface(storedSurf);
      setFontIdx(storedFont);

      // 桌面：拖选 → 浮条（触屏走组件级的透明触摸层，见 onLayerEnd/pickWordFromPoint）
      const captureSelection = (contents: EpubContents) => {
        const sel = contents.window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const text = sel.toString().trim();
        if (!text) return;
        const range = sel.getRangeAt(0);
        let cfi = "";
        try { cfi = contents.cfiFromRange(range); } catch {}
        presentRange(range, cfi, text);
      };
      rendition.hooks.content.register((contents: EpubContents) => {
        const doc = contents.document;
        doc.addEventListener("contextmenu", (ev: Event) => ev.preventDefault());
        if (!touchDevice) {
          const h = () => captureSelection(contents);
          doc.addEventListener("mouseup", h);
          doc.addEventListener("dblclick", () => setTimeout(h, 0));
          let st: ReturnType<typeof setTimeout>;
          doc.addEventListener("selectionchange", () => { clearTimeout(st); st = setTimeout(h, 350); });
        }
      });
      rendition.on("selected", (_cfi: string, contents: EpubContents) => { if (!touchDevice) captureSelection(contents); });

      rendition.on("relocated", (loc: EpubLocation) => {
        const cfi = loc.start.cfi;
        let pct = loc.start.percentage ?? 0;
        if (!pct && epubBookRef.current && epubBookRef.current.locations.length() > 0) {
          pct = epubBookRef.current.locations.percentageFromCfi(cfi);
        }
        if (pct > 0) setPercent(pct);
        setPageInfo("");
        saveProgress(cfi, pct > 0 ? pct : null); // locations 未就绪时别用 0 覆盖真实进度
        wavifyMarks();
      });

      // 从笔记本跳转：location.hash 带 cfi 时优先
      const hash = typeof window !== "undefined" ? decodeURIComponent(window.location.hash.slice(1)) : "";
      const target = hash.startsWith("epubcfi") ? hash : b.position || undefined;
      await rendition.display(target);
      // locations 用于精确百分比，后台生成
      eb.locations.generate(600).catch(() => {});

      // 重绘已有划线
      try {
        const { data: hls } = await supabase
          .from("inkshelf_highlights")
          .select("cfi")
          .eq("book_id", b.id)
          .not("cfi", "is", null);
        for (const h of (hls ?? []) as { cfi: string }[]) applyAnnotation(h.cfi);
        wavifyMarks();
      } catch {
        /* 划线重绘失败不影响阅读 */
      }

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
      if (localStorage.getItem("inkshelf-surface") === "night") setSurface("night");
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
      marksObsRef.current?.disconnect();
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

  /* 在 epub 上画划线 */
  function applyAnnotation(cfi: string) {
    try {
      // epub.js underline 标注给我们 rect+line；wavifyMarks 再把它改成波浪线
      renditionRef.current?.annotations.add("underline", cfi, {}, undefined, "ink-ul", {
        stroke: "#d9a441",
      });
    } catch {
      /* 某些 cfi 当前不在视图内，epub 会在翻到时重绘 */
    }
  }

  /* 把 epub.js 的 underline 标注（方框 rect + 直线 line）改画成波浪下划线。
     epub 每次翻页会重绘标注层，所以靠 MutationObserver 每次重贴（见 mountEpub）。 */
  function wavifyMarks() {
    const root = epubViewRef.current;
    if (!root) return;
    root.querySelectorAll<SVGGElement>("svg g.ink-ul").forEach((g) => {
      g.querySelectorAll("rect").forEach((r) => r.setAttribute("stroke", "none")); // 杀掉方框
      g.querySelectorAll<SVGLineElement>("line").forEach((line) => {
        if (line.dataset.wavy) return;
        const x1 = parseFloat(line.getAttribute("x1") || "0");
        const x2 = parseFloat(line.getAttribute("x2") || "0");
        const y = parseFloat(line.getAttribute("y2") || line.getAttribute("y1") || "0");
        if (x2 <= x1) return;
        const amp = 1.5;
        const wl = 6;
        let d = `M ${x1} ${y}`;
        let up = true;
        for (let x = x1; x < x2; x += wl) {
          const ex = Math.min(x + wl, x2);
          const mx = (x + ex) / 2;
          d += ` Q ${mx} ${up ? y - amp : y + amp} ${ex} ${y}`;
          up = !up;
        }
        const ns = "http://www.w3.org/2000/svg";
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#d9a441");
        path.setAttribute("stroke-width", "1.4");
        path.setAttribute("stroke-linecap", "round");
        g.appendChild(path);
        line.dataset.wavy = "1";
        line.setAttribute("stroke", "none"); // 隐藏原直线
      });
    });
  }

  async function saveHighlight(withNote: boolean) {
    if (book?.format !== "epub" || !selCfiRef.current || !uidRef.current) {
      setSelText("");
      return;
    }
    const quote = selText;
    const cfi = selCfiRef.current;
    let note: string | null = null;
    if (withNote) {
      const n = window.prompt(t("note_prompt"));
      if (n === null) return; // 取消
      note = n.trim() || null;
    }
    setSelText("");
    const { error } = await supabase.from("inkshelf_highlights").insert({
      owner: uidRef.current,
      book_id: id,
      cfi,
      quote,
      color: "yellow",
      note,
    });
    if (error) {
      setRToast(error.message);
    } else {
      applyAnnotation(cfi);
      setRToast(note ? t("note") : t("hl_saved"));
    }
    setTimeout(() => setRToast(null), 2000);
  }

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

  /* 从词典气泡直接存生词库（已有释义+音标，不调任何 API） */
  async function saveVocabDict() {
    const hit = dictHit;
    const term = selText.trim();
    const context = selCtxRef.current;
    setSelText("");
    if (!uidRef.current || !hit) return;
    await supabase.from("inkshelf_vocab").insert({
      owner: uidRef.current,
      book_id: id,
      term,
      translation: hit.tr || null,
      reading: hit.phonetic || null,
      context: context || null,
    });
    setRToast(t("vocab_saved"));
    setTimeout(() => setRToast(null), 2000);
  }

  function speakWordNow(word: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /* 选中单个英文词 → 查离线词典，即时弹中文释义（脱离 LLM） */
  useEffect(() => {
    const w = selText.trim();
    if (!w || /\s/.test(w) || !/[A-Za-z]/.test(w)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDictHit(null);
      return;
    }
    let alive = true;
    lookupWord(w).then((e) => {
      if (alive) setDictHit(e);
    });
    return () => {
      alive = false;
    };
  }, [selText]);

  async function pdfCurrentPageText(): Promise<string> {
    const doc = pdfDocRef.current;
    if (!doc) return "";
    const page = await doc.getPage(pdfPageRef.current);
    const tc = await page.getTextContent();
    return tc.items.map((i) => i.str ?? "").join(" ").trim();
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

  /* 进入后桌面端自动静默；窗口缩放时 epub 重排（窄栏会随宽度变化） */
  useEffect(() => {
    if (!book) return;
    if (!isTouch) scheduleHide();
    const onResize = () => {
      if (book.format === "epub") {
        const el = epubViewRef.current;
        if (el && renditionRef.current?.resize) renditionRef.current.resize(el.clientWidth, el.clientHeight);
      } else if (pdfDocRef.current) {
        renderPdfPage(pdfPageRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, isTouch, scheduleHide]);

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
          });
        }
        return;
      }
      sitSecRef.current += 1;
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
    try { localStorage.setItem("inkshelf-font", String(i)); } catch {}
  }
  function toggleSurface() {
    const next = surface === "paper" ? "night" : "paper";
    setSurface(next);
    renditionRef.current?.themes.select(next);
    try { localStorage.setItem("inkshelf-surface", next); } catch {}
  }

  const chromeHidden = chromeOff && !tocOpen && !selText;

  return (
    <div className={`reader-shell ${surface}${chromeHidden ? " chrome-off" : ""}`}>
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
          <button onClick={speakToggle} className={speaking ? "speaking" : ""}>
            {speaking ? t("stop") : t("read_aloud")}
          </button>
          <button onClick={toggleSurface}>{surface === "paper" ? t("night") : t("paper")}</button>
        </div>
      </div>

      <div className="reader-body">
      <div
        className={`reader-stage ${surface}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onMouseMove={isTouch ? undefined : revealChrome}
      >
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
        {isTouch && book?.format === "epub" && (
          <div className="touch-layer" onTouchStart={onLayerStart} onTouchEnd={onLayerEnd} aria-hidden />
        )}

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
        <div
          className={`sel-actions${dictHit ? " has-dict" : ""}`}
          role="toolbar"
          aria-label="选段操作"
          style={selPos ? { left: selPos.x, top: selPos.y, bottom: "auto", transform: "translateX(-50%)" } : undefined}
        >
          {dictHit ? (
            <div className="dict-pop">
              <div className="dict-head">
                <span className="dict-word">{dictHit.word}</span>
                {dictHit.phonetic && <span className="dict-ph">[{dictHit.phonetic}]</span>}
                <button className="dict-speak" onClick={() => speakWordNow(dictHit.word)} aria-label={t("read_aloud")} title={t("read_aloud")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.8a4.5 4.5 0 0 1 0 6.4" /></svg>
                </button>
              </div>
              <div className="dict-tr">{dictHit.tr}</div>
              <div className="dict-acts">
                <button className="sel-primary" onClick={saveVocabDict}>{t("vocab_save")}</button>
                <button onClick={() => saveHighlight(false)}>{t("hl")}</button>
                <button onClick={() => setSelText("")} aria-label="关闭">✕</button>
              </div>
            </div>
          ) : (
            <>
              <span className="sel-quote">「{selText.slice(0, 32)}{selText.length > 32 ? "…" : ""}」</span>
              <button onClick={() => saveHighlight(false)}>{t("hl")}</button>
              <button onClick={() => saveHighlight(true)}>{t("note")}</button>
              <button onClick={speakSelection}>{t("read_aloud")}</button>
              <button onClick={() => setSelText("")} aria-label="关闭">✕</button>
            </>
          )}
        </div>
      )}
      </div>

      </div>

      {rToast && <div className="toast">{rToast}</div>}

      <div className="reader-foot">
        <span>{pageInfo}</span>
        <span>
          <span className="pct">{Math.round(percent * 100)}%</span>
          {" · "}
          {saved ? t("synced") : t("saving")}
        </span>
      </div>
    </div>
  );
}
