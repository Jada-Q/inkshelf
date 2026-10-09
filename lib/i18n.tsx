"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Locale = "zh" | "ja" | "ko" | "en" | "fr" | "es";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

type Dict = Record<string, string>;

const STR: Record<Locale, Dict> = {
  zh: {
    brand: "墨架",
    tagline: "私人图书馆 · Inkshelf",
    email: "邮箱", password: "密码", login: "登录", signup: "注册",
    no_account: "没有账号？", signup_cta: "注册一个", have_account: "已有账号？", signin_cta: "去登录",
    signup_done: "注册成功——请到邮箱点确认链接，然后回来登录。", err_generic: "出错了，请重试",
    nav_shelf: "书架", nav_notes: "笔记本", nav_vocab: "生词库", nav_stats: "阅读统计",
    books_unit: "本", st_collection: "藏书", st_reading: "在读", st_week: "近7天", st_vocab: "生词",
    hl: "划线", note: "笔记", vocab_save: "生词", note_prompt: "写点笔记：", hl_saved: "已划线", vocab_saved: "已存入生词库", del: "删除", notes_empty: "这本书还没有划线和笔记", vocab_empty: "还没有收藏的生词", export_md: "导出 Markdown", translating: "翻译中…", in_book: "出自", vocab_sub: "查词存下的单词 · 读音 · 释义 · 例句", notes_sub: "划线的句子和你写的笔记",
    import: "＋ 导入书", signout: "退出登录", menu: "☰ 菜单",
    theme_system: "跟随系统", theme_light: "浅色", theme_dark: "深色",
    view_gallery: "⊞ 画廊", view_table: "☰ 表格",
    all: "全部", reading: "在读", want: "想读", done: "读完",
    drop_big: "把 PDF / EPUB 拖到这里", drop_sub: "或点侧栏「导入书」——书和进度会同步到你的每台设备",
    c_title: "书名", c_author: "作者", c_status: "状态", c_progress: "进度", c_format: "格式",
    remove: "移除", drop_toast: "松手即上架 (.epub / .pdf)", switch_status: "点击切换状态",
    t_importing: "正在上架 {name} …", t_shelved: "《{title}》已上架", t_badfmt: "{name}：只支持 .epub / .pdf",
    back: "← 书架", toc: "目录", ai_page: "问AI·本页", read_aloud: "朗读", stop: "停", ai: "AI", night: "夜", paper: "纸",
    toc_empty: "这本书没有内置目录", toc_pdf: "（PDF 无书签大纲）", pageno: "页码", jump: "跳转",
    explain: "解释", translate: "翻译", lookup: "查词", ask_ai: "问AI", ai_companion: "AI 伴读",
    ai_hint_epub: "在正文里选中一段文字，就会弹出「解释 / 翻译 / 问AI」；也可以直接在下面提问。",
    ai_hint_pdf: "点顶栏「问AI·本页」讲解当前页，或直接在下面提问。",
    ai_ph: "问这本书的任何问题…", say: "说", listening: "听…", send: "发送",
    this_time: "本次", sec: "秒", min: "分", synced: "已同步", saving: "保存中…",
    getting: "取书中…", notfound: "找不到这本书",
    book_need_net: "这本书还没下载过——先连一次网打开它，之后即可离线阅读",
    stats: "阅读统计", computing: "统计中…", streak: "连续天数", month: "本月阅读", total: "累计阅读", days: "阅读天数",
    weeks18: "最近 18 周", per_book: "每本书", less: "少", more: "多",
    no_rec_big: "还没有阅读记录", no_rec_sub: "去书架打开一本书读一会儿，计时会自动开始（挂机和切后台不计）。",
    hours: "小时", unread: "未读",
  },
  en: {
    brand: "Inkshelf", tagline: "Your private library",
    email: "Email", password: "Password", login: "Sign in", signup: "Sign up",
    no_account: "No account?", signup_cta: "Create one", have_account: "Have an account?", signin_cta: "Sign in",
    signup_done: "Account created — click the confirmation link in your email, then sign in.", err_generic: "Something went wrong, please retry",
    nav_shelf: "Shelf", nav_notes: "Notes", nav_vocab: "Wordbook", nav_stats: "Stats",
    books_unit: "books", st_collection: "Books", st_reading: "Reading", st_week: "7 days", st_vocab: "Words",
    hl: "Highlight", note: "Note", vocab_save: "Word", note_prompt: "Add a note:", hl_saved: "Highlighted", vocab_saved: "Saved to wordbook", del: "Delete", notes_empty: "No highlights or notes yet", vocab_empty: "No saved words yet", export_md: "Export Markdown", translating: "Translating…", in_book: "from", vocab_sub: "Words you looked up · reading · meaning · example", notes_sub: "Highlighted sentences and your notes",
    import: "＋ Import", signout: "Log out", menu: "☰ Menu",
    theme_system: "System", theme_light: "Light", theme_dark: "Dark",
    view_gallery: "⊞ Gallery", view_table: "☰ Table",
    all: "All", reading: "Reading", want: "To read", done: "Read",
    drop_big: "Drop a PDF / EPUB here", drop_sub: "or click “Import” — books and progress sync to all your devices",
    c_title: "Title", c_author: "Author", c_status: "Status", c_progress: "Progress", c_format: "Format",
    remove: "Remove", drop_toast: "Release to shelve (.epub / .pdf)", switch_status: "Click to change status",
    t_importing: "Importing {name} …", t_shelved: "“{title}” added", t_badfmt: "{name}: only .epub / .pdf",
    back: "← Shelf", toc: "Contents", ai_page: "Ask · page", read_aloud: "Read", stop: "Stop", ai: "AI", night: "Dark", paper: "Light",
    toc_empty: "No built-in table of contents", toc_pdf: "(PDF has no bookmarks)", pageno: "Page", jump: "Go",
    explain: "Explain", translate: "Translate", lookup: "Look up", ask_ai: "Ask AI", ai_companion: "AI companion",
    ai_hint_epub: "Select text in the book to get “Explain / Translate / Ask AI”, or just ask below.",
    ai_hint_pdf: "Tap “Ask · page” to explain the current page, or ask below.",
    ai_ph: "Ask anything about this book…", say: "Speak", listening: "…", send: "Send",
    this_time: "Session", sec: "s", min: "min", synced: "Synced", saving: "Saving…",
    getting: "Loading…", notfound: "Book not found",
    book_need_net: "This book isn't downloaded yet — open it once online, then it works offline",
    stats: "Reading stats", computing: "Loading…", streak: "Day streak", month: "This month", total: "All time", days: "Days read",
    weeks18: "Last 18 weeks", per_book: "By book", less: "Less", more: "More",
    no_rec_big: "No reading yet", no_rec_sub: "Open a book and read a while — timing starts automatically (idle and background don’t count).",
    hours: "h", unread: "none",
  },
  ja: {
    brand: "Inkshelf", tagline: "あなたの私設図書館",
    email: "メール", password: "パスワード", login: "ログイン", signup: "登録",
    no_account: "アカウントがない？", signup_cta: "作成する", have_account: "アカウントをお持ち？", signin_cta: "ログイン",
    signup_done: "登録しました — メールの確認リンクを押してからログインしてください。", err_generic: "エラーが発生しました。再試行してください",
    nav_shelf: "本棚", nav_notes: "ノート", nav_vocab: "単語帳", nav_stats: "読書統計",
    books_unit: "冊", st_collection: "蔵書", st_reading: "読書中", st_week: "7日間", st_vocab: "単語",
    hl: "ハイライト", note: "メモ", vocab_save: "単語", note_prompt: "メモを追加：", hl_saved: "ハイライトしました", vocab_saved: "単語帳に保存しました", del: "削除", notes_empty: "まだハイライトやメモがありません", vocab_empty: "まだ保存した単語がありません", export_md: "Markdown 書き出し", translating: "翻訳中…", in_book: "出典", vocab_sub: "調べた単語 · 読み · 意味 · 例文", notes_sub: "ハイライトした文とメモ",
    import: "＋ 取り込み", signout: "ログアウト", menu: "☰ メニュー",
    theme_system: "システム", theme_light: "ライト", theme_dark: "ダーク",
    view_gallery: "⊞ ギャラリー", view_table: "☰ テーブル",
    all: "すべて", reading: "読書中", want: "読みたい", done: "読了",
    drop_big: "PDF / EPUB をここにドロップ", drop_sub: "または「取り込み」をクリック — 本と進捗が全デバイスで同期されます",
    c_title: "書名", c_author: "著者", c_status: "状態", c_progress: "進捗", c_format: "形式",
    remove: "削除", drop_toast: "離すと本棚へ (.epub / .pdf)", switch_status: "クリックで状態を変更",
    t_importing: "{name} を取り込み中 …", t_shelved: "『{title}』を追加しました", t_badfmt: "{name}：.epub / .pdf のみ対応",
    back: "← 本棚", toc: "目次", ai_page: "AIにページ", read_aloud: "読み上げ", stop: "停止", ai: "AI", night: "夜", paper: "紙",
    toc_empty: "この本には目次がありません", toc_pdf: "（PDFにしおりなし）", pageno: "ページ", jump: "移動",
    explain: "解説", translate: "翻訳", lookup: "調べる", ask_ai: "AIに質問", ai_companion: "AI読書アシスタント",
    ai_hint_epub: "本文を選択すると「解説 / 翻訳 / AIに質問」が出ます。下から直接質問も可能です。",
    ai_hint_pdf: "上部の「AIにページ」で現在のページを解説、または下から質問できます。",
    ai_ph: "この本について何でも質問…", say: "話す", listening: "…", send: "送信",
    this_time: "今回", sec: "秒", min: "分", synced: "同期済み", saving: "保存中…",
    getting: "読み込み中…", notfound: "本が見つかりません",
    book_need_net: "この本はまだダウンロードされていません。一度オンラインで開くと、以後オフラインで読めます",
    stats: "読書統計", computing: "集計中…", streak: "連続日数", month: "今月", total: "累計", days: "読書日数",
    weeks18: "直近18週", per_book: "本ごと", less: "少", more: "多",
    no_rec_big: "まだ記録がありません", no_rec_sub: "本を開いて少し読むと、計測が自動で始まります（放置・バックグラウンドは除外）。",
    hours: "時間", unread: "未読",
  },
  ko: {
    brand: "Inkshelf", tagline: "나만의 서재",
    email: "이메일", password: "비밀번호", login: "로그인", signup: "가입",
    no_account: "계정이 없나요?", signup_cta: "만들기", have_account: "계정이 있나요?", signin_cta: "로그인",
    signup_done: "가입 완료 — 이메일의 확인 링크를 누른 뒤 로그인하세요.", err_generic: "오류가 발생했습니다. 다시 시도하세요",
    nav_shelf: "서재", nav_notes: "노트", nav_vocab: "단어장", nav_stats: "독서 통계",
    books_unit: "권", st_collection: "장서", st_reading: "읽는 중", st_week: "7일", st_vocab: "단어",
    hl: "형광펜", note: "메모", vocab_save: "단어", note_prompt: "메모 추가:", hl_saved: "표시함", vocab_saved: "단어장에 저장됨", del: "삭제", notes_empty: "아직 형광펜·메모가 없습니다", vocab_empty: "저장한 단어가 없습니다", export_md: "Markdown 내보내기", translating: "번역 중…", in_book: "출처", vocab_sub: "찾아본 단어 · 발음 · 뜻 · 예문", notes_sub: "형광펜 문장과 메모",
    import: "＋ 가져오기", signout: "로그아웃", menu: "☰ 메뉴",
    theme_system: "시스템", theme_light: "라이트", theme_dark: "다크",
    view_gallery: "⊞ 갤러리", view_table: "☰ 표",
    all: "전체", reading: "읽는 중", want: "읽을 책", done: "완독",
    drop_big: "PDF / EPUB 를 여기에 놓으세요", drop_sub: "또는 「가져오기」 클릭 — 책과 진행률이 모든 기기에 동기화됩니다",
    c_title: "제목", c_author: "저자", c_status: "상태", c_progress: "진행", c_format: "형식",
    remove: "삭제", drop_toast: "놓으면 서재에 추가 (.epub / .pdf)", switch_status: "클릭하여 상태 변경",
    t_importing: "{name} 가져오는 중 …", t_shelved: "『{title}』 추가됨", t_badfmt: "{name}: .epub / .pdf 만 지원",
    back: "← 서재", toc: "목차", ai_page: "AI·페이지", read_aloud: "읽어주기", stop: "정지", ai: "AI", night: "밤", paper: "낮",
    toc_empty: "이 책에는 목차가 없습니다", toc_pdf: "(PDF 북마크 없음)", pageno: "페이지", jump: "이동",
    explain: "설명", translate: "번역", lookup: "찾기", ask_ai: "AI 질문", ai_companion: "AI 독서 도우미",
    ai_hint_epub: "본문을 선택하면 「설명 / 번역 / AI 질문」이 나타납니다. 아래에서 직접 질문도 가능합니다.",
    ai_hint_pdf: "상단의 「AI·페이지」로 현재 페이지를 설명하거나, 아래에서 질문하세요.",
    ai_ph: "이 책에 대해 무엇이든 질문…", say: "말하기", listening: "…", send: "보내기",
    this_time: "이번", sec: "초", min: "분", synced: "동기화됨", saving: "저장 중…",
    getting: "불러오는 중…", notfound: "책을 찾을 수 없습니다",
    book_need_net: "이 책은 아직 다운로드되지 않았습니다. 온라인에서 한 번 열면 이후 오프라인에서 읽을 수 있습니다",
    stats: "독서 통계", computing: "집계 중…", streak: "연속 일수", month: "이번 달", total: "누적", days: "읽은 날",
    weeks18: "최근 18주", per_book: "책별", less: "적음", more: "많음",
    no_rec_big: "아직 기록이 없습니다", no_rec_sub: "책을 열고 잠시 읽으면 자동으로 측정됩니다 (방치·백그라운드 제외).",
    hours: "시간", unread: "안 읽음",
  },
  fr: {
    brand: "Inkshelf", tagline: "Votre bibliothèque privée",
    email: "E-mail", password: "Mot de passe", login: "Se connecter", signup: "S’inscrire",
    no_account: "Pas de compte ?", signup_cta: "En créer un", have_account: "Déjà un compte ?", signin_cta: "Se connecter",
    signup_done: "Compte créé — cliquez le lien de confirmation dans votre e-mail, puis connectez-vous.", err_generic: "Une erreur est survenue, réessayez",
    nav_shelf: "Étagère", nav_notes: "Notes", nav_vocab: "Lexique", nav_stats: "Statistiques",
    books_unit: "livres", st_collection: "Livres", st_reading: "En cours", st_week: "7 jours", st_vocab: "Mots",
    hl: "Surligner", note: "Note", vocab_save: "Mot", note_prompt: "Ajouter une note :", hl_saved: "Surligné", vocab_saved: "Ajouté au lexique", del: "Supprimer", notes_empty: "Aucun surlignage ni note", vocab_empty: "Aucun mot enregistré", export_md: "Exporter en Markdown", translating: "Traduction…", in_book: "de", vocab_sub: "Mots cherchés · prononciation · sens · exemple", notes_sub: "Phrases surlignées et vos notes",
    import: "＋ Importer", signout: "Déconnexion", menu: "☰ Menu",
    theme_system: "Système", theme_light: "Clair", theme_dark: "Sombre",
    view_gallery: "⊞ Galerie", view_table: "☰ Tableau",
    all: "Tout", reading: "En cours", want: "À lire", done: "Lu",
    drop_big: "Déposez un PDF / EPUB ici", drop_sub: "ou cliquez « Importer » — livres et progression synchronisés sur tous vos appareils",
    c_title: "Titre", c_author: "Auteur", c_status: "Statut", c_progress: "Progression", c_format: "Format",
    remove: "Retirer", drop_toast: "Relâchez pour ajouter (.epub / .pdf)", switch_status: "Cliquez pour changer le statut",
    t_importing: "Import de {name} …", t_shelved: "« {title} » ajouté", t_badfmt: "{name} : seulement .epub / .pdf",
    back: "← Étagère", toc: "Sommaire", ai_page: "IA · page", read_aloud: "Lecture", stop: "Stop", ai: "IA", night: "Nuit", paper: "Jour",
    toc_empty: "Pas de sommaire intégré", toc_pdf: "(PDF sans signets)", pageno: "Page", jump: "Aller",
    explain: "Expliquer", translate: "Traduire", lookup: "Chercher", ask_ai: "Demander", ai_companion: "Compagnon IA",
    ai_hint_epub: "Sélectionnez du texte pour « Expliquer / Traduire / Demander », ou posez une question ci-dessous.",
    ai_hint_pdf: "Touchez « IA · page » pour expliquer la page, ou posez une question ci-dessous.",
    ai_ph: "Posez une question sur ce livre…", say: "Parler", listening: "…", send: "Envoyer",
    this_time: "Session", sec: "s", min: "min", synced: "Synchronisé", saving: "Enregistrement…",
    getting: "Chargement…", notfound: "Livre introuvable",
    book_need_net: "Ce livre n'est pas encore téléchargé — ouvrez-le une fois en ligne, puis il fonctionne hors ligne",
    stats: "Statistiques", computing: "Chargement…", streak: "Jours d’affilée", month: "Ce mois", total: "Total", days: "Jours lus",
    weeks18: "18 dernières semaines", per_book: "Par livre", less: "Moins", more: "Plus",
    no_rec_big: "Aucune lecture", no_rec_sub: "Ouvrez un livre et lisez un moment — le minuteur démarre tout seul (inactivité et arrière-plan non comptés).",
    hours: "h", unread: "non lu",
  },
  es: {
    brand: "Inkshelf", tagline: "Tu biblioteca privada",
    email: "Correo", password: "Contraseña", login: "Entrar", signup: "Registrarse",
    no_account: "¿Sin cuenta?", signup_cta: "Crear una", have_account: "¿Ya tienes cuenta?", signin_cta: "Entrar",
    signup_done: "Cuenta creada — pulsa el enlace de confirmación en tu correo y luego inicia sesión.", err_generic: "Algo salió mal, inténtalo de nuevo",
    nav_shelf: "Estantería", nav_notes: "Notas", nav_vocab: "Vocabulario", nav_stats: "Estadísticas",
    books_unit: "libros", st_collection: "Libros", st_reading: "Leyendo", st_week: "7 días", st_vocab: "Palabras",
    hl: "Resaltar", note: "Nota", vocab_save: "Palabra", note_prompt: "Añadir una nota:", hl_saved: "Resaltado", vocab_saved: "Guardado en vocabulario", del: "Eliminar", notes_empty: "Aún no hay resaltados ni notas", vocab_empty: "Aún no hay palabras guardadas", export_md: "Exportar Markdown", translating: "Traduciendo…", in_book: "de", vocab_sub: "Palabras buscadas · pronunciación · significado · ejemplo", notes_sub: "Frases resaltadas y tus notas",
    import: "＋ Importar", signout: "Cerrar sesión", menu: "☰ Menú",
    theme_system: "Sistema", theme_light: "Claro", theme_dark: "Oscuro",
    view_gallery: "⊞ Galería", view_table: "☰ Tabla",
    all: "Todo", reading: "Leyendo", want: "Por leer", done: "Leído",
    drop_big: "Suelta un PDF / EPUB aquí", drop_sub: "o pulsa «Importar» — libros y progreso se sincronizan en todos tus dispositivos",
    c_title: "Título", c_author: "Autor", c_status: "Estado", c_progress: "Progreso", c_format: "Formato",
    remove: "Quitar", drop_toast: "Suelta para añadir (.epub / .pdf)", switch_status: "Clic para cambiar el estado",
    t_importing: "Importando {name} …", t_shelved: "«{title}» añadido", t_badfmt: "{name}: solo .epub / .pdf",
    back: "← Estantería", toc: "Índice", ai_page: "IA · página", read_aloud: "Leer", stop: "Parar", ai: "IA", night: "Noche", paper: "Día",
    toc_empty: "Sin índice integrado", toc_pdf: "(PDF sin marcadores)", pageno: "Página", jump: "Ir",
    explain: "Explicar", translate: "Traducir", lookup: "Buscar", ask_ai: "Preguntar", ai_companion: "Compañero IA",
    ai_hint_epub: "Selecciona texto para «Explicar / Traducir / Preguntar», o pregunta abajo.",
    ai_hint_pdf: "Toca «IA · página» para explicar la página, o pregunta abajo.",
    ai_ph: "Pregunta lo que sea sobre este libro…", say: "Hablar", listening: "…", send: "Enviar",
    this_time: "Sesión", sec: "s", min: "min", synced: "Sincronizado", saving: "Guardando…",
    getting: "Cargando…", notfound: "Libro no encontrado",
    book_need_net: "Este libro aún no se ha descargado: ábrelo una vez con conexión y luego funcionará sin conexión",
    stats: "Estadísticas", computing: "Cargando…", streak: "Días seguidos", month: "Este mes", total: "Total", days: "Días leídos",
    weeks18: "Últimas 18 semanas", per_book: "Por libro", less: "Menos", more: "Más",
    no_rec_big: "Sin lecturas aún", no_rec_sub: "Abre un libro y lee un rato — el cronómetro empieza solo (inactividad y segundo plano no cuentan).",
    hours: "h", unread: "sin leer",
  },
};

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: (k: string, p?: Record<string, string>) => string };
const LocaleCtx = createContext<Ctx>({ locale: "zh", setLocale: () => {}, t: (k) => k });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLoc] = useState<Locale>("zh");

  useEffect(() => {
    // 从 localStorage / 浏览器语言初始化（外部存储同步，一次性）
    const saved = localStorage.getItem("inkshelf-locale") as Locale | null;
    if (saved && STR[saved]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoc(saved);
      return;
    }
    const nav = navigator.language.slice(0, 2).toLowerCase();
    const match = (LOCALES.find((l) => l.code === nav)?.code) as Locale | undefined;
    if (match) setLoc(match);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLoc(l);
    try { localStorage.setItem("inkshelf-locale", l); } catch {}
  }, []);

  const t = useCallback(
    (k: string, p?: Record<string, string>) => {
      let s = STR[locale][k] ?? STR.en[k] ?? k;
      if (p) for (const key in p) s = s.replace(`{${key}}`, p[key]);
      return s;
    },
    [locale]
  );

  return <LocaleCtx.Provider value={{ locale, setLocale, t }}>{children}</LocaleCtx.Provider>;
}

export function useI18n() {
  return useContext(LocaleCtx);
}

export function LangSwitch({ compact }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  return (
    <select
      className={`lang-switch ${compact ? "compact" : ""}`}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
