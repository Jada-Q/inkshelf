"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
        } else {
          setMsg("注册成功——请到邮箱点确认链接，然后回来登录。");
        }
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "出错了，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="mono-label blush">INKSHELF · PRIVATE LIBRARY</div>
        <h1>墨架</h1>
        <form onSubmit={submit}>
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
          />
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "…" : mode === "signin" ? "登录" : "注册"}
          </button>
          <div className="auth-msg">{msg}</div>
        </form>
        <div className="auth-alt">
          {mode === "signin" ? (
            <>
              没有账号？
              <button type="button" onClick={() => setMode("signup")}>注册一个</button>
            </>
          ) : (
            <>
              已有账号？
              <button type="button" onClick={() => setMode("signin")}>去登录</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
