"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

type Mode = "system" | "light" | "dark";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };

function applyMode(m: Mode) {
  const el = document.documentElement;
  if (m === "system") delete el.dataset.theme;
  else el.dataset.theme = m;
  try {
    if (m === "system") localStorage.removeItem("inkshelf-theme");
    else localStorage.setItem("inkshelf-theme", m);
  } catch {
    /* localStorage 不可用时仅内存生效 */
  }
}

/** 主题切换：跟随系统 → 浅色 → 深色 循环，持久化到 localStorage，
 *  实际生效由 documentElement 的 data-theme 控制（防闪脚本在 layout 里早于绘制设置）。 */
export function ThemeToggle() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const s = localStorage.getItem("inkshelf-theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s === "light" || s === "dark") setMode(s);
  }, []);

  const icon = mode === "dark" ? "☾" : mode === "light" ? "☀" : "◐";
  const label = mode === "dark" ? t("theme_dark") : mode === "light" ? t("theme_light") : t("theme_system");

  return (
    <button
      className="side-item"
      onClick={() => {
        const n = NEXT[mode];
        setMode(n);
        applyMode(n);
      }}
      aria-label={label}
      title={label}
    >
      <span aria-hidden style={{ marginRight: 8 }}>{icon}</span>
      {label}
    </button>
  );
}
