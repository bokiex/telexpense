"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, ReceiptText } from "lucide-react";

type CategorySpend = {
  category: string;
  spentCents: number;
  currency: string;
};

type Budget = {
  category: string;
  budgetCents: number;
  currency: string;
};

type DailyPoint = {
  date: string;
  spentCents: number;
};

type RecentTransaction = {
  id: number;
  kind: string;
  category: string;
  account: string;
  description: string;
  amountCents: number;
  currency: string;
  occurredOn: string;
};

type Summary = {
  month: string;
  categories: CategorySpend[];
  budgets: Budget[];
  daily: DailyPoint[];
  recent: RecentTransaction[];
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready: () => void;
        expand: () => void;
        themeParams?: Record<string, string>;
      };
    };
  }
}

const colors = ["#187b58", "#d95f3d", "#2867b2", "#a96a1d", "#6c5ce7", "#008c95"];

export default function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();
    const buttonColor = webApp?.themeParams?.button_color;
    if (buttonColor) document.documentElement.style.setProperty("--accent", buttonColor);
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setError("");
      const initData = window.Telegram?.WebApp?.initData || "";
      const response = await fetch(`/api/summary?month=${encodeURIComponent(month)}`, {
        headers: { "X-Telegram-Init-Data": initData }
      });
      if (!response.ok) {
        const body = await response.text();
        if (!ignore) setError(body || "Could not load dashboard.");
        return;
      }
      const data = (await response.json()) as Summary;
      if (!ignore) setSummary(data);
    }
    load();
    return () => {
      ignore = true;
    };
  }, [month]);

  const totals = useMemo(() => {
    const spent = summary?.categories.reduce((sum, item) => sum + item.spentCents, 0) ?? 0;
    const budget = summary?.budgets.reduce((sum, item) => sum + item.budgetCents, 0) ?? 0;
    return {
      spent,
      budget,
      budgetUsed: budget ? Math.round((spent / budget) * 100) : 0
    };
  }, [summary]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Telexpense</h1>
          <p>{summary?.month ?? month}</p>
        </div>
        <input
          className="month-input"
          type="month"
          value={month}
          aria-label="Month"
          onChange={(event) => setMonth(event.target.value || month)}
        />
      </header>

      <section className="metric-grid" aria-label="Monthly overview">
        <article className="metric">
          <span>Spent</span>
          <strong>{money(totals.spent)}</strong>
        </article>
        <article className="metric">
          <span>Budget Used</span>
          <strong>{totals.budgetUsed}%</strong>
        </article>
        <article className="metric">
          <span>Transactions</span>
          <strong>{summary?.recent.length ?? 0}</strong>
        </article>
      </section>

      {error ? <section className="panel error">{friendlyError(error)}</section> : null}

      <section className="panel">
        <div className="section-heading">
          <h2>Category Spend</h2>
          <BarChart3 size={18} aria-hidden="true" />
        </div>
        <CategoryBars items={summary?.categories ?? []} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Daily Trend</h2>
          <CalendarDays size={18} aria-hidden="true" />
        </div>
        <DailyTrend items={summary?.daily ?? []} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Budgets</h2>
          <ReceiptText size={18} aria-hidden="true" />
        </div>
        <Budgets budgets={summary?.budgets ?? []} categories={summary?.categories ?? []} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Recent</h2>
        </div>
        <RecentList items={summary?.recent ?? []} />
      </section>
    </main>
  );
}

function CategoryBars({ items }: { items: CategorySpend[] }) {
  if (!items.length) return <div className="empty">No transactions for this month.</div>;
  const max = Math.max(...items.map((item) => item.spentCents), 1);
  return (
    <div className="chart">
      {items.slice(0, 8).map((item, index) => (
        <div className="bar-row" key={item.category}>
          <strong className="bar-label">{item.category}</strong>
          <div className="bar-track" aria-hidden="true">
            <div
              className="bar-fill"
              style={{
                width: `${Math.max(4, (item.spentCents / max) * 100)}%`,
                background: colors[index % colors.length]
              }}
            />
          </div>
          <strong className="amount">{money(item.spentCents, item.currency)}</strong>
        </div>
      ))}
    </div>
  );
}

function DailyTrend({ items }: { items: DailyPoint[] }) {
  if (!items.length) return <div className="empty">No daily trend yet.</div>;
  const width = 700;
  const height = 220;
  const max = Math.max(...items.map((item) => item.spentCents), 1);
  const points = items.map((item, index) => {
    const x = items.length === 1 ? width / 2 : 24 + (index * (width - 48)) / (items.length - 1);
    const y = height - 24 - (item.spentCents * (height - 52)) / max;
    return `${x},${y}`;
  });
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily spend trend">
      <polyline points={points.join(" ")} fill="none" stroke="var(--accent-3)" strokeWidth="5" strokeLinejoin="round" />
      {items.map((item, index) => {
        const [x, y] = points[index].split(",").map(Number);
        return <circle key={item.date} cx={x} cy={y} r="5" fill="var(--accent-3)" />;
      })}
    </svg>
  );
}

function Budgets({ budgets, categories }: { budgets: Budget[]; categories: CategorySpend[] }) {
  if (!budgets.length) return <div className="empty">Send /budget food 300 in Telegram to set a budget.</div>;
  const spent = new Map(categories.map((item) => [item.category, item.spentCents]));
  return (
    <div className="row-list">
      {budgets.map((budget) => {
        const used = spent.get(budget.category) ?? 0;
        const ratio = budget.budgetCents ? used / budget.budgetCents : 0;
        return (
          <div className="data-row" key={budget.category}>
            <div className="row-title">
              <strong>{budget.category}</strong>
              <span>
                {money(used, budget.currency)} of {money(budget.budgetCents, budget.currency)}
              </span>
              <div className="progress" aria-hidden="true">
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, ratio * 100)}%`,
                    background: ratio >= 0.8 ? "var(--accent-2)" : "var(--accent)"
                  }}
                />
              </div>
            </div>
            <strong className="amount">{Math.round(ratio * 100)}%</strong>
          </div>
        );
      })}
    </div>
  );
}

function RecentList({ items }: { items: RecentTransaction[] }) {
  if (!items.length) return <div className="empty">No transactions yet.</div>;
  return (
    <div className="row-list">
      {items.map((item) => (
        <div className="data-row" key={item.id}>
          <div className="row-title">
            <strong>{item.description}</strong>
            <span>
              {item.category} · {item.account} · {item.occurredOn}
            </span>
          </div>
          <strong className="amount">{money(Math.abs(item.amountCents), item.currency)}</strong>
        </div>
      ))}
    </div>
  );
}

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function friendlyError(error: string) {
  if (error.includes("Telegram init data")) {
    return "Open this dashboard inside Telegram after configuring your Mini App.";
  }
  return error;
}

