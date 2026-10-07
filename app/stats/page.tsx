"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, type Book } from "@/lib/supabase";

type Sess = { started_at: string; seconds: number };
type Day = { key: string; date: Date; secs: number } | null;

const DOW = ["日", "一", "二", "三", "四", "五", "六"];
const HEAT = ["#ebebe9", "#cfe3f3", "#9ecbe9", "#5ba6da", "#2383e2"];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function fmt(secs: number) {
  if (secs < 60) return `${secs} 秒`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} 小时 ${rem} 分` : `${h} 小时`;
}

export default function StatsPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [books, setBooks] = useState<Book[]>([]);
  const [dayMap, setDayMap] = useState<Record<string, number>>({});
  const [sideOpen, setSideOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: bk } = await supabase
      .from("inkshelf_books")
      .select("id,title,total_seconds,status")
      .order("total_seconds", { ascending: false });
    setBooks((bk ?? []) as Book[]);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 400);
    const { data: ss } = await supabase
      .from("inkshelf_sessions")
      .select("started_at,seconds")
      .gte("started_at", cutoff.toISOString());
    const map: Record<string, number> = {};
    for (const s of (ss ?? []) as Sess[]) {
      const k = dayKey(new Date(s.started_at));
      map[k] = (map[k] ?? 0) + s.seconds;
    }
    setDayMap(map);
    setLoaded(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      load();
    });
  }, [router, load]);

  return (
    <div className="ws">
      <div className={`side-scrim ${sideOpen ? "show" : ""}`} onClick={() => setSideOpen(false)} />
      <aside className={`side ${sideOpen ? "open" : ""}`}>
        <div className="side-brand">
          <span className="glyph">墨</span>
          <span className="name">墨架</span>
        </div>
        <Link href="/" className="side-item">书架</Link>
        <button className="side-item dim" title="M1 再来">笔记本 · 待建</button>
        <button className="side-item on">阅读统计</button>
        <div className="side-foot">
          <button
            className="side-item"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          >
            退出登录
          </button>
        </div>
      </aside>

      <main className="main">
        <button className="mobile-menu" onClick={() => setSideOpen(true)}>☰ 菜单</button>
        <h1 className="page-title">阅读统计</h1>
        {!loaded ? (
          <div style={{ color: "var(--ink-3)", padding: "20px 0" }}>统计中…</div>
        ) : (
          <StatsBody books={books} dayMap={dayMap} />
        )}
      </main>
    </div>
  );
}

/* 日期相关计算只在数据加载后（客户端）运行，避免 PPR 预渲染时读取当前时间 */
function StatsBody({ books, dayMap }: { books: Book[]; dayMap: Record<string, number> }) {
  const now = new Date();
  const today0 = startOfDay(now);

  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(today0);
    d.setDate(d.getDate() - i);
    if ((dayMap[dayKey(d)] ?? 0) > 0) streak += 1;
    else break;
  }

  const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthSecs = Object.entries(dayMap)
    .filter(([k]) => k.startsWith(thisMonthPrefix))
    .reduce((a, [, v]) => a + v, 0);
  const allSecs = books.reduce((a, b) => a + (b.total_seconds ?? 0), 0);
  const daysRead = Object.values(dayMap).filter((v) => v > 0).length;

  if (allSecs === 0) {
    return (
      <div className="dropzone">
        <div className="big">还没有阅读记录</div>
        <div>去书架打开一本书读一会儿，计时会自动开始（挂机和切后台不计）。</div>
      </div>
    );
  }

  // 热力图：最近 18 周，列=周 行=周日..周六
  const WEEKS = 18;
  const total = WEEKS * 7;
  const flat: Day[] = [];
  for (let i = total - 1; i >= 0; i--) {
    const d = new Date(today0);
    d.setDate(d.getDate() - i);
    flat.push({ key: dayKey(d), date: d, secs: dayMap[dayKey(d)] ?? 0 });
  }
  const pad = flat[0]!.date.getDay();
  const padded: Day[] = [...Array<Day>(pad).fill(null), ...flat];
  const cols: Day[][] = [];
  for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));

  function heatColor(secs: number) {
    if (secs <= 0) return HEAT[0];
    if (secs < 300) return HEAT[1];
    if (secs < 900) return HEAT[2];
    if (secs < 2400) return HEAT[3];
    return HEAT[4];
  }

  const maxBook = books[0]?.total_seconds || 1;

  return (
    <>
      <div className="stat-row">
        <div className="stat-cell">
          <div className="stat-num">{streak}</div>
          <div className="stat-lab">连续天数</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num">{fmt(monthSecs)}</div>
          <div className="stat-lab">本月阅读</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num">{fmt(allSecs)}</div>
          <div className="stat-lab">累计阅读</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num">{daysRead}</div>
          <div className="stat-lab">阅读天数</div>
        </div>
      </div>

      <section className="stat-sec">
        <h2 className="stat-h2">最近 18 周</h2>
        <div className="heat-wrap">
          <div className="heat-dow">
            {DOW.map((d, i) => (
              <span key={i} style={{ visibility: i % 2 === 1 ? "visible" : "hidden" }}>{d}</span>
            ))}
          </div>
          <div className="heat-grid">
            {cols.map((col, ci) => (
              <div key={ci} className="heat-col">
                {Array.from({ length: 7 }).map((_, ri) => {
                  const cell = col[ri];
                  return (
                    <span
                      key={ri}
                      className="heat-cell"
                      style={{ background: cell ? heatColor(cell.secs) : "transparent" }}
                      title={cell ? `${cell.key}：${cell.secs > 0 ? fmt(cell.secs) : "未读"}` : ""}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="heat-legend">
          <span>少</span>
          {HEAT.map((c, i) => (
            <span key={i} className="heat-cell" style={{ background: c }} />
          ))}
          <span>多</span>
        </div>
      </section>

      <section className="stat-sec">
        <h2 className="stat-h2">每本书</h2>
        <div className="book-times">
          {books
            .filter((b) => (b.total_seconds ?? 0) > 0)
            .map((b) => (
              <Link key={b.id} href={`/read/${b.id}`} className="bt-row">
                <span className="bt-title">{b.title}</span>
                <span className="bt-bar">
                  <i style={{ width: `${Math.max(4, ((b.total_seconds ?? 0) / maxBook) * 100)}%` }} />
                </span>
                <span className="bt-num">{fmt(b.total_seconds ?? 0)}</span>
              </Link>
            ))}
        </div>
      </section>
    </>
  );
}
