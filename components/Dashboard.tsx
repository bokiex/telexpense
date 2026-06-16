"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { BarChart3, CalendarDays, Pencil, Plus, ReceiptText, Save, Trash2, X } from "lucide-react";

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
  kind: "expense" | "income" | "investment" | "transfer";
  category: string;
  account: string;
  description: string;
  amountCents: number;
  currency: string;
  occurredOn: string;
};

type BudgetHealth = {
  spentCents: number;
  budgetCents: number;
  remainingCents: number;
  budgetUsed: number;
  daysLeft: number;
  dailySafeCents: number;
  projectedSpendCents: number;
};

type Summary = {
  month: string;
  categories: CategorySpend[];
  budgets: Budget[];
  health: BudgetHealth;
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
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [month, refreshKey]);

  const totals = useMemo(() => {
    const spent = summary?.health.spentCents ?? 0;
    const budget = summary?.health.budgetCents ?? 0;
    return {
      spent,
      budget,
      budgetUsed: summary?.health.budgetUsed ?? 0
    };
  }, [summary]);

  const reload = () => setRefreshKey((value) => value + 1);
  const onActionError = (message: string) => setError(message);

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
          <span>Left</span>
          <strong>{money(summary?.health.remainingCents ?? totals.budget - totals.spent)}</strong>
        </article>
        <article className="metric">
          <span>Safe / Day</span>
          <strong>{money(summary?.health.dailySafeCents ?? 0)}</strong>
        </article>
        <article className="metric">
          <span>Projected</span>
          <strong>{money(summary?.health.projectedSpendCents ?? totals.spent)}</strong>
        </article>
      </section>

      <HealthSummary health={summary?.health} transactionCount={summary?.recent.length ?? 0} />

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
        <BudgetEditor
          month={month}
          budgets={summary?.budgets ?? []}
          categories={summary?.categories ?? []}
          onChanged={reload}
          onError={onActionError}
        />
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Recent</h2>
        </div>
        <RecentList items={summary?.recent ?? []} onChanged={reload} onError={onActionError} />
      </section>
    </main>
  );
}

