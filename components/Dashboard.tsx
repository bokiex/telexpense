"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Briefcase,
  Car,
  ChevronDown,
  ChevronRight,
  Coffee,
  Eye,
  EyeOff,
  Filter,
  Heart,
  Home,
  LayoutDashboard,
  List,
  Music,
  Pencil,
  PieChart,
  Plane,
  Plus,
  Search,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Tv,
  Utensils,
  Wallet,
  X
} from "lucide-react";

type BudgetGroup = "Needs" | "Wants" | "Savings";
type TransactionType = "income" | "expense";
type AccountType = "cash" | "bank" | "card" | "investment" | "other";
type Tab = "home" | "transactions" | "accounts" | "budget" | "categories";

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

type RecentTransaction = {
  id: number;
  kind: "expense" | "income" | "investment" | "transfer";
  category: string;
  accountId: number | null;
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
  daily: { date: string; spentCents: number }[];
  storedCategories: StoredCategory[];
  accounts: Account[];
  recent: RecentTransaction[];
};

type StoredCategory = {
  id: number;
  sourceKey: string;
  sourceName: string;
  name: string;
  group: BudgetGroup;
  color: string;
  icon: string;
  subcategories: { id: number; name: string }[];
};

type SubCategory = {
  id: string;
  name: string;
  categoryId: string;
  budget?: number;
};

type Category = {
  id: string;
  name: string;
  sourceName: string;
  group: BudgetGroup;
  color: string;
  icon: string;
  budget?: number;
  currency: string;
  subcategories: SubCategory[];
};

type Transaction = {
  id: string;
  sourceId: number;
  amount: number;
  currency: string;
  type: TransactionType;
  kind: RecentTransaction["kind"];
  categoryId: string;
  subcategoryId?: string;
  accountId?: number | null;
  description: string;
  date: string;
};

type AppData = {
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
};

type Account = {
  id: number | null;
  accountKey: string;
  name: string;
  institution: string | null;
  accountType: AccountType;
  openingBalanceCents: number;
  balanceCents: number;
  currency: string;
  color: string;
  icon: string;
  active: boolean;
};

type ModalState =
  | { type: "none" }
  | { type: "add-transaction" }
  | { type: "edit-transaction"; tx: Transaction }
  | { type: "add-account" }
  | { type: "edit-account"; account: Account }
  | { type: "edit-category"; categoryId: string }
  | { type: "add-subcategory"; categoryId: string }
  | { type: "set-budget"; categoryId: string; subcategoryId?: string };

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

const GROUPS: BudgetGroup[] = ["Needs", "Wants", "Savings"];
const GROUP_COLORS: Record<BudgetGroup, string> = {
  Needs: "#60a5fa",
  Wants: "#f472b6",
  Savings: "#4ade80"
};

const CATEGORY_LOOK: Record<string, { group: BudgetGroup; color: string; icon: string }> = {
  food: { group: "Needs", color: "#fb923c", icon: "ShoppingCart" },
  grocery: { group: "Needs", color: "#fb923c", icon: "ShoppingCart" },
  groceries: { group: "Needs", color: "#fb923c", icon: "ShoppingCart" },
  housing: { group: "Needs", color: "#60a5fa", icon: "Home" },
  rent: { group: "Needs", color: "#60a5fa", icon: "Home" },
  transport: { group: "Needs", color: "#a78bfa", icon: "Car" },
  transportation: { group: "Needs", color: "#a78bfa", icon: "Car" },
  entertainment: { group: "Wants", color: "#f472b6", icon: "Tv" },
  shopping: { group: "Wants", color: "#34d399", icon: "ShoppingBag" },
  investment: { group: "Savings", color: "#4ade80", icon: "TrendingUp" },
  investments: { group: "Savings", color: "#4ade80", icon: "TrendingUp" },
  salary: { group: "Savings", color: "#4ade80", icon: "Briefcase" },
  income: { group: "Savings", color: "#4ade80", icon: "Briefcase" },
  freelance: { group: "Savings", color: "#38bdf8", icon: "Briefcase" }
};

