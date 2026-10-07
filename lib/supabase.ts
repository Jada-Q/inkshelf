import { createClient } from "@supabase/supabase-js";

// publishable key = 客户端公开密钥（Supabase 设计上即用于浏览器嵌入），非 secret；
// env 可覆盖，未设置时用默认值（寄生 learnlog 项目）
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "https://dhzozfjzhsniyewblwpv.supabase.co";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "sb_publishable_f_pIVqMK-6ToF3-eYe5n5A_-yb_vpZR";

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
  position: string | null;
  file_size: number | null;
  added_at: string;
  updated_at: string;
};
