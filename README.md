# 墨架 Inkshelf

私人图书馆：导入自己的 PDF / EPUB，放进书架，跨设备同步阅读进度。M0 = 能读。

规划案（含 M1 划线笔记 / M2 AI 伴读·朗读的完整设计）：
https://claude.ai/code/artifact/96ed1c18-af22-4856-9081-bc962e10d000

## 技术栈

- Next.js 16 (App Router, Turbopack) + TypeScript
- Supabase（寄生 learnlog 项目）：Auth + Postgres（`inkshelf_books`，RLS owner-only）+ Storage（`inkshelf-books` 私有桶，路径 `{uid}/{bookId}.{ext}`）
- epub.js（EPUB 渲染/分页/CFI 进度）· pdfjs-dist（PDF 渲染，worker 在 `public/pdf.worker.min.mjs`）

## 本地运行

```bash
pnpm install
pnpm dev   # 固定端口 3020
```

Supabase URL 与 publishable key（客户端公开值，非 secret）默认内置于 `lib/supabase.ts`，可用环境变量 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 覆盖。

## 已知边界（M0）

- 扫描版 PDF（无文本层）：能读能记进度，M1 的划线与 AI 不可用（导入时不检测，读到才知道）
- 大文件上传受 Supabase 免费档限制，百 MB 级扫描书需实测
- 美术方向：B「夜架 Editorial」（深底 + blush #e47ba8 + mono 小标；阅读面默认纸色，可切夜色）

## 设计约定

- 书架 = 深色画廊；进入正文后设计退场（纸面安静）
- 阅读进度：EPUB 存 CFI，PDF 存页码，debounce 1.2s 写库，页脚「已同步」为真实写库回执