const FALLBACK_COLORS = ["#60a5fa", "#fb923c", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#38bdf8"];
const CATEGORY_COLORS = ["#4ade80", "#f87171", "#60a5fa", "#fb923c", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#e879f9", "#38bdf8"];
const CATEGORY_ICONS = ["Wallet", "Home", "ShoppingCart", "Car", "Tv", "ShoppingBag", "Shield", "TrendingUp", "Briefcase", "Utensils", "Coffee", "Heart", "BookOpen", "Music", "Plane"];
const ACCOUNT_TYPES: AccountType[] = ["cash", "bank", "card", "investment", "other"];

export default function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setError("");
      const response = await apiRequest(`/api/summary?month=${encodeURIComponent(month)}`, "GET");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (!ignore) setError(body?.error || "Could not load dashboard.");
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

  const data = useMemo(() => buildAppData(summary), [summary]);
  const reload = () => setRefreshKey((value) => value + 1);

  async function saveTransaction(tx: Omit<Transaction, "id" | "sourceId" | "kind" | "currency"> & { id?: string; sourceId?: number; currency?: string }) {
    const amountCents = signedCents(tx.type, tx.amount);
    const selectedCategory = data.categories.find((item) => item.id === tx.categoryId);
    const category = selectedCategory?.sourceName || selectedCategory?.name || tx.categoryId;
    const selectedAccount = data.accounts.find((item) => item.id === tx.accountId);
    const body = {
      kind: tx.type,
      category,
      accountId: selectedAccount?.id,
      description: tx.description,
      amountCents,
      currency: tx.currency || summary?.recent[0]?.currency || "USD",
      occurredOn: tx.date
    };
    const path = tx.sourceId ? `/api/transactions/${tx.sourceId}` : "/api/transactions";
    const response = await apiRequest(path, tx.sourceId ? "PATCH" : "POST", body);
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save transaction.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function deleteTransaction(tx: Transaction) {
    const response = await apiRequest(`/api/transactions/${tx.sourceId}`, "DELETE");
    if (!response.ok) {
      setError("Could not delete transaction.");
      return;
    }
    reload();
  }

  async function saveBudget(categoryId: string, amount: number) {
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const response = await apiRequest("/api/budgets", "POST", {
      category: category.sourceName,
      month,
      amountCents: amount,
      currency: category.currency
    });
    if (!response.ok) {
      setError("Could not save budget.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function saveCategory(categoryId: string, values: { name: string; group: BudgetGroup; color: string; icon: string }) {
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const response = await apiRequest("/api/categories", "POST", {
      sourceKey: category.id,
      sourceName: category.sourceName,
      ...values
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save category.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function addSubcategory(categoryId: string, name: string) {
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const response = await apiRequest("/api/categories", "POST", {
      action: "add-subcategory",
      sourceKey: category.id,
      sourceName: category.sourceName,
      name: category.name,
      group: category.group,
      color: category.color,
      icon: category.icon,
      subcategoryName: name.trim()
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not add sub-category.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function saveAccount(account: {
    accountKey: string;
    name: string;
    institution: string;
    accountType: AccountType;
    openingBalanceCents: number;
    currency: string;
    color: string;
    icon: string;
  }) {
    const response = await apiRequest("/api/accounts", "POST", account);
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save account.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "home", label: "Home", icon: <LayoutDashboard size={20} /> },
    { id: "transactions", label: "History", icon: <List size={20} /> },
    { id: "accounts", label: "Accounts", icon: <Wallet size={20} /> },
    { id: "budget", label: "Budget", icon: <PieChart size={20} /> },
    { id: "categories", label: "Categories", icon: <Tag size={20} /> }
  ];

  return (
    <main className="mini-root">
      <section className="phone-frame" aria-label="Telexpense mini app">
        <header className="mini-header">
          <div>
            <p className="eyebrow">{headerTitle(activeTab)}</p>
            <p className="header-date">{new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
          </div>
          <input className="mini-month" type="month" value={month} aria-label="Month" onChange={(event) => setMonth(event.target.value || month)} />
        </header>

        {error ? <div className="mini-error">{friendlyError(error)}</div> : null}

        <div className="mini-content">
          {activeTab === "home" ? (
            <HomeView
              data={data}
              summary={summary}
              balanceVisible={balanceVisible}
              onToggleBalance={() => setBalanceVisible((value) => !value)}
              onViewAllTransactions={() => setActiveTab("transactions")}
              onAddTransaction={() => setModal({ type: "add-transaction" })}
            />
          ) : null}
          {activeTab === "transactions" ? (
            <TransactionListView
              data={data}
              month={month}
              onEdit={(tx) => setModal({ type: "edit-transaction", tx })}
              onDelete={deleteTransaction}
              onAdd={() => setModal({ type: "add-transaction" })}
            />
          ) : null}
          {activeTab === "accounts" ? (
            <AccountsView
              accounts={data.accounts}
              onAddAccount={() => setModal({ type: "add-account" })}
              onEditAccount={(account) => setModal({ type: "edit-account", account })}
            />
          ) : null}
          {activeTab === "budget" ? <BudgetView data={data} summary={summary} onSetBudget={(categoryId) => setModal({ type: "set-budget", categoryId })} /> : null}
          {activeTab === "categories" ? (
            <CategoriesView
              data={data}
              onSetBudget={(categoryId) => setModal({ type: "set-budget", categoryId })}
              onEditCategory={(categoryId) => setModal({ type: "edit-category", categoryId })}
              onAddSubcategory={(categoryId) => setModal({ type: "add-subcategory", categoryId })}
            />
          ) : null}
        </div>

        <nav className="bottom-tabs" aria-label="App sections">
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} type="button" onClick={() => setActiveTab(tab.id)}>
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </section>

      {modal.type === "add-transaction" || modal.type === "edit-transaction" ? (
        <TransactionModal
          data={data}
          editTx={modal.type === "edit-transaction" ? modal.tx : null}
          onSave={saveTransaction}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "set-budget" ? (
        <BudgetModal data={data} categoryId={modal.categoryId} onSave={saveBudget} onClose={() => setModal({ type: "none" })} />
      ) : null}

      {modal.type === "add-account" || modal.type === "edit-account" ? (
        <AccountModal account={modal.type === "edit-account" ? modal.account : null} onSave={saveAccount} onClose={() => setModal({ type: "none" })} />
      ) : null}

      {modal.type === "edit-category" ? (
        <CategoryModal
          category={data.categories.find((category) => category.id === modal.categoryId)}
          onSave={saveCategory}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "add-subcategory" ? (
        <SubcategoryModal
          category={data.categories.find((category) => category.id === modal.categoryId)}
          onSave={addSubcategory}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}
    </main>
  );
}

function HomeView({
  data,
  summary,
  balanceVisible,
  onToggleBalance,
  onViewAllTransactions,
  onAddTransaction
}: {
  data: AppData;
  summary: Summary | null;
  balanceVisible: boolean;
  onToggleBalance: () => void;
  onViewAllTransactions: () => void;
  onAddTransaction: () => void;
}) {
  const totalIncome = data.transactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = data.transactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const totalBalance = totalIncome - totalExpense;
  const recent = data.transactions.slice(0, 5);
  const currency = data.transactions[0]?.currency || summary?.budgets[0]?.currency || "USD";

  return (
    <div className="screen-stack">
      <section className="balance-block">
        <p className="eyebrow">Total Balance</p>
        <div className="balance-row">
          <h1>{balanceVisible ? money(totalBalance, currency) : "••••••"}</h1>
          <button className="ghost-button" type="button" onClick={onToggleBalance} aria-label="Toggle balance visibility">
            {balanceVisible ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
      </section>

      <section className="mini-card">
        <div className="section-line">
          <p className="eyebrow">Overview This Month</p>
          <button className="link-button" type="button" onClick={onViewAllTransactions}>
            View All <ChevronRight size={13} />
          </button>
        </div>
        <div className="overview-grid">
          <Metric icon={<TrendingUp size={13} />} label="Income" value={money(totalIncome, currency)} positive masked={!balanceVisible} />
          <Metric icon={<TrendingDown size={13} />} label="Expense" value={money(totalExpense, currency)} masked={!balanceVisible} />
        </div>
      </section>

      <section>
        <div className="section-line">
          <p className="eyebrow">Recent Transactions</p>
          <button className="link-button" type="button" onClick={onViewAllTransactions}>
            View All <ChevronRight size={13} />
          </button>
        </div>
        <div className="row-stack">
          {recent.length ? recent.map((tx) => <TransactionCard key={tx.id} tx={tx} data={data} />) : <EmptyState label="No transactions yet" />}
        </div>
      </section>

      <button className="primary-action" type="button" onClick={onAddTransaction}>
        <Plus size={16} /> Add Transaction
      </button>
    </div>
  );
}

function TransactionListView({
  data,
  month,
  onEdit,
  onDelete,
  onAdd
}: {
  data: AppData;
  month: string;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.transactions.filter((tx) => {
      const category = data.categories.find((item) => item.id === tx.categoryId);
      const account = data.accounts.find((item) => item.id === tx.accountId);
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (categoryFilter !== "all" && tx.categoryId !== categoryFilter) return false;
      if (query && !`${tx.description} ${category?.name || ""} ${account?.name || ""}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [categoryFilter, data, search, typeFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of filtered) groups.set(tx.date, [...(groups.get(tx.date) || []), tx]);
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const activeFilters = [typeFilter !== "all", categoryFilter !== "all"].filter(Boolean).length;

  return (
    <div className="screen-stack full-height">
      <div className="search-row">
        <label className="search-box">
          <Search size={15} />
          <input value={search} placeholder="Search transactions..." onChange={(event) => setSearch(event.target.value)} />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={13} />
            </button>
          ) : null}
        </label>
        <button className={showFilters ? "filter-button active" : "filter-button"} type="button" onClick={() => setShowFilters((value) => !value)} aria-label="Toggle filters">
          <Filter size={16} />
          {activeFilters ? <span>{activeFilters}</span> : null}
        </button>
      </div>

      {showFilters ? (
        <div className="filter-panel">
          <FieldLabel label="Type">
            <div className="segmented">
              {(["all", "income", "expense"] as const).map((item) => (
                <button key={item} className={typeFilter === item ? "active" : ""} type="button" onClick={() => setTypeFilter(item)}>
                  {capitalize(item)}
                </button>
              ))}
            </div>
          </FieldLabel>
          <FieldLabel label="Category">
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All Categories</option>
              {data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </FieldLabel>
          {activeFilters ? (
            <button className="danger-link" type="button" onClick={() => { setTypeFilter("all"); setCategoryFilter("all"); }}>
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="row-stack flex-fill">
        {grouped.length ? (
          grouped.map(([date, txs]) => (
            <section key={date} className="date-group">
              <p className="eyebrow">{formatDate(date)}</p>
              {txs.map((tx) => (
                <div key={tx.id} className="transaction-shell">
                  <TransactionCard tx={tx} data={data} actions={<RowActions tx={tx} confirming={deleteConfirm === tx.id} onEdit={onEdit} onDelete={onDelete} onToggleDelete={setDeleteConfirm} />} />
                  {deleteConfirm === tx.id ? (
                    <div className="confirm-row">
                      <button type="button" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                      <button type="button" onClick={() => { onDelete(tx); setDeleteConfirm(null); }}>Delete</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
          ))
        ) : <EmptyState label={`No transactions found for ${month}`} />}
      </div>

      <button className="primary-action" type="button" onClick={onAdd}>
        <Plus size={16} /> Add Transaction
      </button>
    </div>
  );
}

function AccountsView({
  accounts,
  onAddAccount,
  onEditAccount
}: {
  accounts: Account[];
  onAddAccount: () => void;
  onEditAccount: (account: Account) => void;
}) {
  const totalByCurrency = accounts.reduce<Record<string, number>>((totals, account) => {
    totals[account.currency] = (totals[account.currency] || 0) + account.balanceCents;
    return totals;
  }, {});

  return (
    <div className="screen-stack">
      <section className="mini-card">
        <p className="eyebrow">Total Across Accounts</p>
        <div className="account-total-list">
          {Object.entries(totalByCurrency).length ? Object.entries(totalByCurrency).map(([currency, total]) => (
            <strong key={currency}>{money(total, currency)}</strong>
          )) : <strong>{money(0)}</strong>}
        </div>
      </section>

      <section className="row-stack">
        {accounts.length ? accounts.map((account) => (
          <article key={account.accountKey} className="account-card">
            <div className="account-icon" style={{ color: account.color, backgroundColor: `${account.color}22` }}>
              {(() => {
                const Icon = iconFor(account.icon);
                return <Icon size={18} />;
              })()}
            </div>
            <div className="account-copy">
              <strong>{account.name}</strong>
              <span>{account.institution || accountTypeLabel(account.accountType)} · {accountTypeLabel(account.accountType)}</span>
            </div>
            <div className="account-balance">
              <strong>{money(account.balanceCents, account.currency)}</strong>
              <span>Opening {money(account.openingBalanceCents, account.currency)}</span>
            </div>
            <button className="tiny-icon" type="button" onClick={() => onEditAccount(account)} aria-label={`Edit ${account.name}`}>
              <Pencil size={11} />
            </button>
          </article>
        )) : <EmptyState label="No accounts yet" />}
      </section>

      <button className="primary-action" type="button" onClick={onAddAccount}>
        <Plus size={16} /> Add Account
      </button>
    </div>
  );
}

function BudgetView({ data, summary, onSetBudget }: { data: AppData; summary: Summary | null; onSetBudget: (categoryId: string) => void }) {
  const totalBudget = summary?.health.budgetCents ?? data.categories.reduce((sum, category) => sum + (category.budget || 0), 0);
  const totalSpent = summary?.health.spentCents ?? data.transactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const budgetLeft = totalBudget - totalSpent;
  const usedPct = totalBudget ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const currency = data.categories[0]?.currency || "USD";

  return (
    <div className="screen-stack">
      <section className="mini-card budget-summary">
        <p className="eyebrow">Monthly Budget</p>
        <div className="budget-overview">
          <div className="donut" style={{ "--donut": usedPct } as React.CSSProperties}>
            <span>{usedPct}%</span>
            <small>used</small>
          </div>
          <div className="summary-list">
            <ValueLine label="Total Budget" value={money(totalBudget, currency)} />
            <ValueLine label="Used" value={money(totalSpent, currency)} danger />
            <ValueLine label="Budget Left" value={`${money(Math.abs(budgetLeft), currency)}${budgetLeft < 0 ? " over" : ""}`} positive={budgetLeft >= 0} danger={budgetLeft < 0} />
          </div>
        </div>
      </section>

      {GROUPS.map((group) => {
        const categories = data.categories.filter((category) => category.group === group && category.budget !== undefined);
        if (!categories.length) return null;
        const groupBudget = categories.reduce((sum, category) => sum + (category.budget || 0), 0);
        const groupSpent = categories.reduce((sum, category) => sum + spentForCategory(data, category.id), 0);
        const groupPct = groupBudget ? Math.min(100, Math.round((groupSpent / groupBudget) * 100)) : 0;
        return (
          <section key={group} className="mini-card grouped-card">
            <div className="group-head">
              <div className="group-icon" style={{ color: GROUP_COLORS[group], backgroundColor: `${GROUP_COLORS[group]}22` }}>
                {group === "Needs" ? <Home size={16} /> : group === "Wants" ? <ShoppingBag size={16} /> : <Wallet size={16} />}
              </div>
              <div>
                <strong>{group}</strong>
                <Progress value={groupPct} color={groupPct > 90 ? "#f87171" : GROUP_COLORS[group]} />
              </div>
              <span>{groupPct}%</span>
            </div>
            <div className="nested-list">
              {categories.map((category) => {
                const spent = spentForCategory(data, category.id);
                const pct = category.budget ? Math.min(100, Math.round((spent / category.budget) * 100)) : 0;
                return (
                  <div key={category.id} className="budget-row">
                    <CategoryIcon category={category} />
                    <div>
                      <strong>{category.name}</strong>
                      <Progress value={pct} color={pct > 90 ? "#f87171" : category.color} thin />
                    </div>
                    <span>{money(spent, category.currency)} / {money(category.budget || 0, category.currency)}</span>
                    <button className="tiny-icon" type="button" onClick={() => onSetBudget(category.id)} aria-label={`Set ${category.name} budget`}>
                      <Pencil size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CategoriesView({
  data,
  onSetBudget,
  onEditCategory,
  onAddSubcategory
}: {
  data: AppData;
  onSetBudget: (categoryId: string) => void;
  onEditCategory: (categoryId: string) => void;
  onAddSubcategory: (categoryId: string) => void;
}) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  return (
    <div className="screen-stack">
      <p className="helper-copy">Edit names, groups, colors, icons, and add sub-categories for faster transaction entry.</p>
      {GROUPS.map((group) => {
        const categories = data.categories.filter((category) => category.group === group);
        return (
          <section key={group}>
            <div className="category-group-label">
              <span style={{ backgroundColor: GROUP_COLORS[group] }} />
              <p>{group}</p>
              <small>({categories.length})</small>
            </div>
            <div className="row-stack">
              {categories.length ? categories.map((category) => {
                const expanded = expandedCat === category.id;
                return (
                  <div key={category.id} className="mini-card category-card">
                    <button className="category-main" type="button" onClick={() => setExpandedCat(expanded ? null : category.id)}>
                      <CategoryIcon category={category} />
                      <span>
                        <strong>{category.name}</strong>
                        <small>{category.subcategories.length} sub-categories</small>
                      </span>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="category-actions">
                      <button className="tiny-icon" type="button" onClick={() => onEditCategory(category.id)} aria-label={`Edit ${category.name}`}>
                        <Pencil size={11} />
                      </button>
                      <button className="tiny-icon" type="button" onClick={() => onSetBudget(category.id)} aria-label={`Set ${category.name} budget`}>
                        <Wallet size={11} />
                      </button>
                    </div>
                    {expanded ? (
                      <div className="subcategory-list">
                        {category.subcategories.length ? category.subcategories.map((sub) => (
                          <div key={sub.id}>
                            <span style={{ backgroundColor: category.color }} />
                            <p>{sub.name}</p>
                          </div>
                        )) : <div><span style={{ backgroundColor: category.color }} /><p>No sub-categories yet</p></div>}
                        <button type="button" onClick={() => onAddSubcategory(category.id)}>
                          <Plus size={12} />
                          Add sub-category
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              }) : <EmptyState label={`No ${group.toLowerCase()} categories yet`} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CategoryModal({
  category,
  onSave,
  onClose
}: {
  category?: Category;
  onSave: (categoryId: string, values: { name: string; group: BudgetGroup; color: string; icon: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name || "");
  const [group, setGroup] = useState<BudgetGroup>(category?.group || "Needs");
  const [color, setColor] = useState(category?.color || CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(category?.icon || "Wallet");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    onSave(category.id, { name: name.trim(), group, color, icon });
  }

  return (
    <BottomSheet title="Edit Category" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <FieldLabel label="Name">
          <input value={name} placeholder="Category name" onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Budget Group">
          <div className="segmented">
            {GROUPS.map((item) => (
              <button key={item} className={group === item ? "active" : ""} type="button" onClick={() => setGroup(item)}>
                {item}
              </button>
            ))}
          </div>
        </FieldLabel>
        <FieldLabel label="Color">
          <div className="choice-grid color-grid">
            {CATEGORY_COLORS.map((item) => (
              <button
                key={item}
                className={color === item ? "selected" : ""}
                type="button"
                style={{ backgroundColor: item }}
                aria-label={`Use color ${item}`}
                onClick={() => setColor(item)}
              />
            ))}
          </div>
        </FieldLabel>
        <FieldLabel label="Icon">
          <div className="choice-grid icon-grid">
            {CATEGORY_ICONS.map((item) => {
              const Icon = iconFor(item);
              return (
                <button key={item} className={icon === item ? "selected" : ""} type="button" title={iconLabel(item)} onClick={() => setIcon(item)}>
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" type="submit">Save Category</button>
      </form>
    </BottomSheet>
  );
}

function SubcategoryModal({
  category,
  onSave,
  onClose
}: {
  category?: Category;
  onSave: (categoryId: string, name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) return;
    if (!name.trim()) {
      setError("Sub-category name is required.");
      return;
    }
    onSave(category.id, name);
  }

  return (
    <BottomSheet title="Add Sub-category" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="budget-target">
          <small>Adding under</small>
          <strong>{category?.name}</strong>
        </div>
        <FieldLabel label="Name">
          <input value={name} placeholder="Sub-category name" autoFocus onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" type="submit">Add Sub-category</button>
      </form>
    </BottomSheet>
  );
}

function AccountModal({
  account,
  onSave,
  onClose
}: {
  account: Account | null;
  onSave: (account: {
    accountKey: string;
    name: string;
    institution: string;
    accountType: AccountType;
    openingBalanceCents: number;
    currency: string;
    color: string;
    icon: string;
  }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name || "");
  const [institution, setInstitution] = useState(account?.institution || "");
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType || "bank");
  const [openingBalance, setOpeningBalance] = useState(account ? String(account.openingBalanceCents / 100) : "0");
  const [currency, setCurrency] = useState(account?.currency || "USD");
  const [color, setColor] = useState(account?.color || "#60a5fa");
  const [icon, setIcon] = useState(account?.icon || "Wallet");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const openingBalanceCents = Math.round(Number(openingBalance) * 100);
    if (!name.trim()) {
      setError("Account name is required.");
      return;
    }
    if (!Number.isFinite(openingBalanceCents)) {
      setError("Opening balance is not valid.");
      return;
    }
    onSave({
      accountKey: account?.accountKey || slug(name),
      name: name.trim(),
      institution: institution.trim(),
      accountType,
      openingBalanceCents,
      currency: currency.trim().toUpperCase() || "USD",
      color,
      icon
    });
  }

  return (
    <BottomSheet title={account ? "Edit Account" : "Add Account"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <FieldLabel label="Name">
          <input value={name} placeholder="Checking, Savings, Credit Card" onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Institution">
          <input value={institution} placeholder="Bank name, optional" onChange={(event) => setInstitution(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Type">
          <div className="segmented wrap">
            {ACCOUNT_TYPES.map((item) => (
              <button key={item} className={accountType === item ? "active" : ""} type="button" onClick={() => setAccountType(item)}>
                {accountTypeLabel(item)}
              </button>
            ))}
          </div>
        </FieldLabel>
        <div className="form-grid-2">
          <FieldLabel label="Opening Balance">
            <input value={openingBalance} inputMode="decimal" onChange={(event) => setOpeningBalance(event.target.value)} />
          </FieldLabel>
          <FieldLabel label="Currency">
            <input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} />
          </FieldLabel>
        </div>
        <FieldLabel label="Color">
          <div className="choice-grid color-grid">
            {CATEGORY_COLORS.map((item) => (
              <button
                key={item}
                className={color === item ? "selected" : ""}
                type="button"
                style={{ backgroundColor: item }}
                aria-label={`Use color ${item}`}
                onClick={() => setColor(item)}
              />
            ))}
          </div>
        </FieldLabel>
        <FieldLabel label="Icon">
          <div className="choice-grid icon-grid">
            {CATEGORY_ICONS.map((item) => {
              const Icon = iconFor(item);
              return (
                <button key={item} className={icon === item ? "selected" : ""} type="button" title={iconLabel(item)} onClick={() => setIcon(item)}>
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" type="submit">{account ? "Save Account" : "Add Account"}</button>
      </form>
    </BottomSheet>
  );
}

function TransactionModal({
  data,
  editTx,
  onSave,
  onClose
}: {
  data: AppData;
  editTx: Transaction | null;
  onSave: (tx: Omit<Transaction, "id" | "sourceId" | "kind" | "currency"> & { id?: string; sourceId?: number; currency?: string }) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransactionType>(editTx?.type ?? "expense");
  const [amount, setAmount] = useState(editTx ? String(editTx.amount / 100) : "");
  const [description, setDescription] = useState(editTx?.description ?? "");
  const [categoryId, setCategoryId] = useState(editTx?.categoryId ?? data.categories[0]?.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(editTx?.subcategoryId ?? "");
  const initialAccount = data.accounts.find((item) => item.id === editTx?.accountId);
  const [accountChoice, setAccountChoice] = useState(initialAccount?.accountKey || "");
  const [date, setDate] = useState(editTx?.date ?? new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");
  const selectedCategory = data.categories.find((category) => category.id === categoryId);
  const selectedAccount = data.accounts.find((item) => item.accountKey === accountChoice);

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!description.trim() || !categoryId || !Number.isFinite(cents) || cents <= 0 || !date) {
      setError("Amount, description, category, and date are required.");
      return;
    }
    if (!selectedAccount?.id) {
      setError("Select an account.");
      return;
    }
    onSave({
      id: editTx?.id,
      sourceId: editTx?.sourceId,
      type,
      amount: cents,
      categoryId,
      subcategoryId: subcategoryId || undefined,
      accountId: selectedAccount.id,
      description: description.trim(),
      date,
      currency: editTx?.currency
    });
  }

  return (
    <BottomSheet title={editTx ? "Edit Transaction" : "Add Transaction"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="segmented">
          <button className={type === "expense" ? "active danger" : ""} type="button" onClick={() => setType("expense")}>Expense</button>
          <button className={type === "income" ? "active" : ""} type="button" onClick={() => setType("income")}>Income</button>
        </div>
        <FieldLabel label="Amount">
          <input value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => setAmount(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Description">
          <input value={description} placeholder="What was this for?" onChange={(event) => setDescription(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Category">
          <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSubcategoryId(""); }}>
            {data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Sub-category">
          <select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}>
            <option value="">None</option>
            {selectedCategory?.subcategories.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Account">
          <select value={accountChoice} onChange={(event) => setAccountChoice(event.target.value)}>
            <option value="">Select account</option>
            {data.accounts.map((item) => (
              <option key={item.accountKey} value={item.accountKey}>
                {item.name}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" type="submit">{editTx ? "Save Changes" : "Add Transaction"}</button>
      </form>
    </BottomSheet>
  );
}

function BudgetModal({ data, categoryId, onSave, onClose }: { data: AppData; categoryId: string; onSave: (categoryId: string, amount: number) => void; onClose: () => void }) {
  const category = data.categories.find((item) => item.id === categoryId);
  const [amount, setAmount] = useState(category?.budget ? String(category.budget / 100) : "");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Enter a valid budget amount.");
      return;
    }
    onSave(categoryId, cents);
  }

  return (
    <BottomSheet title="Set Budget" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="budget-target">
          <small>Setting budget for</small>
          <strong>{category?.name}</strong>
          {category?.budget ? <small>Current: {money(category.budget, category.currency)}</small> : null}
        </div>
        <FieldLabel label="Budget Amount">
          <input value={amount} inputMode="decimal" placeholder="0.00" autoFocus onChange={(event) => setAmount(event.target.value)} />
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" type="submit">Set Budget</button>
      </form>
    </BottomSheet>
  );
}

function BottomSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet">
        <div className="sheet-handle" />
        <header>
          <h2>{title}</h2>
          <button className="ghost-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Metric({ icon, label, value, positive = false, masked = false }: { icon: ReactNode; label: string; value: string; positive?: boolean; masked?: boolean }) {
  return (
    <div className="metric-tile">
      <div className={positive ? "metric-icon positive" : "metric-icon"}>{icon}</div>
      <span>{label}</span>
      <strong className={positive ? "positive-text" : "danger-text"}>{masked ? "••••••" : value}</strong>
    </div>
  );
}

function TransactionCard({ tx, data, actions }: { tx: Transaction; data: AppData; actions?: ReactNode }) {
  const category = data.categories.find((item) => item.id === tx.categoryId);
  const sub = category?.subcategories.find((item) => item.id === tx.subcategoryId);
  const isIncome = tx.type === "income";
  return (
    <article className="transaction-card">
      <CategoryIcon category={category} />
      <div className="transaction-body">
        <strong>{tx.description}</strong>
        <span>{sub?.name || category?.name || tx.categoryId} · {formatDate(tx.date)}</span>
      </div>
      <div className="transaction-amount">
        <strong className={isIncome ? "positive-text" : "danger-text"}>{isIncome ? "+" : "-"}{money(tx.amount, tx.currency)}</strong>
        <span className={isIncome ? "positive-text" : "danger-text"}>
          {isIncome ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
          {isIncome ? "Income" : "Expense"}
        </span>
      </div>
      {actions}
    </article>
  );
}

function RowActions({
  tx,
  onEdit,
  onDelete,
  onToggleDelete
}: {
  tx: Transaction;
  confirming: boolean;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onToggleDelete: (id: string | null) => void;
}) {
  return (
    <div className="card-actions">
      <button type="button" onClick={() => onEdit(tx)} aria-label="Edit transaction"><Pencil size={12} /></button>
      <button type="button" onClick={() => onToggleDelete(tx.id)} aria-label="Delete transaction"><Trash2 size={12} /></button>
    </div>
  );
}

function CategoryIcon({ category }: { category?: Category }) {
  const Icon = iconFor(category?.icon);
  return (
    <div className="category-icon" style={{ color: category?.color || "#888", backgroundColor: `${category?.color || "#888"}22` }}>
      <Icon size={18} />
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-label">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ValueLine({ label, value, positive = false, danger = false }: { label: string; value: string; positive?: boolean; danger?: boolean }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={positive ? "positive-text" : danger ? "danger-text" : ""}>{value}</strong>
    </div>
  );
}

function Progress({ value, color, thin = false }: { value: number; color: string; thin?: boolean }) {
  return (
    <div className={thin ? "progress-line thin" : "progress-line"}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }} />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state"><Banknote size={28} /><span>{label}</span></div>;
}

function buildAppData(summary: Summary | null): AppData {
  if (!summary) return { categories: [], accounts: [], transactions: [] };
  const categoryMap = new Map<string, Category>();
  const storedCategories = new Map(summary.storedCategories.map((category) => [category.sourceKey, category]));
  const addCategory = (name: string, currency = "USD") => {
    const id = slug(name);
    const existing = categoryMap.get(id);
    if (existing) return existing;
    const look = CATEGORY_LOOK[id] || CATEGORY_LOOK[name.toLowerCase()] || {
      group: "Needs" as BudgetGroup,
      color: FALLBACK_COLORS[categoryMap.size % FALLBACK_COLORS.length],
      icon: "Wallet"
    };
    const budget = summary.budgets.find((item) => slug(item.category) === id);
    const stored = storedCategories.get(id);
    const category: Category = {
      id,
      sourceName: stored?.sourceName || name,
      name: stored?.name || titleCase(name),
      group: stored?.group || look.group,
      color: stored?.color || look.color,
      icon: stored?.icon || look.icon,
      budget: budget?.budgetCents,
      currency: budget?.currency || currency,
      subcategories: []
    };
    categoryMap.set(id, category);
    return category;
  };

  for (const item of summary.categories) addCategory(item.category, item.currency);
  for (const item of summary.budgets) addCategory(item.category, item.currency);
  for (const item of summary.recent) addCategory(item.category, item.currency);

  const transactions = summary.recent.map((tx) => {
    const category = addCategory(tx.category, tx.currency);
    return {
      id: String(tx.id),
      sourceId: tx.id,
      amount: Math.abs(tx.amountCents),
      currency: tx.currency,
      type: tx.kind === "income" || tx.amountCents > 0 ? "income" : "expense",
      kind: tx.kind,
      categoryId: category.id,
      accountId: tx.accountId,
      description: tx.description,
      date: tx.occurredOn
    } satisfies Transaction;
  });

  for (const stored of summary.storedCategories) {
    const category = categoryMap.get(stored.sourceKey);
    if (!category?.subcategories || !stored.subcategories.length) continue;
    for (const sub of stored.subcategories) {
      const id = `${stored.sourceKey}:stored-${sub.id}`;
      if (!category.subcategories.some((item) => item.id === id || item.name.toLowerCase() === sub.name.toLowerCase())) {
        category.subcategories.push({ id, name: sub.name, categoryId: stored.sourceKey });
      }
    }
  }

  return {
    categories: Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    accounts: summary.accounts,
    transactions
  };
}

function spentForCategory(data: AppData, categoryId: string) {
  return data.transactions.filter((tx) => tx.type === "expense" && tx.categoryId === categoryId).reduce((sum, tx) => sum + tx.amount, 0);
}

async function apiRequest(path: string, method: string, body?: unknown) {
  const initData = window.Telegram?.WebApp?.initData || "";
  return fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function signedCents(type: TransactionType, cents: number) {
  return type === "income" ? Math.abs(cents) : -Math.abs(cents);
}

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uncategorized";
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

function iconFor(name?: string) {
  const icons: Record<string, typeof Wallet> = {
    BookOpen,
    Coffee,
    Home,
    Heart,
    ShoppingCart,
    Car,
    Tv,
    ShoppingBag,
    Shield,
    TrendingUp,
    Briefcase,
    Music,
    Plane,
    Utensils,
    Wallet
  };
  return icons[name || "Wallet"] || Wallet;
}

function iconLabel(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function accountTypeLabel(type: AccountType) {
  if (type === "cash") return "Cash";
  if (type === "bank") return "Bank";
  if (type === "card") return "Card";
  if (type === "investment") return "Investment";
  return "Other";
}

function headerTitle(tab: Tab) {
  if (tab === "transactions") return "All Transactions";
  if (tab === "accounts") return "Accounts";
  if (tab === "budget") return "Monthly Budget";
  if (tab === "categories") return "Categories";
  return "Halo, User";
}

function friendlyError(error: string) {
  if (error.includes("Telegram init data")) return "Open this dashboard inside Telegram after configuring your Mini App.";
  return error;
}
