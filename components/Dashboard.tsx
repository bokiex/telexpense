"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { netWorthByCurrency } from "@/lib/finance";
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
  Repeat,
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
import { transferAccounts } from "@/lib/transfer";
import { PendingButton, usePendingAction } from "@/components/PendingButton";

type BudgetGroup = "Needs" | "Wants" | "Savings";
type TransactionType = "income" | "expense";
type AccountType = "cash" | "bank" | "card" | "investment" | "loan" | "other";
type RecurringRuleType = "subscription" | "investment_transfer" | "loan_payment";
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
  category: string | null;
  subcategoryId: number | null;
  accountId: number | null;
  transferGroupId: string | null;
  transferFromAccountId: number | null;
  transferToAccountId: number | null;
  recurringRuleId: number | null;
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
  portfolioSnapshots: PortfolioSnapshot[];
  recurringRules: RecurringRule[];
  loanProgress: LoanProgress[];
  recent: RecentTransaction[];
};

type HistoryPage = {
  items: RecentTransaction[];
  nextCursor: { beforeDate: string; beforeId: number } | null;
};

type StoredCategory = {
  id: number;
  sourceKey: string;
  sourceName: string;
  name: string;
  group: BudgetGroup;
  color: string;
  icon: string;
  active: boolean;
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
  hidden?: boolean;
};

type Transaction = {
  id: string;
  sourceId: number;
  amount: number;
  currency: string;
  type: TransactionType;
  kind: RecentTransaction["kind"];
  transferGroupId: string | null;
  categoryId: string;
  subcategoryId?: string;
  accountId?: number | null;
  toAccountId?: number | null;
  description: string;
  date: string;
};

