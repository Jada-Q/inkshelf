# 墨架 Inkshelf

私人图书馆 Web App：导入自己的 **PDF / EPUB**，放进书架，跨设备同步阅读。
特点是「你的书、你的数据」——点词即时查中文、划线做笔记、原文朗读、阅读计时与统计。类微信读书，但读的是你自己导入的书。

> A personal library web app: import your own PDF/EPUB, shelve them, and read across devices — with instant offline word translation, highlights & notes, text-to-speech, and honest reading-time tracking. Your books, your data. No LLM/API key required.

## 功能

- **书架**：拖拽（或手机点选）导入 PDF/EPUB，自动提取书名/作者/封面；紧凑列表 + 顶部数据统计条（藏书 / 在读 / 近 7 天时长 / 生词）；点标签切状态（想读 / 在读 / 读完）
- **阅读器**：EPUB 可调字号、窄栏居中（约 60–65 字/行）、**进入即静默**（自动隐藏工具栏，只剩正文）；PDF 固定版面；目录跳转、翻页、进度跨设备记忆
- **点词翻译（离线）**：选中英文词即时弹出中文释义 + 音标，走内置离线词典，**不调任何 API / 不花钱 / 断网可用**；一键存入生词库
- **划线 / 笔记 / 生词库**：划线为波浪下划线；可加笔记；生词库带读音、释义、例句与出处，可导出 Markdown
- **朗读**：浏览器内建 TTS，中 / 日 / 英自动选音色
- **阅读计时**：打开书自动计时，切后台 / 挂机不计；统计页有热力图、连续天数、每本时长
- **多语言界面**：中 / 日 / 韩 / 英 / 法 / 西；浅色 / 深色 / 跟随系统

## 技术栈

- Next.js 16 (App Router, Turbopack) + TypeScript
- Supabase — Auth + Postgres（RLS owner-only）+ Storage（私有桶）
- [epub.js](https://github.com/futurepress/epub.js) · [pdf.js](https://github.com/mozilla/pdf.js)
- 离线英中词典：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT，见下方致谢）

## 自部署

### 1. Supabase
新建一个 Supabase 项目，在 SQL Editor 里整段运行 [`supabase/schema.sql`](supabase/schema.sql)（建表、私有存储桶、RLS 策略、计时函数）。

### 2. 环境变量
新建 `.env.local`，填入你的 Supabase 项目：

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-publishable-anon-key>
```

anon / publishable key 是 Supabase 设计用于浏览器的公开密钥，数据由 RLS 保护。
**本应用不依赖任何 LLM / AI API**，无需其他密钥。

### 3. 本地运行
```bash
pnpm install
pnpm dev   # http://localhost:3020
```

### 4. 部署
部署到 Vercel（或任意支持 Next.js 的平台）。除上面两个 Supabase 变量外无需额外配置。

## 致谢 / Credits

点词翻译使用 **[ECDICT](https://github.com/skywind3000/ECDICT)** —— 一个免费的英中词典数据库，作者 skywind3000，MIT 许可。
`public/dict/ecdict-common.json` 是从 ECDICT 筛选常用词 + 变形映射后生成的精简子集。

## 已知边界

- 扫描版 PDF（无文本层）：能读、能计时，但划线 / 点词翻译 / 朗读依赖文本层，这类书用不了
- 正版带 DRM 的电子书导不出，进不了书架——本工具的合法书源是无 DRM 的 PDF/EPUB（论文、技术书、公版书等）
- 离线词典目前只做英 → 中单词（词组 / 其他语言方向暂不覆盖）

## License

[MIT](LICENSE) © Jada QIU
