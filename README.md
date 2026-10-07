# 墨架 Inkshelf

私人图书馆 Web App：导入自己的 **PDF / EPUB**，放进书架，跨设备同步阅读。
特点是「你的书、你的数据」——配上 AI 伴读、原文朗读、阅读计时与统计。类微信读书，但读的是你自己导入的书。

> A personal library web app: import your own PDF/EPUB, shelve them, read across devices — with an AI reading companion, text-to-speech, and honest reading-time tracking. Your books, your data.

## 功能

- **书架**：拖拽导入 PDF/EPUB，自动提取书名/作者/封面；画廊 + 表格双视图；点标签切状态（想读/在读/读完）
- **阅读器**：EPUB 可调字号、PDF 固定版面；目录跳转、翻页、夜间模式；进度跨设备记忆
- **AI 伴读**：选段「解释 / 翻译 / 问AI」，PDF 整页讲解，支持语音提问（Vercel AI Gateway，可接任意模型）
- **朗读**：浏览器内建 TTS，中/日/英自动选音色，逐页连续朗读
- **阅读计时**：打开书自动计时，切后台/挂机不计；统计页有热力图、连续天数、每本时长

## 技术栈

- Next.js 16 (App Router, Turbopack) + TypeScript
- Supabase — Auth + Postgres（RLS owner-only）+ Storage（私有桶）
- [epub.js](https://github.com/futurepress/epub.js) · [pdf.js](https://github.com/mozilla/pdf.js)
- Vercel AI Gateway（AI 伴读；也可改用任意 OpenAI 兼容后端）

## 自部署

### 1. Supabase
新建一个 Supabase 项目，在 SQL Editor 里整段运行 [`supabase/schema.sql`](supabase/schema.sql)（建表、私有存储桶、RLS 策略、计时函数）。

### 2. 环境变量
新建 `.env.local`，填入你的 Supabase 项目：

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-publishable-anon-key>
```

anon/publishable key 是 Supabase 设计用于浏览器的公开密钥，数据由 RLS 保护。

### 3. 本地运行
```bash
pnpm install
pnpm dev   # http://localhost:3020
```

### 4. 部署 + AI
部署到 Vercel；AI 伴读走 Vercel AI Gateway（OIDC 自动认证，需在团队设置里启用并绑卡解锁每月免费额度）。
默认模型 `anthropic/claude-opus-5`，用 `INKSHELF_AI_MODEL` 环境变量可改任意 Gateway 支持的模型。
不想用 Gateway 的话，`app/api/ai/route.ts` 很短，改成任意 OpenAI 兼容后端即可。

## 已知边界

- 扫描版 PDF（无文本层）：能读、能计时，但划线/AI/朗读依赖文本层，这类书用不了
- 正版带 DRM 的电子书导不出，进不了书架——本工具的合法书源是无 DRM 的 PDF/EPUB（论文、技术书、公版书等）
- 划线 / 笔记功能尚在路线图上（M1）

## License

[MIT](LICENSE) © Jada QIU