function HealthSummary({ health, transactionCount }: { health?: BudgetHealth; transactionCount: number }) {
  if (!health?.budgetCents) return null;
  const projectedDelta = health.projectedSpendCents - health.budgetCents;
  return (
    <section className="health-strip" aria-label="Budget health">
      <strong>{health.budgetUsed}% used</strong>
      <span>{health.daysLeft} days left</span>
      <span>
        {projectedDelta > 0 ? `${money(projectedDelta)} over projected` : `${money(Math.abs(projectedDelta))} under projected`}
      </span>
      <span>{transactionCount} recent transactions</span>
    </section>
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

function BudgetEditor({
  month,
  budgets,
  categories,
  onChanged,
  onError
}: {
  month: string;
  budgets: Budget[];
  categories: CategorySpend[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const spent = new Map(categories.map((item) => [item.category, item.spentCents]));
  return (
    <div className="row-list budget-editor">
      <NewBudgetForm month={month} onChanged={onChanged} onError={onError} />
      {!budgets.length ? <div className="empty compact">No budgets set for this month.</div> : null}
      {budgets.map((budget) => {
        const used = spent.get(budget.category) ?? 0;
        const ratio = budget.budgetCents ? used / budget.budgetCents : 0;
        return <BudgetRow key={budget.category} budget={budget} used={used} ratio={ratio} month={month} onChanged={onChanged} onError={onError} />;
      })}
    </div>
  );
}

function NewBudgetForm({
  month,
  onChanged,
  onError
}: {
  month: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!category.trim() || !Number.isFinite(cents) || cents < 0) return;
    const ok = await apiRequest("/api/budgets", "POST", { category, month, amountCents: cents });
    if (!ok) {
      onError("Could not save budget.");
      return;
    }
    setCategory("");
    setAmount("");
    onChanged();
  }

  return (
    <form className="inline-form budget-form" onSubmit={submit}>
      <input value={category} placeholder="Category" aria-label="Budget category" onChange={(event) => setCategory(event.target.value)} />
      <input value={amount} placeholder="Amount" aria-label="Budget amount" inputMode="decimal" onChange={(event) => setAmount(event.target.value)} />
      <button className="icon-button primary" type="submit" aria-label="Add budget" title="Add budget">
        <Plus size={17} aria-hidden="true" />
      </button>
    </form>
  );
}

function BudgetRow({
  budget,
  used,
  ratio,
  month,
  onChanged,
  onError
}: {
  budget: Budget;
  used: number;
  ratio: number;
  month: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState(String(budget.budgetCents / 100));

  async function save() {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    const ok = await apiRequest("/api/budgets", "POST", {
      category: budget.category,
      month,
      amountCents: cents,
      currency: budget.currency
    });
    if (!ok) {
      onError("Could not update budget.");
      return;
    }
    onChanged();
  }

  async function remove() {
    const ok = await apiRequest(`/api/budgets?category=${encodeURIComponent(budget.category)}&month=${encodeURIComponent(month)}`, "DELETE");
    if (!ok) {
      onError("Could not delete budget.");
      return;
    }
    onChanged();
  }

  return (
    <div className="data-row editable-row">
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
      <div className="row-actions">
        <input className="amount-input" value={amount} aria-label={`${budget.category} budget`} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} />
        <button className="icon-button" type="button" aria-label="Save budget" title="Save budget" onClick={save}>
          <Save size={16} aria-hidden="true" />
        </button>
        <button className="icon-button danger" type="button" aria-label="Delete budget" title="Delete budget" onClick={remove}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RecentList({
  items,
  onChanged,
  onError
}: {
  items: RecentTransaction[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  if (!items.length) return <div className="empty">No transactions yet.</div>;
  return (
    <div className="row-list">
      {items.map((item) => <RecentRow key={item.id} item={item} onChanged={onChanged} onError={onError} />)}
    </div>
  );
}

function RecentRow({
  item,
  onChanged,
  onError
}: {
  item: RecentTransaction;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    kind: item.kind,
    category: item.category,
    account: item.account,
    description: item.description,
    amount: String(Math.abs(item.amountCents) / 100),
    occurredOn: item.occurredOn
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    const rawCents = Math.round(Number(form.amount) * 100);
    if (!Number.isFinite(rawCents)) return;
    const amountCents = signedAmount(form.kind, rawCents, item.amountCents);
    const ok = await apiRequest(`/api/transactions/${item.id}`, "PATCH", {
      kind: form.kind,
      category: form.category,
      account: form.account,
      description: form.description,
      amountCents,
      currency: item.currency,
      occurredOn: form.occurredOn
    });
    if (!ok) {
      onError("Could not update transaction.");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function remove() {
    const ok = await apiRequest(`/api/transactions/${item.id}`, "DELETE");
    if (!ok) {
      onError("Could not delete transaction.");
      return;
    }
    onChanged();
  }

  if (editing) {
    return (
      <form className="edit-transaction" onSubmit={save}>
        <select value={form.kind} aria-label="Kind" onChange={(event) => setForm({ ...form, kind: event.target.value as RecentTransaction["kind"] })}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="investment">Investment</option>
          <option value="transfer">Transfer</option>
        </select>
        <input value={form.category} aria-label="Category" onChange={(event) => setForm({ ...form, category: event.target.value })} />
        <input value={form.account} aria-label="Account" onChange={(event) => setForm({ ...form, account: event.target.value })} />
        <input value={form.description} aria-label="Description" onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <input value={form.amount} aria-label="Amount" inputMode="decimal" onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        <input type="date" value={form.occurredOn} aria-label="Date" onChange={(event) => setForm({ ...form, occurredOn: event.target.value })} />
        <div className="row-actions span-actions">
          <button className="icon-button primary" type="submit" aria-label="Save transaction" title="Save transaction">
            <Save size={16} aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" aria-label="Cancel edit" title="Cancel edit" onClick={() => setEditing(false)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="data-row editable-row">
      <div className="row-title">
        <strong>{item.description}</strong>
        <span>
          {item.kind} · {item.category} · {item.account} · {item.occurredOn}
        </span>
      </div>
      <div className="row-actions">
        <strong className="amount">{money(Math.abs(item.amountCents), item.currency)}</strong>
        <button className="icon-button" type="button" aria-label="Edit transaction" title="Edit transaction" onClick={() => setEditing(true)}>
          <Pencil size={16} aria-hidden="true" />
        </button>
        <button className="icon-button danger" type="button" aria-label="Delete transaction" title="Delete transaction" onClick={remove}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

async function apiRequest(path: string, method: string, body?: unknown) {
  const initData = window.Telegram?.WebApp?.initData || "";
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return response.ok;
}

function signedAmount(kind: RecentTransaction["kind"], rawCents: number, existingAmountCents: number) {
  if (kind === "income") return Math.abs(rawCents);
  if (kind === "expense" || kind === "investment") return -Math.abs(rawCents);
  return existingAmountCents < 0 ? -Math.abs(rawCents) : Math.abs(rawCents);
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
