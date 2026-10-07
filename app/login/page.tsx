"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useI18n, LangSwitch } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
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
        if (data.session) router.replace("/");
        else setMsg(t("signup_done"));
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("err_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="mono-label">{t("tagline")}</div>
          <LangSwitch compact />
        </div>
        <h1 className="brush">{t("brand")}</h1>
        <form onSubmit={submit}>
          <input
            type="email"
            placeholder={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
          />
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "…" : mode === "signin" ? t("login") : t("signup")}
          </button>
          <div className="auth-msg">{msg}</div>
        </form>
        <div className="auth-alt">
          {mode === "signin" ? (
            <>
              {t("no_account")}
              <button type="button" onClick={() => setMode("signup")}>{t("signup_cta")}</button>
            </>
          ) : (
            <>
              {t("have_account")}
              <button type="button" onClick={() => setMode("signin")}>{t("signin_cta")}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