type TransactionFormValues =
  | (Omit<Transaction, "id" | "sourceId" | "kind" | "currency" | "transferGroupId" | "toAccountId"> & { id?: string; sourceId?: number; currency?: string; type: "income" | "expense" })
  | {
      id?: string;
      sourceId?: number;
      transferGroupId?: string;
      type: "transfer";
      amount: number;
      accountId: number;
      toAccountId: number;
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

type PortfolioSnapshot = {
  accountId: number;
  month: string;
  portfolioValueCents: number;
  contributionCents: number;
  monthlyContributionCents: number;
  marketGainLossCents: number;
  currency: string;
};

type RecurringRule = {
  id: number;
  name: string;
  ruleType: RecurringRuleType;
  amountCents: number;
  currency: string;
  category: string;
  fromAccountId: number;
  toAccountId: number | null;
  dayOfMonth: number;
  active: boolean;
};

type LoanProgress = {
  accountId: number;
  name: string;
  openingBalanceCents: number;
  balanceCents: number;
  repaidCents: number;
  repaymentThisMonthCents: number;
  payoffProgress: number;
  currency: string;
};

type ModalState =
  | { type: "none" }
  | { type: "add-transaction" }
  | { type: "edit-transaction"; tx: Transaction }
  | { type: "add-account" }
  | { type: "edit-account"; account: Account }
  | { type: "portfolio-snapshot"; account: Account }
  | { type: "add-recurring-rule" }
  | { type: "edit-recurring-rule"; rule: RecurringRule }
  | { type: "add-category" }
  | { type: "edit-category"; categoryId: string }
  | { type: "add-subcategory"; categoryId: string }
  | { type: "set-budget"; categoryId: string };

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
const ACCOUNT_TYPES: AccountType[] = ["cash", "bank", "card", "investment", "loan", "other"];
const RECURRING_TYPES: RecurringRuleType[] = ["subscription", "investment_transfer", "loan_payment"];
const DEFAULT_CURRENCY = "SGD";

export default function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState<RecentTransaction[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<HistoryPage["nextCursor"]>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequestVersion = useRef(0);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setError("");
      setLoading(true);
      try {
        const response = await apiRequest(`/api/summary?month=${encodeURIComponent(month)}`, "GET");
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!ignore) setError(body?.error || "Could not load dashboard.");
          return;
        }
        const data = (await response.json()) as Summary;
        if (!ignore) setSummary(data);
      } catch {
        if (!ignore) setError("Could not load dashboard.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [month, refreshKey]);

  useEffect(() => {
    if (activeTab !== "transactions") return;
    let ignore = false;
    const requestVersion = ++historyRequestVersion.current;
    async function loadHistory() {
      setHistory(null);
      setHistoryCursor(null);
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const query = new URLSearchParams({ month, limit: "50" });
        const response = await apiRequest(`/api/transactions/history?${query}`, "GET");
        if (!response.ok) throw new Error("Could not load transaction history.");
        const page = (await response.json()) as HistoryPage;
        if (!ignore && historyRequestVersion.current === requestVersion) {
          setHistory(page.items);
          setHistoryCursor(page.nextCursor);
        }
      } catch (loadError) {
        if (!ignore && historyRequestVersion.current === requestVersion) {
          setHistoryError(loadError instanceof Error ? loadError.message : "Could not load transaction history.");
        }
      } finally {
        if (!ignore && historyRequestVersion.current === requestVersion) setHistoryLoading(false);
      }
    }
    loadHistory();
    return () => {
      ignore = true;
      if (historyRequestVersion.current === requestVersion) historyRequestVersion.current += 1;
    };
  }, [activeTab, month, refreshKey]);

  const data = useMemo(() => buildAppData(summary), [summary]);
  const historyData = useMemo(
    () => buildAppData(summary, history || summary?.recent),
    [history, summary]
  );
  const reload = () => {
    historyRequestVersion.current += 1;
    setRefreshKey((value) => value + 1);
  };

  async function loadMoreHistory() {
    if (!historyCursor || historyLoading) return;
    const requestVersion = historyRequestVersion.current;
    const requestMonth = month;
    const requestCursor = historyCursor;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const query = new URLSearchParams({
        month: requestMonth,
        limit: "50",
        beforeDate: requestCursor.beforeDate,
        beforeId: String(requestCursor.beforeId)
      });
      const response = await apiRequest(`/api/transactions/history?${query}`, "GET");
      if (!response.ok) throw new Error("Could not load more transactions.");
      const page = (await response.json()) as HistoryPage;
      if (historyRequestVersion.current !== requestVersion) return;
      setHistory((current) => [...(current || []), ...page.items]);
      setHistoryCursor(page.nextCursor);
    } catch (loadError) {
      if (historyRequestVersion.current === requestVersion) {
        setHistoryError(loadError instanceof Error ? loadError.message : "Could not load more transactions.");
      }
    } finally {
      if (historyRequestVersion.current === requestVersion) setHistoryLoading(false);
    }
  }

  async function saveTransaction(tx: TransactionFormValues) {
    if (tx.type === "transfer") {
      const fromAccount = data.accounts.find((item) => item.id === tx.accountId);
      const toAccount = data.accounts.find((item) => item.id === tx.toAccountId);
      const path = tx.transferGroupId ? `/api/transfers/${tx.transferGroupId}` : "/api/transfers";
      const response = await apiRequest(path, tx.transferGroupId ? "PATCH" : "POST", {
        fromAccountId: fromAccount?.id,
        toAccountId: toAccount?.id,
        description: tx.description,
        amountCents: tx.amount,
        currency: fromAccount?.currency || toAccount?.currency || DEFAULT_CURRENCY,
        occurredOn: tx.date
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error || "Could not save transfer.");
        return;
      }
      setModal({ type: "none" });
      reload();
      return;
    }

    const amountCents = signedCents(tx.type, tx.amount);
    const selectedCategory = data.categories.find((item) => item.id === tx.categoryId);
    const category = selectedCategory?.sourceName || selectedCategory?.name || tx.categoryId;
    const selectedAccount = data.accounts.find((item) => item.id === tx.accountId);
    const body = {
      kind: tx.type,
      category,
      subcategoryId: tx.subcategoryId ? Number(tx.subcategoryId.split("stored-").at(-1)) : null,
      accountId: selectedAccount?.id,
      description: tx.description,
      amountCents,
      currency: tx.currency || summary?.recent[0]?.currency || DEFAULT_CURRENCY,
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
    const path = tx.transferGroupId
      ? `/api/transfers/${tx.transferGroupId}`
      : `/api/transactions/${tx.sourceId}`;
    const response = await apiRequest(path, "DELETE");
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

  async function saveCategory(categoryId: string | null, values: { name: string; group: BudgetGroup; color: string; icon: string; budgetCents: number }) {
    const category = categoryId ? data.categories.find((item) => item.id === categoryId) : null;
    const sourceKey = category?.id || slug(values.name);
    const sourceName = category?.sourceName || values.name.toLowerCase();
    const currency = category?.currency || summary?.recent[0]?.currency || DEFAULT_CURRENCY;
    const categoryResponse = await apiRequest("/api/categories", "POST", {
      sourceKey,
      sourceName,
      name: values.name,
      group: values.group,
      color: values.color,
      icon: values.icon
    });
    if (!categoryResponse.ok) {
      const result = await categoryResponse.json().catch(() => null);
      setError(result?.error || "Could not save category.");
      return;
    }
    const budgetResponse = await apiRequest("/api/budgets", "POST", {
      category: sourceName,
      month,
      amountCents: values.budgetCents,
      currency
    });
    if (!budgetResponse.ok) {
      const result = await budgetResponse.json().catch(() => null);
      setError(result?.error || "Could not save budget.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function deleteCategory(categoryId: string) {
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const response = await apiRequest(
      `/api/categories?sourceKey=${encodeURIComponent(category.id)}&sourceName=${encodeURIComponent(category.sourceName)}&month=${encodeURIComponent(month)}`,
      "DELETE"
    );
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not delete category.");
      return;
    }
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

  async function savePortfolioSnapshot(account: Account, portfolioValueCents: number) {
    const response = await apiRequest("/api/portfolio-snapshots", "POST", {
      accountId: account.id,
      month,
      portfolioValueCents,
      currency: account.currency
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save portfolio value.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function saveRecurringRule(rule: Omit<RecurringRule, "id"> & { id?: number | null }) {
    const response = await apiRequest("/api/recurring-rules", "POST", rule);
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save recurring rule.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function deleteRecurringRule(rule: RecurringRule) {
    const response = await apiRequest(`/api/recurring-rules?id=${encodeURIComponent(rule.id)}`, "DELETE");
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not remove recurring rule.");
      return;
    }
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

        {error ? <div className="mini-error">{friendlyError(error)} <button type="button" onClick={reload}>Retry</button></div> : null}

        <div className="mini-content">
          {loading ? <DashboardSkeleton /> : null}
          {!loading && activeTab === "home" ? (
            <HomeView
              data={data}
              summary={summary}
              balanceVisible={balanceVisible}
              onToggleBalance={() => setBalanceVisible((value) => !value)}
              onViewAllTransactions={() => setActiveTab("transactions")}
              onAddTransaction={() => setModal({ type: "add-transaction" })}
            />
          ) : null}
          {!loading && activeTab === "transactions" ? (
            <TransactionListView
              data={historyData}
              month={month}
              onEdit={(tx) => setModal({ type: "edit-transaction", tx })}
              onDelete={deleteTransaction}
              onAdd={() => setModal({ type: "add-transaction" })}
              loading={historyLoading}
              error={historyError}
              hasMore={Boolean(historyCursor)}
              onLoadMore={loadMoreHistory}
              onRetry={historyCursor ? loadMoreHistory : reload}
            />
          ) : null}
          {!loading && activeTab === "accounts" ? (
            <AccountsView
              accounts={data.accounts}
              snapshots={summary?.portfolioSnapshots || []}
              recurringRules={summary?.recurringRules || []}
              onAddAccount={() => setModal({ type: "add-account" })}
              onEditAccount={(account) => setModal({ type: "edit-account", account })}
              onSetSnapshot={(account) => setModal({ type: "portfolio-snapshot", account })}
              onAddRecurringRule={() => setModal({ type: "add-recurring-rule" })}
              onEditRecurringRule={(rule) => setModal({ type: "edit-recurring-rule", rule })}
              onDeleteRecurringRule={deleteRecurringRule}
            />
          ) : null}
          {!loading && activeTab === "budget" ? <BudgetView data={data} summary={summary} onSetBudget={(categoryId) => setModal({ type: "set-budget", categoryId })} /> : null}
          {!loading && activeTab === "categories" ? (
            <CategoriesView
              data={data}
              onAddCategory={() => setModal({ type: "add-category" })}
              onEditCategory={(categoryId) => setModal({ type: "edit-category", categoryId })}
              onAddSubcategory={(categoryId) => setModal({ type: "add-subcategory", categoryId })}
              onDeleteCategory={deleteCategory}
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

      {modal.type === "portfolio-snapshot" ? (
        <PortfolioSnapshotModal
          account={modal.account}
          month={month}
          snapshot={summary?.portfolioSnapshots.find((snapshot) => snapshot.accountId === modal.account.id)}
          onSave={savePortfolioSnapshot}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "add-recurring-rule" || modal.type === "edit-recurring-rule" ? (
        <RecurringRuleModal
          data={data}
          rule={modal.type === "edit-recurring-rule" ? modal.rule : null}
          onSave={saveRecurringRule}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "edit-category" ? (
        <CategoryModal
          category={data.categories.find((category) => category.id === modal.categoryId)}
          currency={data.categories.find((category) => category.id === modal.categoryId)?.currency || DEFAULT_CURRENCY}
          onSave={saveCategory}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "add-category" ? (
        <CategoryModal
          currency={summary?.recent[0]?.currency || DEFAULT_CURRENCY}
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

function DashboardSkeleton() {
  return (
    <div className="screen-stack" aria-label="Loading dashboard" aria-busy="true">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
    </div>
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
  const totalIncome = data.transactions.filter((tx) => tx.kind === "income").reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = data.transactions.filter((tx) => tx.kind === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const netWorthTotals = Object.entries(netWorthByCurrency(data.accounts, summary?.portfolioSnapshots));
  const recent = data.transactions.slice(0, 5);
  const currency = data.transactions[0]?.currency || summary?.budgets[0]?.currency || DEFAULT_CURRENCY;

  return (
    <div className="screen-stack">
      <section className="balance-block">
        <p className="eyebrow">Net Worth</p>
        <div className="balance-row">
          <div className="account-total-list">
            {netWorthTotals.length ? netWorthTotals.map(([accountCurrency, total]) => (
              <h1 key={accountCurrency}>{balanceVisible ? money(total, accountCurrency) : "••••••"}</h1>
            )) : <h1>{balanceVisible ? money(0, DEFAULT_CURRENCY) : "••••••"}</h1>}
          </div>
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
  onAdd,
  loading,
  error,
  hasMore,
  onLoadMore,
  onRetry
}: {
  data: AppData;
  month: string;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => Promise<void>;
  onAdd: () => void;
  loading: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onRetry: () => void;
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
              {data.categories.filter((category) => !category.hidden).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
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
                      <PendingButton type="button" pendingLabel="Deleting…" onAction={async () => {
                        await onDelete(tx);
                        setDeleteConfirm(null);
                      }}>Delete</PendingButton>
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
          ))
        ) : <EmptyState label={`No transactions found for ${month}`} />}
      </div>

      {error ? <div className="mini-error">{error} <button type="button" onClick={onRetry}>Retry</button></div> : null}
      {hasMore || loading ? (
        <PendingButton className="link-button" type="button" pending={loading} pendingLabel="Loading…" onAction={onLoadMore}>
          Load more
        </PendingButton>
      ) : null}

      <button className="primary-action" type="button" onClick={onAdd}>
        <Plus size={16} /> Add Transaction
      </button>
    </div>
  );
}

function AccountsView({
  accounts,
  snapshots,
  recurringRules,
  onAddAccount,
  onEditAccount,
  onSetSnapshot,
  onAddRecurringRule,
  onEditRecurringRule,
  onDeleteRecurringRule
}: {
  accounts: Account[];
  snapshots: PortfolioSnapshot[];
  recurringRules: RecurringRule[];
  onAddAccount: () => void;
  onEditAccount: (account: Account) => void;
  onSetSnapshot: (account: Account) => void;
  onAddRecurringRule: () => void;
  onEditRecurringRule: (rule: RecurringRule) => void;
  onDeleteRecurringRule: (rule: RecurringRule) => Promise<void>;
}) {
  const totalByCurrency = netWorthByCurrency(accounts, snapshots);

  return (
    <div className="screen-stack">
      <section className="mini-card">
        <p className="eyebrow">Net Worth Across Accounts</p>
        <div className="account-total-list">
          {Object.entries(totalByCurrency).length ? Object.entries(totalByCurrency).map(([currency, total]) => (
            <strong key={currency}>{money(total, currency)}</strong>
          )) : <strong>{money(0, DEFAULT_CURRENCY)}</strong>}
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
              <strong>{account.accountType === "loan" ? money(Math.max(0, -account.balanceCents), account.currency) : money(account.balanceCents, account.currency)}</strong>
              <span>{account.accountType === "loan" ? "Original debt" : "Opening"} {money(account.accountType === "loan" ? Math.abs(account.openingBalanceCents) : account.openingBalanceCents, account.currency)}</span>
            </div>
            <div className="card-actions">
              {account.accountType === "investment" ? (
                <button type="button" onClick={() => onSetSnapshot(account)} aria-label={`Set ${account.name} portfolio value`}>
                  <TrendingUp size={12} />
                </button>
              ) : null}
              <button type="button" onClick={() => onEditAccount(account)} aria-label={`Edit ${account.name}`}>
                <Pencil size={12} />
              </button>
            </div>
            {account.accountType === "investment" ? <InvestmentAccountDetail account={account} snapshot={snapshots.find((item) => item.accountId === account.id)} /> : null}
          </article>
        )) : <EmptyState label="No accounts yet" />}
      </section>

      <button className="primary-action" type="button" onClick={onAddAccount}>
        <Plus size={16} /> Add Account
      </button>

      <section>
        <div className="section-line">
          <p className="eyebrow">Monthly Rules</p>
          <button className="link-button" type="button" onClick={onAddRecurringRule}>
            <Plus size={13} /> Add
          </button>
        </div>
        <div className="row-stack">
          {recurringRules.length ? recurringRules.map((rule) => (
            <article key={rule.id} className="recurring-card">
              <div className="account-icon">
                <Repeat size={17} />
              </div>
              <div className="account-copy">
                <strong>{rule.name}</strong>
                <span>{recurringTypeLabel(rule.ruleType)} · day {rule.dayOfMonth}</span>
              </div>
              <div className="account-balance">
                <strong>{money(rule.amountCents, rule.currency)}</strong>
                <span>{rule.active ? "Active" : "Inactive"}</span>
              </div>
              <div className="card-actions">
                <button type="button" onClick={() => onEditRecurringRule(rule)} aria-label={`Edit ${rule.name}`}>
                  <Pencil size={12} />
                </button>
                <PendingButton type="button" pendingLabel="Removing…" onAction={() => onDeleteRecurringRule(rule)} aria-label={`Remove ${rule.name}`}>
                  <Trash2 size={12} />
                </PendingButton>
              </div>
            </article>
          )) : <EmptyState label="No monthly rules yet" />}
        </div>
      </section>
    </div>
  );
}

function InvestmentAccountDetail({ account, snapshot }: { account: Account; snapshot?: PortfolioSnapshot }) {
  if (!snapshot) {
    return (
      <div className="account-detail">
        <ValueLine label="Portfolio value" value="Not set" />
        <ValueLine label="Contributions" value={money(Math.max(0, account.balanceCents), account.currency)} />
      </div>
    );
  }
  return (
    <div className="account-detail">
      <ValueLine label="Portfolio value" value={money(snapshot.portfolioValueCents, snapshot.currency)} />
      <ValueLine label="Total contributions" value={money(snapshot.contributionCents, snapshot.currency)} />
      <ValueLine label="This month contributions" value={money(snapshot.monthlyContributionCents, snapshot.currency)} />
      <ValueLine
        label="Market movement"
        value={`${snapshot.marketGainLossCents >= 0 ? "+" : "-"}${money(Math.abs(snapshot.marketGainLossCents), snapshot.currency)}`}
        positive={snapshot.marketGainLossCents >= 0}
        danger={snapshot.marketGainLossCents < 0}
      />
    </div>
  );
}

function BudgetView({ data, summary, onSetBudget }: { data: AppData; summary: Summary | null; onSetBudget: (categoryId: string) => void }) {
  const totalBudget = summary?.health.budgetCents ?? data.categories.reduce((sum, category) => sum + (category.budget || 0), 0);
  const totalSpent = summary?.health.spentCents ?? data.transactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const budgetLeft = totalBudget - totalSpent;
  const usedPct = totalBudget ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const currency = data.categories[0]?.currency || DEFAULT_CURRENCY;

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
        const categories = data.categories.filter((category) => !category.hidden && category.group === group && category.budget !== undefined);
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

      {summary?.loanProgress.length ? (
        <section className="mini-card grouped-card">
          <div className="section-line loan-head">
            <p className="eyebrow">Loan Repayment</p>
            <span>{summary.loanProgress.length}</span>
          </div>
          <div className="nested-list">
            {summary.loanProgress.map((loan) => (
              <div key={loan.accountId} className="loan-row">
                <div>
                  <strong>{loan.name}</strong>
                  <Progress value={loan.payoffProgress} color={loan.payoffProgress >= 100 ? "#4ade80" : "#60a5fa"} thin />
                </div>
                <div className="loan-values">
                  <span>{loan.payoffProgress}% paid</span>
                  <span>{money(Math.max(0, -loan.balanceCents), loan.currency)} left</span>
                  <span>{money(loan.repaymentThisMonthCents, loan.currency)} this month</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CategoriesView({
  data,
  onAddCategory,
  onEditCategory,
  onAddSubcategory,
  onDeleteCategory
}: {
  data: AppData;
  onAddCategory: () => void;
  onEditCategory: (categoryId: string) => void;
  onAddSubcategory: (categoryId: string) => void;
  onDeleteCategory: (categoryId: string) => Promise<void>;
}) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  return (
    <div className="screen-stack">
      <p className="helper-copy">Edit names, groups, colors, icons, and add sub-categories for faster transaction entry.</p>
      <button className="primary-action" type="button" onClick={onAddCategory}>
        <Plus size={16} /> Add Category
      </button>
      {GROUPS.map((group) => {
        const categories = data.categories.filter((category) => !category.hidden && category.group === group);
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
                      <button className="tiny-icon danger" type="button" onClick={() => setDeleteConfirm(deleteConfirm === category.id ? null : category.id)} aria-label={`Delete ${category.name}`}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {deleteConfirm === category.id ? (
                      <div className="confirm-row category-confirm">
                        <button type="button" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                        <PendingButton type="button" pendingLabel="Deleting…" onAction={async () => {
                          await onDeleteCategory(category.id);
                          setDeleteConfirm(null);
                        }}>Delete</PendingButton>
                      </div>
                    ) : null}
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
  currency,
  onSave,
  onClose
}: {
  category?: Category;
  currency: string;
  onSave: (categoryId: string | null, values: { name: string; group: BudgetGroup; color: string; icon: string; budgetCents: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name || "");
  const [group, setGroup] = useState<BudgetGroup>(category?.group || "Needs");
  const [color, setColor] = useState(category?.color || CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(category?.icon || "Wallet");
  const [budget, setBudget] = useState(category?.budget ? String(category.budget / 100) : "0");
  const [error, setError] = useState("");
  const saveAction = usePendingAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const budgetCents = Math.round(Number(budget) * 100);
    if (!Number.isFinite(budgetCents) || budgetCents < 0) {
      setError("Budget is not valid.");
      return;
    }
    void saveAction.run(() => onSave(category?.id || null, { name: name.trim(), group, color, icon, budgetCents }));
  }

  return (
    <BottomSheet title={category ? "Edit Category" : "Add Category"} onClose={onClose}>
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
        <FieldLabel label={`Monthly Budget (${currency})`}>
          <input value={budget} inputMode="decimal" placeholder="0.00" onChange={(event) => setBudget(event.target.value)} />
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
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          {category ? "Save Category" : "Add Category"}
        </PendingButton>
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
  onSave: (categoryId: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const saveAction = usePendingAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) return;
    if (!name.trim()) {
      setError("Sub-category name is required.");
      return;
    }
    void saveAction.run(() => onSave(category.id, name));
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
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Adding…">
          Add Sub-category
        </PendingButton>
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
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name || "");
  const [institution, setInstitution] = useState(account?.institution || "");
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType || "bank");
  const [openingBalance, setOpeningBalance] = useState(account ? String((account.accountType === "loan" || account.accountType === "card" ? Math.abs(account.openingBalanceCents) : account.openingBalanceCents) / 100) : "0");
  const [currency, setCurrency] = useState(account?.currency || DEFAULT_CURRENCY);
  const [color, setColor] = useState(account?.color || "#60a5fa");
  const [icon, setIcon] = useState(account?.icon || "Wallet");
  const [error, setError] = useState("");
  const saveAction = usePendingAction();

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
    void saveAction.run(() => onSave({
      accountKey: account?.accountKey || `${slug(name)}-${Date.now().toString(36)}`,
      name: name.trim(),
      institution: institution.trim(),
      accountType,
      openingBalanceCents,
      currency: currency.trim().toUpperCase() || DEFAULT_CURRENCY,
      color,
      icon
    }));
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
          <FieldLabel label={accountType === "loan" || accountType === "card" ? "Opening Debt" : "Opening Balance"}>
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
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          {account ? "Save Account" : "Add Account"}
        </PendingButton>
      </form>
    </BottomSheet>
  );
}

function PortfolioSnapshotModal({
  account,
  month,
  snapshot,
  onSave,
  onClose
}: {
  account: Account;
  month: string;
  snapshot?: PortfolioSnapshot;
  onSave: (account: Account, portfolioValueCents: number) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(snapshot ? String(snapshot.portfolioValueCents / 100) : "");
  const [error, setError] = useState("");
  const saveAction = usePendingAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(value) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Portfolio value is not valid.");
      return;
    }
    void saveAction.run(() => onSave(account, cents));
  }

  return (
    <BottomSheet title="Set Portfolio Value" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="budget-target">
          <small>{month}</small>
          <strong>{account.name}</strong>
        </div>
        <FieldLabel label={`Portfolio Value (${account.currency})`}>
          <input value={value} inputMode="decimal" placeholder="0.00" autoFocus onChange={(event) => setValue(event.target.value)} />
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          Save Value
        </PendingButton>
      </form>
    </BottomSheet>
  );
}

function RecurringRuleModal({
  data,
  rule,
  onSave,
  onClose
}: {
  data: AppData;
  rule: RecurringRule | null;
  onSave: (rule: Omit<RecurringRule, "id"> & { id?: number | null }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(rule?.name || "");
  const [ruleType, setRuleType] = useState<RecurringRuleType>(rule?.ruleType || "subscription");
  const [amount, setAmount] = useState(rule ? String(rule.amountCents / 100) : "");
  const [currency, setCurrency] = useState(rule?.currency || DEFAULT_CURRENCY);
  const [category, setCategory] = useState(rule?.category || data.categories[0]?.sourceName || "subscription");
  const [fromAccountId, setFromAccountId] = useState(rule?.fromAccountId ? String(rule.fromAccountId) : "");
  const [toAccountId, setToAccountId] = useState(rule?.toAccountId ? String(rule.toAccountId) : "");
  const [dayOfMonth, setDayOfMonth] = useState(rule ? String(rule.dayOfMonth) : "1");
  const [active, setActive] = useState(rule?.active ?? true);
  const [error, setError] = useState("");
  const saveAction = usePendingAction();
  const needsDestination = ruleType === "investment_transfer" || ruleType === "loan_payment";
  const destinationAccounts = data.accounts.filter((account) => {
    if (ruleType === "investment_transfer") return account.accountType === "investment";
    if (ruleType === "loan_payment") return account.accountType === "loan";
    return true;
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = Math.round(Number(amount) * 100);
    const day = Number(dayOfMonth);
    const fromId = Number(fromAccountId);
    const toId = Number(toAccountId);
    if (!name.trim() || !Number.isFinite(amountCents) || amountCents <= 0 || !category.trim() || !Number.isFinite(fromId)) {
      setError("Name, amount, category, and source account are required.");
      return;
    }
    if (needsDestination && !Number.isFinite(toId)) {
      setError("Select a destination account.");
      return;
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setError("Day must be between 1 and 31.");
      return;
    }
    void saveAction.run(() => onSave({
      id: rule?.id || null,
      name: name.trim(),
      ruleType,
      amountCents,
      currency: currency.trim().toUpperCase() || DEFAULT_CURRENCY,
      category: category.trim().toLowerCase(),
      fromAccountId: fromId,
      toAccountId: needsDestination ? toId : null,
      dayOfMonth: day,
      active
    }));
  }

  return (
    <BottomSheet title={rule ? "Edit Monthly Rule" : "Add Monthly Rule"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <FieldLabel label="Type">
          <div className="segmented wrap">
            {RECURRING_TYPES.map((item) => (
              <button key={item} className={ruleType === item ? "active" : ""} type="button" onClick={() => { setRuleType(item); setToAccountId(""); }}>
                {recurringTypeLabel(item)}
              </button>
            ))}
          </div>
        </FieldLabel>
        <FieldLabel label="Name">
          <input value={name} placeholder="Netflix, monthly ETF, loan payment" onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        <div className="form-grid-2">
          <FieldLabel label="Amount">
            <input value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => setAmount(event.target.value)} />
          </FieldLabel>
          <FieldLabel label="Currency">
            <input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} />
          </FieldLabel>
        </div>
        <FieldLabel label="Category">
          <input value={category} placeholder="subscription, investment, loan" onChange={(event) => setCategory(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="From Account">
          <select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}>
            <option value="">Select account</option>
            {data.accounts.filter((account) => account.id).map((account) => <option key={account.id} value={account.id || ""}>{account.name}</option>)}
          </select>
        </FieldLabel>
        {needsDestination ? (
          <FieldLabel label={ruleType === "investment_transfer" ? "Investment Account" : "Loan Account"}>
            <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
              <option value="">Select account</option>
              {destinationAccounts.map((account) => <option key={account.id} value={account.id || ""}>{account.name}</option>)}
            </select>
          </FieldLabel>
        ) : null}
        <div className="form-grid-2">
          <FieldLabel label="Day">
            <input value={dayOfMonth} inputMode="numeric" onChange={(event) => setDayOfMonth(event.target.value)} />
          </FieldLabel>
          <FieldLabel label="Active">
            <select value={active ? "yes" : "no"} onChange={(event) => setActive(event.target.value === "yes")}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </FieldLabel>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          {rule ? "Save Rule" : "Add Rule"}
        </PendingButton>
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
  onSave: (tx: TransactionFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<"income" | "expense" | "transfer">(editTx?.transferGroupId ? "transfer" : editTx?.kind === "transfer" ? "transfer" : editTx?.type ?? "expense");
  const [amount, setAmount] = useState(editTx ? String(editTx.amount / 100) : "");
  const [description, setDescription] = useState(editTx?.description ?? "");
  const [categoryId, setCategoryId] = useState(editTx?.categoryId ?? data.categories[0]?.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(editTx?.subcategoryId ?? "");
  const initialAccount = data.accounts.find((item) => item.id === editTx?.accountId);
  const [accountChoice, setAccountChoice] = useState(initialAccount?.accountKey || "");
  const initialToAccount = data.accounts.find((item) => item.id === editTx?.toAccountId);
  const [toAccountChoice, setToAccountChoice] = useState(initialToAccount?.accountKey || "");
  const [date, setDate] = useState(editTx?.date ?? new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");
  const saveAction = usePendingAction();
  const selectedCategory = data.categories.find((category) => category.id === categoryId);
  const selectedAccount = data.accounts.find((item) => item.accountKey === accountChoice);
  const toAccount = data.accounts.find((item) => item.accountKey === toAccountChoice);

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!description.trim() || !Number.isFinite(cents) || cents <= 0 || !date) {
      setError("Amount, description, and date are required.");
      return;
    }
    if (!selectedAccount?.id) {
      setError("Select an account.");
      return;
    }
    if (type === "transfer") {
      if (!toAccount?.id || toAccount.id === selectedAccount.id) {
        setError("Select a different destination account.");
        return;
      }
      const fromAccountId = selectedAccount.id;
      const toAccountId = toAccount.id;
      void saveAction.run(() => onSave({
        id: editTx?.id,
        sourceId: editTx?.sourceId,
        transferGroupId: editTx?.transferGroupId || undefined,
        type,
        amount: cents,
        accountId: fromAccountId,
        toAccountId,
        description: description.trim(),
        date
      }));
      return;
    }
    if (!categoryId) {
      setError("Select a category.");
      return;
    }
    void saveAction.run(() => onSave({
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
    }));
  }

  return (
    <BottomSheet title={editTx ? "Edit Transaction" : "Add Transaction"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="segmented">
          <button className={type === "expense" ? "active danger" : ""} type="button" onClick={() => setType("expense")}>Expense</button>
          <button className={type === "income" ? "active" : ""} type="button" onClick={() => setType("income")}>Income</button>
          <button className={type === "transfer" ? "active" : ""} type="button" onClick={() => setType("transfer")}>Transfer</button>
        </div>
        <FieldLabel label="Amount">
          <input value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => setAmount(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Description">
          <input value={description} placeholder="What was this for?" onChange={(event) => setDescription(event.target.value)} />
        </FieldLabel>
        {type !== "transfer" ? (
          <>
            <FieldLabel label="Category">
              <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSubcategoryId(""); }}>
                {data.categories.filter((category) => !category.hidden).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </FieldLabel>
            <FieldLabel label="Sub-category">
              <select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}>
                <option value="">None</option>
                {selectedCategory?.subcategories.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
              </select>
            </FieldLabel>
          </>
        ) : null}
        <FieldLabel label={type === "transfer" ? "From Account" : "Account"}>
          <select value={accountChoice} onChange={(event) => setAccountChoice(event.target.value)}>
            <option value="">Select account</option>
            {data.accounts.map((item) => (
              <option key={item.accountKey} value={item.accountKey}>
                {item.name}
              </option>
            ))}
          </select>
        </FieldLabel>
        {type === "transfer" ? (
          <FieldLabel label="To Account">
            <select value={toAccountChoice} onChange={(event) => setToAccountChoice(event.target.value)}>
              <option value="">Select account</option>
              {data.accounts.map((item) => (
                <option key={item.accountKey} value={item.accountKey}>
                  {item.name}
                </option>
              ))}
            </select>
          </FieldLabel>
        ) : null}
        <FieldLabel label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          {editTx ? "Save Changes" : "Add Transaction"}
        </PendingButton>
      </form>
    </BottomSheet>
  );
}

function BudgetModal({ data, categoryId, onSave, onClose }: { data: AppData; categoryId: string; onSave: (categoryId: string, amount: number) => Promise<void>; onClose: () => void }) {
  const category = data.categories.find((item) => item.id === categoryId);
  const [amount, setAmount] = useState(category?.budget ? String(category.budget / 100) : "");
  const [error, setError] = useState("");
  const saveAction = usePendingAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Enter a valid budget amount.");
      return;
    }
    void saveAction.run(() => onSave(categoryId, cents));
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
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          Set Budget
        </PendingButton>
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
  const isPositive = tx.type === "income";
  const label = tx.kind === "investment" ? "Investment" : tx.kind === "transfer" ? "Transfer" : isPositive ? "Income" : "Expense";
  return (
    <article className="transaction-card">
      <CategoryIcon category={category} />
      <div className="transaction-body">
        <strong>{tx.description}</strong>
        <span>{[category?.name || tx.categoryId, sub?.name].filter(Boolean).join(" › ")} · {formatDate(tx.date)}</span>
      </div>
      <div className="transaction-amount">
        <strong className={isPositive ? "positive-text" : "danger-text"}>{isPositive ? "+" : "-"}{money(tx.amount, tx.currency)}</strong>
        <span className={isPositive ? "positive-text" : "danger-text"}>
          {isPositive ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
          {label}
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
  onDelete: (tx: Transaction) => Promise<void>;
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

function buildAppData(summary: Summary | null, history?: RecentTransaction[]): AppData {
  if (!summary) return { categories: [], accounts: [], transactions: [] };
  const categoryMap = new Map<string, Category>();
  const storedCategories = new Map(summary.storedCategories.map((category) => [category.sourceKey, category]));
  const addCategory = (name: string, currency = DEFAULT_CURRENCY) => {
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
      subcategories: [],
      hidden: stored?.active === false
    };
    categoryMap.set(id, category);
    return category;
  };

  for (const item of summary.categories) addCategory(item.category, item.currency);
  for (const item of summary.budgets) addCategory(item.category, item.currency);
  for (const item of history || summary.recent) {
    if (item.category) addCategory(item.category, item.currency);
  }
  for (const stored of summary.storedCategories) addCategory(stored.sourceName);

  const sourceTransactions = history || summary.recent;
  const transactions = sourceTransactions.map((tx) => {
    const category = tx.category ? addCategory(tx.category, tx.currency) : null;
    const transfer = transferAccounts(tx, sourceTransactions);
    return {
      id: String(tx.id),
      sourceId: tx.id,
      amount: Math.abs(tx.amountCents),
      currency: tx.currency,
      type: tx.kind === "income" || tx.amountCents > 0 ? "income" : "expense",
      kind: tx.transferGroupId ? "transfer" : tx.kind,
      transferGroupId: tx.transferGroupId,
      categoryId: category?.id || "",
      subcategoryId: tx.subcategoryId === null || !category ? undefined : `${category.id}:stored-${tx.subcategoryId}`,
      accountId: transfer?.fromAccountId ?? tx.accountId,
      toAccountId: transfer?.toAccountId ?? null,
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

function money(cents: number, currency = DEFAULT_CURRENCY) {
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
  if (type === "loan") return "Loan";
  return "Other";
}

function recurringTypeLabel(type: RecurringRuleType) {
  if (type === "subscription") return "Subscription";
  if (type === "investment_transfer") return "Investment";
  return "Loan";
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
