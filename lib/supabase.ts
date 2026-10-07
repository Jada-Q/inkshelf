import { createClient } from "@supabase/supabase-js";

// publishable/anon key 是 Supabase 设计用于浏览器嵌入的公开密钥（数据由 RLS 保护），非 secret。
// 自部署请在 .env.local / Vercel 环境变量里填自己的 Supabase 项目。
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!url || !key) {
  throw new Error(
    "缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，请参考 README 配置环境变量"
  );
}

export const supabase = createClient(url, key);

export type Book = {
  id: string;
  owner: string;
  title: string;
  author: string | null;
  format: "epub" | "pdf";
  file_path: string;
  cover_path: string | null;
  language: string | null;
  status: "want" | "reading" | "done";
  percent: number;
  total_seconds: number;
  position: string | null;
  file_size: number | null;
  added_at: string;
  updated_at: string;
};
