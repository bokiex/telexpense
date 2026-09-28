"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { netWorthWithPortfolioValues } from "@/lib/finance";
import { formatAmount } from "@/lib/amountFormat";
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
  Trash2,
  TrendingDown,
  TrendingUp,
  Tv,
  Utensils,
  Wallet,
  X
} from "lucide-react";
import { displayTransferGroups, transferAccounts } from "@/lib/transfer";
import { THEME_BUDGET_CATEGORY_PREFIX, isThemeBudgetCategory, themeBudgetCategory } from "@/lib/budgetThemes";
import { PendingButton, usePendingAction } from "@/components/PendingButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress as UiProgress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type BudgetGroup = "Needs" | "Wants" | "Savings";
type TransactionType = "income" | "expense";
type AccountType = "cash" | "bank" | "card" | "investment" | "loan" | "other";
type RecurringRuleType = "subscription" | "investment_transfer" | "loan_payment";
type Tab = "home" | "transactions" | "accounts" | "budget";

type CategorySpend = {
  category: string;
  spentCents: number;
};

type SubcategorySpend = {
  category: string;
  subcategoryId: number;
  spentCents: number;
};

type Budget = {
  category: string;
  subcategoryId: number | null;
  budgetCents: number;
};

type RecentTransaction = {
  id: number;
  kind: "expense" | "income" | "investment" | "transfer";
  category: string | null;
  subcategoryId: number | null;
  accountId: number | null;
  transferGroupId: string | null;
  savingsAllocation?: boolean;
  transferFromAccountId: number | null;
  transferToAccountId: number | null;
  recurringRuleId: number | null;
  description: string;
  amountCents: number;
  occurredOn: string;
};

type BudgetHealth = {
  spentCents: number;
  ordinarySpentCents?: number;
  savingsAllocatedCents?: number;
  progressCents?: number;
  progressByGroup?: Record<BudgetGroup, number>;
  budgetCents: number;
  remainingCents: number;
  budgetUsed: number;
  daysLeft: number;
  dailySafeCents: number;
  projectedSpendCents: number;
};

type IncomeAllocation = {
  incomeCents: number;
  spentCents: number;
  savedCents: number;
  unallocatedCents: number;
};

type TrendPoint = { periodStart: string; spentCents: number };

type Summary = {
  user: {
    firstName: string | null;
    username: string | null;
  };
  month: string;
  categories: CategorySpend[];
  subcategories: SubcategorySpend[];
  budgets: Budget[];
  health: BudgetHealth;
  daily: { date: string; spentCents: number }[];
  incomeAllocation: IncomeAllocation;
  spendingTrend: { daily: TrendPoint[]; weekly: TrendPoint[]; monthly: TrendPoint[] };
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
  spentCents?: number;
};

type Category = {
  id: string;
  name: string;
  sourceName: string;
  group: BudgetGroup;
  color: string;
  icon: string;
  budget?: number;
  spentCents?: number;
  subcategories: SubCategory[];
  hidden?: boolean;
};

type Transaction = {
  id: string;
  sourceId: number;
  amount: number;
  type: TransactionType;
  kind: RecentTransaction["kind"];
  transferGroupId: string | null;
  savingsAllocation?: boolean;
  categoryId: string;
  subcategoryId?: string;
  accountId?: number | null;
  toAccountId?: number | null;
  description: string;
  date: string;
};

type TransactionFormValues =
  | (Omit<Transaction, "id" | "sourceId" | "kind" | "transferGroupId" | "toAccountId"> & { id?: string; sourceId?: number; type: TransactionType })
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
       savingsAllocation: boolean;
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
};

type RecurringRule = {
  id: number;
  name: string;
  ruleType: RecurringRuleType;
  amountCents: number;
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
};

type ModalState =
  | { type: "none" }
  | { type: "add-transaction"; categoryId?: string; repeat?: Transaction }
  | { type: "edit-transaction"; tx: Transaction }
  | { type: "add-account" }
  | { type: "edit-account"; account: Account }
  | { type: "portfolio-snapshot"; account: Account }
  | { type: "add-recurring-rule" }
  | { type: "edit-recurring-rule"; rule: RecurringRule }
  | { type: "add-category" }
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
const ACCOUNT_TYPES: AccountType[] = ["cash", "bank", "card", "investment", "loan", "other"];
const RECURRING_TYPES: RecurringRuleType[] = ["subscription", "investment_transfer", "loan_payment"];
const THEME_TARGET_PREFIX = "theme:";

async function fetchHistoryPage(month: string, cursor: HistoryPage["nextCursor"], errorMessage: string): Promise<HistoryPage> {
  const query = new URLSearchParams({ month, limit: "50" });
  if (cursor) {
    query.set("beforeDate", cursor.beforeDate);
    query.set("beforeId", String(cursor.beforeId));
  }
  const response = await apiRequest(`/api/transactions/history?${query}`, "GET");
  if (!response.ok) throw new Error(errorMessage);
  return (await response.json()) as HistoryPage;
}

export default function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState<RecentTransaction[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<HistoryPage["nextCursor"]>(null);
  const [historyPageCount, setHistoryPageCount] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRetryKey, setHistoryRetryKey] = useState(0);
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
      const hasCurrentSummary = summary?.month === month;
      setLoading(!hasCurrentSummary);
      setSummaryRefreshing(hasCurrentSummary);
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
        if (!ignore) {
          setLoading(false);
          setSummaryRefreshing(false);
        }
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
      setHistoryPageCount(0);
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const page = await fetchHistoryPage(month, null, "Could not load transaction history.");
        if (!ignore && historyRequestVersion.current === requestVersion) {
          setHistory(page.items);
          setHistoryCursor(page.nextCursor);
          setHistoryPageCount(1);
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
  }, [activeTab, month, historyRetryKey]);

  useEffect(() => {
    if (activeTab !== "transactions" || !refreshKey || !history) return;
    let ignore = false;
    const requestVersion = ++historyRequestVersion.current;
    async function refreshHistory() {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const pagesToRefresh = Math.max(1, historyPageCount);
        const items: RecentTransaction[] = [];
        let cursor: HistoryPage["nextCursor"] = null;
        let pagesFetched = 0;
        do {
          const page = await fetchHistoryPage(month, cursor, "Could not refresh transaction history.");
          items.push(...page.items);
          cursor = page.nextCursor;
          pagesFetched += 1;
        } while (pagesFetched < pagesToRefresh && cursor);
        if (!ignore && historyRequestVersion.current === requestVersion) {
          setHistory(items);
          setHistoryCursor(cursor);
          setHistoryPageCount(pagesFetched);
        }
      } catch (refreshError) {
        if (!ignore && historyRequestVersion.current === requestVersion) {
          setHistoryError(refreshError instanceof Error ? refreshError.message : "Could not refresh transaction history.");
        }
      } finally {
        if (!ignore && historyRequestVersion.current === requestVersion) setHistoryLoading(false);
      }
    }
    refreshHistory();
    return () => {
      ignore = true;
      if (historyRequestVersion.current === requestVersion) historyRequestVersion.current += 1;
    };
  }, [refreshKey]);

  const data = useMemo(() => buildAppData(summary), [summary]);
  const historyData = useMemo(
    () => buildAppData(summary, history || summary?.recent),
    [history, summary]
  );
  const reload = () => {
    historyRequestVersion.current += 1;
    if (activeTab === "transactions" && history === null) setHistoryRetryKey((value) => value + 1);
    setRefreshKey((value) => value + 1);
  };

  const retryHistory = () => {
    historyRequestVersion.current += 1;
    setHistoryRetryKey((value) => value + 1);
  };

  async function loadMoreHistory() {
    if (!historyCursor || historyLoading) return;
    const requestVersion = historyRequestVersion.current;
    const requestMonth = month;
    const requestCursor = historyCursor;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const page = await fetchHistoryPage(requestMonth, requestCursor, "Could not load more transactions.");
      if (historyRequestVersion.current !== requestVersion) return;
      setHistory((current) => [...(current || []), ...page.items]);
      setHistoryCursor(page.nextCursor);
      setHistoryPageCount((current) => current + 1);
    } catch (loadError) {
      if (historyRequestVersion.current === requestVersion) {
        setHistoryError(loadError instanceof Error ? loadError.message : "Could not load more transactions.");
      }
    } finally {
      if (historyRequestVersion.current === requestVersion) setHistoryLoading(false);
    }
  }

  async function saveTransaction(tx: TransactionFormValues): Promise<boolean> {
    if (tx.type === "transfer") {
      const fromAccount = data.accounts.find((item) => item.id === tx.accountId);
      const toAccount = data.accounts.find((item) => item.id === tx.toAccountId);
      const path = tx.transferGroupId ? `/api/transfers/${tx.transferGroupId}` : "/api/transfers";
      const response = await apiRequest(path, tx.transferGroupId ? "PATCH" : "POST", {
        fromAccountId: fromAccount?.id,
        toAccountId: toAccount?.id,
        description: tx.description,
        amountCents: tx.amount,
        occurredOn: tx.date,
        savingsAllocation: tx.savingsAllocation
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error || "Could not save transfer.");
        return false;
      }
      setModal({ type: "none" });
      reload();
      return true;
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
      occurredOn: tx.date
    };
    const path = tx.sourceId ? `/api/transactions/${tx.sourceId}` : "/api/transactions";
    const response = await apiRequest(path, tx.sourceId ? "PATCH" : "POST", body);
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save transaction.");
      return false;
    }
    setModal({ type: "none" });
    reload();
    return true;
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

  async function saveBudget(categoryId: string, amount: number, subcategoryId?: string) {
    const theme = themeFromTarget(categoryId);
    if (theme) {
      const response = await apiRequest("/api/budgets", "POST", {
        category: themeBudgetCategory(theme),
        month,
        amountCents: amount,
        subcategoryId: null
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error || "Could not save budget.");
        return;
      }
      setModal({ type: "none" });
      reload();
      return;
    }
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const storedSubcategoryId = storedSubcategoryNumber(subcategoryId);
    const response = await apiRequest("/api/budgets", "POST", {
      category: category.sourceName,
      month,
      amountCents: amount,
      subcategoryId: storedSubcategoryId
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not save budget.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function deleteBudgetTarget(categoryId: string, subcategoryId?: string) {
    const theme = themeFromTarget(categoryId);
    if (theme) {
      const params = new URLSearchParams({ category: themeBudgetCategory(theme), month });
      const response = await apiRequest(`/api/budgets?${params.toString()}`, "DELETE");
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error || "Could not delete budget.");
        return;
      }
      setModal({ type: "none" });
      reload();
      return;
    }
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const params = new URLSearchParams({ category: category.sourceName, month });
    const storedId = storedSubcategoryNumber(subcategoryId);
    if (storedId !== null) params.set("subcategoryId", String(storedId));
    const response = await apiRequest(`/api/budgets?${params.toString()}`, "DELETE");
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error || "Could not delete budget.");
      return;
    }
    setModal({ type: "none" });
    reload();
  }

  async function saveCategory(categoryId: string | null, values: { name: string; group: BudgetGroup; color: string; icon: string; budgetCents: number }) {
    const category = categoryId ? data.categories.find((item) => item.id === categoryId) : null;
    const sourceKey = category?.id || slug(values.name);
    const sourceName = category?.sourceName || values.name.toLowerCase();
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
    { id: "home", label: "Add", icon: <Plus size={20} /> },
    { id: "transactions", label: "History", icon: <List size={20} /> },
    { id: "budget", label: "Budget", icon: <PieChart size={20} /> },
    { id: "accounts", label: "Accounts", icon: <Wallet size={20} /> }
  ];

  return (
    <main className="mini-root">
      <section className="phone-frame" aria-label="Telexpense mini app" aria-hidden={modal.type !== "none" || undefined} inert={modal.type !== "none" || undefined}>
        <header className="mini-header">
          <div>
            <p className="eyebrow">{headerTitle(activeTab, summary?.user)}</p>
            {activeTab !== "home" ? <p className="header-date">{new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p> : null}
          </div>
          <input className="mini-month" id="dashboard-month" name="month" type="month" value={month} aria-label="Month" onChange={(event) => setMonth(event.target.value || month)} />
        </header>

        {error ? <div className="mini-error" role="alert">{friendlyError(error)} <Button variant="link" onClick={reload}>Retry</Button></div> : null}

        <div className="mini-content" aria-busy={summaryRefreshing || undefined}>
          {summaryRefreshing ? <div className="refresh-status" role="status">Updating dashboard</div> : null}
          {loading ? <DashboardSkeleton /> : null}
          {!loading && activeTab === "home" ? (
            <HomeView
              data={data}
              summary={summary}
              balanceVisible={balanceVisible}
              onToggleBalance={() => setBalanceVisible((value) => !value)}
              onViewAllTransactions={() => setActiveTab("transactions")}
              onSaveTransaction={saveTransaction}
              onRepeat={(tx) => setModal({ type: "add-transaction", repeat: tx })}
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
              onRetry={retryHistory}
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
          {!loading && activeTab === "budget" ? (
            <BudgetView
              data={data}
              month={month}
              summary={summary}
              onViewHistory={() => setActiveTab("transactions")}
              onSetBudget={(categoryId, subcategoryId) => setModal({ type: "set-budget", categoryId, subcategoryId })}
              onAddCategory={() => setModal({ type: "add-category" })}
              onEditCategory={(categoryId) => setModal({ type: "edit-category", categoryId })}
              onAddSubcategory={(categoryId) => setModal({ type: "add-subcategory", categoryId })}
              onDeleteCategory={deleteCategory}
            />
          ) : null}
        </div>

        <nav className="bottom-tabs" aria-label="App sections">
          {tabs.map((tab) => (
            <Button key={tab.id} className={activeTab === tab.id ? "active" : ""} variant="ghost" aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => setActiveTab(tab.id)}>
              {tab.icon}
              <span>{tab.label}</span>
            </Button>
          ))}
        </nav>
      </section>

      {modal.type === "add-transaction" || modal.type === "edit-transaction" ? (
        <TransactionModal
          data={data}
          editTx={modal.type === "edit-transaction" ? modal.tx : null}
          defaultCategoryId={modal.type === "add-transaction" ? modal.categoryId : undefined}
          repeatTx={modal.type === "add-transaction" ? modal.repeat : undefined}
          onSave={async (tx) => { await saveTransaction(tx); }}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "set-budget" ? (
        <BudgetModal
          data={data}
          summary={summary}
          categoryId={modal.categoryId}
          subcategoryId={modal.subcategoryId}
          onSave={saveBudget}
          onDelete={deleteBudgetTarget}
          onClose={() => setModal({ type: "none" })}
        />
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
          onSave={saveCategory}
          onClose={() => setModal({ type: "none" })}
        />
      ) : null}

      {modal.type === "add-category" ? (
        <CategoryModal
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
  onSaveTransaction,
  onRepeat
}: {
  data: AppData;
  summary: Summary | null;
  balanceVisible: boolean;
  onToggleBalance: () => void;
  onViewAllTransactions: () => void;
  onSaveTransaction: (tx: TransactionFormValues) => Promise<boolean>;
  onRepeat: (tx: Transaction) => void;
}) {
  const fallbackSpent = data.transactions.filter((tx) => tx.kind === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = summary?.health.ordinarySpentCents ?? summary?.health.spentCents ?? fallbackSpent;
  const budgetProgress = summary?.health.progressCents ?? totalExpense + (summary?.health.savingsAllocatedCents ?? 0);
  const totalBudget = effectiveBudgetTotalWithThemes(data.categories.filter((category) => !category.hidden), summary);
  const budgetLeft = totalBudget - budgetProgress;
  const recent = data.transactions.slice(0, 5);

  return (
    <div className="screen-stack capture-home">
      <section className="spending-hero">
        <p className="eyebrow">This month's spending</p>
        <strong>{balanceVisible ? money(totalExpense) : "••••••"}</strong>
        <span>{totalBudget ? `${money(Math.abs(budgetLeft))} ${budgetLeft < 0 ? "over your set budgets" : "left across your set budgets"}` : "Set a budget to track your spending"}</span>
        <Button className="hero-visibility" variant="ghost" onClick={onToggleBalance} aria-label="Toggle spending visibility">
          {balanceVisible ? <Eye size={16} /> : <EyeOff size={16} />}
        </Button>
      </section>

      <QuickCapture data={data} summary={summary} onSave={onSaveTransaction} onViewHistory={onViewAllTransactions} />

       <section>
        <div className="section-line">
          <h2>Repeat a recent entry</h2>
           <Button className="link-button" variant="ghost" onClick={onViewAllTransactions}>
             Past entries <ChevronRight size={13} />
           </Button>
         </div>
         <div className="recent-strip">
           {recent.length ? recent.map((tx) => <RepeatCard key={tx.id} tx={tx} data={data} onClick={() => onRepeat(tx)} />) : <EmptyState label="No transactions yet" />}
        </div>
      </section>

    </div>
  );
}

function QuickCapture({ data, summary, onSave, onViewHistory }: { data: AppData; summary: Summary | null; onSave: (tx: TransactionFormValues) => Promise<boolean>; onViewHistory: () => void }) {
  const categories = data.categories.filter((category) => !category.hidden);
  const [type, setType] = useState<TransactionType | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [accountKey, setAccountKey] = useState(data.accounts[0]?.accountKey || "");
  const [toAccountKey, setToAccountKey] = useState("");
  const [date, setDate] = useState(localDate);
  const [savingsAllocation, setSavingsAllocation] = useState(false);
  const [error, setError] = useState("");
  const saveAction = usePendingAction();
  const category = categories.find((item) => item.id === categoryId);
  const account = data.accounts.find((item) => item.accountKey === accountKey);
  const toAccount = data.accounts.find((item) => item.accountKey === toAccountKey);
  const spent = category ? spentForCategory(data, category.id) : 0;
  const remaining = category?.budget === undefined ? null : category.budget - spent;

  function selectType(nextType: TransactionType | "transfer") {
    setType(nextType);
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || !date || !account?.id) {
      setError("Enter an amount and choose an account.");
      return;
    }
    if (type === "transfer") {
      if (!toAccount?.id || toAccount.id === account.id) {
        setError("Choose a different destination account.");
        return;
      }
      void saveAction.run(async () => {
        if (await onSave({ type, amount: cents, accountId: account.id!, toAccountId: toAccount.id!, description: description.trim() || "Transfer", date, savingsAllocation })) {
          setAmount("");
          setDescription("");
        }
      });
      return;
    }
    if (!category) {
      setError("Choose a category.");
      return;
    }
    void saveAction.run(async () => {
      if (await onSave({ type, amount: cents, categoryId: category.id, subcategoryId: subcategoryId || undefined, accountId: account.id, description: description.trim() || category.name, date })) {
        setAmount("");
        setDescription("");
      }
    });
  }

  return <Card className="quick-capture">
    <div className="section-line"><h1>Add {capitalize(type)}</h1><Button className="link-button" variant="ghost" onClick={onViewHistory}>Past entries</Button></div>
    <form className="capture-form" onSubmit={submit}>
      <label className="capture-label"><span>Amount</span><small>SGD</small><Input id="quick-amount" name="amount" value={amount} inputMode="decimal" placeholder="0.00" aria-label="Amount" onChange={(event) => setAmount(event.target.value)} /></label>
      <ToggleGroup className="capture-type" type="single" value={type} onValueChange={(value) => { if (value) selectType(value as typeof type); }} aria-label="Transaction type">
        {(["expense", "income", "transfer"] as const).map((item) => <ToggleGroupItem key={item} value={item} className={item === "expense" ? "danger" : undefined}>{capitalize(item)}</ToggleGroupItem>)}
      </ToggleGroup>
      {type !== "transfer" ? <>
           <div className="quick-category-list" aria-label="Choose category">
           {categories.map((item) => { const Icon = iconFor(item.icon); const itemRemaining = item.budget === undefined ? null : item.budget - spentForCategory(data, item.id); return <Button key={item.id} className={categoryId === item.id ? "selected" : ""} variant="ghost" onClick={() => { setCategoryId(item.id); setSubcategoryId(""); }} aria-pressed={categoryId === item.id}><Icon size={18} /><strong className="quick-picker-name">{item.name}</strong>{itemRemaining !== null ? <small>{money(Math.max(0, itemRemaining))} left</small> : null}</Button>; })}
         </div>
         {category?.subcategories.length ? <div className="quick-subcategory-list" aria-label={`${category.name} subcategories`}>
          {category.subcategories.map((item) => <Button key={item.id} className={subcategoryId === item.id ? "selected" : ""} variant="ghost" onClick={() => setSubcategoryId(item.id)} aria-pressed={subcategoryId === item.id}><strong className="quick-picker-name">{item.name}</strong>{item.budget !== undefined ? <small>{money(Math.max(0, item.budget - spentForSubcategory(data, item.id)))} left</small> : null}</Button>)}
        </div> : null}
      </> : null}
      <label className="capture-description"><span>What was this for? <small>Optional</small></span><Input id="quick-description" name="description" value={description} placeholder="Toast Box, groceries..." onChange={(event) => setDescription(event.target.value)} /></label>
      <div className={type === "transfer" ? "capture-meta transfer-meta" : "capture-meta"}>
         <label><span>{type === "transfer" ? "From" : "Account"}</span><select id="quick-account" name="account" value={accountKey} onChange={(event) => setAccountKey(event.target.value)}><option value="">Select account</option>{data.accounts.map((item) => <option key={item.accountKey} value={item.accountKey}>{item.name}</option>)}</select>{account ? <small>{money(Math.abs(account.balanceCents))} {isDebtAccount(account) ? "due" : "available"}</small> : null}</label>
        {type === "transfer" ? <label><span>To</span><select id="quick-to-account" name="toAccount" value={toAccountKey} onChange={(event) => setToAccountKey(event.target.value)}><option value="">Select account</option>{data.accounts.map((item) => <option key={item.accountKey} value={item.accountKey}>{item.name}</option>)}</select></label> : null}
         <label className="capture-date"><span>Date</span><input id="quick-date" name="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      {type === "transfer" ? <div className="savings-allocation"><div><strong>Count as savings</strong><small>Add this transfer to this month&apos;s income allocation.</small></div><Switch checked={savingsAllocation} onCheckedChange={setSavingsAllocation} aria-label="Count transfer as savings" /></div> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">Save {type} {remaining !== null && type === "expense" ? <small>{category?.name} has {money(Math.max(0, remaining))} left</small> : null}</PendingButton>
    </form>
  </Card>;
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
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType | "transfer">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const transactionToDelete = data.transactions.find((transaction) => transaction.id === deleteConfirm) || null;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.transactions.filter((tx) => {
      const category = data.categories.find((item) => item.id === tx.categoryId);
      const account = data.accounts.find((item) => item.id === tx.accountId);
      if (typeFilter === "transfer" ? tx.kind !== "transfer" : typeFilter !== "all" && tx.type !== typeFilter) return false;
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
      <ToggleGroup className="history-filter" type="single" value={typeFilter} onValueChange={(value) => { if (value) setTypeFilter(value as typeof typeFilter); }} aria-label="Transaction type">
        {(["all", "expense", "income", "transfer"] as const).map((item) => <ToggleGroupItem key={item} value={item} className={item === "expense" ? "danger" : undefined}>{capitalize(item)}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="search-row">
        <label className="search-box">
          <Search size={15} />
          <Input id="transaction-search" name="search" value={search} placeholder="Search transactions" aria-label="Search transactions" onChange={(event) => setSearch(event.target.value)} />
          {search ? (
            <Button variant="ghost" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={13} />
            </Button>
          ) : null}
        </label>
        <Button className={showFilters ? "filter-button active" : "filter-button"} variant="ghost" onClick={() => setShowFilters((value) => !value)} aria-label="Toggle filters" aria-expanded={showFilters} aria-controls="transaction-filters">
          <Filter size={16} />
          {activeFilters ? <span>{activeFilters}</span> : null}
        </Button>
      </div>

      {showFilters ? (
        <div id="transaction-filters" className="filter-panel">
          <FieldLabel label="Category">
             <select id="transaction-category" name="category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
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
                  <TransactionCard tx={tx} data={data} actions={<RowActions tx={tx} onEdit={onEdit} onToggleDelete={setDeleteConfirm} />} />
                </div>
              ))}
            </section>
          ))
        ) : <EmptyState label={`No transactions found for ${month}`} />}
      </div>

      {error ? <div className="mini-error" role="alert">{error} <Button variant="link" onClick={onRetry}>Retry</Button></div> : null}
      {hasMore || loading ? (
        <PendingButton className="link-button" type="button" pending={loading} pendingLabel="Loading…" onAction={onLoadMore}>
          Load more
        </PendingButton>
      ) : null}

      <ConfirmDialog
        open={Boolean(transactionToDelete)}
        title="Delete transaction?"
        description={transactionToDelete ? `Delete ${transactionToDelete.description} for ${money(transactionToDelete.amount)}? This cannot be undone.` : ""}
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        pending={deleting}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteConfirm(null); }}
        onConfirm={() => {
          if (!transactionToDelete || deleting) return;
          setDeleting(true);
          void onDelete(transactionToDelete).finally(() => { setDeleting(false); setDeleteConfirm(null); });
        }}
      />

        <Button className="primary-action" onClick={onAdd}>
          <Plus size={16} /> Add Transaction
        </Button>
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
  const netWorthTotal = netWorthWithPortfolioValues(accounts, snapshots);

  return (
    <div className="screen-stack">
       <section className="net-worth-card">
         <p>Net worth</p>
        <div className="account-total-list">
          <strong>{money(netWorthTotal)}</strong>
        </div>
      </section>

       <section className="account-list">
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
              <strong>{isDebtAccount(account) ? money(Math.max(0, -account.balanceCents)) : money(account.balanceCents)}</strong>
              <span>{isDebtAccount(account) ? "Original debt" : "Opening"} {money(isDebtAccount(account) ? Math.abs(account.openingBalanceCents) : account.openingBalanceCents)}</span>
            </div>
            <div className="card-actions">
              {account.accountType === "investment" ? (
                <Button variant="icon" onClick={() => onSetSnapshot(account)} aria-label={`Set ${account.name} portfolio value`}>
                  <TrendingUp size={12} />
                </Button>
              ) : null}
              <Button variant="icon" onClick={() => onEditAccount(account)} aria-label={`Edit ${account.name}`}>
                <Pencil size={12} />
              </Button>
            </div>
            {account.accountType === "investment" ? <InvestmentAccountDetail account={account} snapshot={snapshots.find((item) => item.accountId === account.id)} /> : null}
          </article>
        )) : <EmptyState label="No accounts yet" />}
      </section>

      <Button className="primary-action" onClick={onAddAccount}>
        <Plus size={16} /> Add Account
      </Button>

      <section>
        <div className="section-line">
          <p className="eyebrow">Monthly Rules</p>
          <Button className="link-button" variant="ghost" onClick={onAddRecurringRule}>
            <Plus size={13} /> Add
          </Button>
        </div>
        <div className="row-stack">
          {recurringRules.length ? recurringRules.map((rule) => (
            <article key={rule.id} className="recurring-card">
              <div className="account-icon">
                <Repeat size={17} />
              </div>
              <div className="account-copy">
                <strong>{rule.name}</strong>
                <span>{recurringRuleDetail(rule, accounts)}</span>
              </div>
              <div className="account-balance">
                <strong>{money(rule.amountCents)}</strong>
                <span>{rule.active ? "Active" : "Inactive"}</span>
              </div>
              <div className="card-actions">
                <Button variant="icon" onClick={() => onEditRecurringRule(rule)} aria-label={`Edit ${rule.name}`}>
                  <Pencil size={12} />
                </Button>
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
        <ValueLine label="Portfolio value" value="No value yet" />
        <ValueLine label="Contributions" value={money(Math.max(0, account.balanceCents))} />
      </div>
    );
  }
  return (
    <div className="account-detail">
      <ValueLine label="Portfolio value" value={money(snapshot.portfolioValueCents)} />
      <ValueLine label="Total contributions" value={money(snapshot.contributionCents)} />
      <ValueLine label="This month contributions" value={money(snapshot.monthlyContributionCents)} />
      <ValueLine
        label="Market movement"
        value={`${snapshot.marketGainLossCents >= 0 ? "+" : "-"}${money(Math.abs(snapshot.marketGainLossCents))}`}
        positive={snapshot.marketGainLossCents >= 0}
        danger={snapshot.marketGainLossCents < 0}
      />
      {snapshot.contributionCents > 0 ? <ValueLine label="Return" value={`${((snapshot.marketGainLossCents / snapshot.contributionCents) * 100).toFixed(1)}%`} positive={snapshot.marketGainLossCents >= 0} danger={snapshot.marketGainLossCents < 0} /> : null}
    </div>
  );
}

function BudgetView({
  data,
  month,
  summary,
  onViewHistory,
  onSetBudget,
  onAddCategory,
  onEditCategory,
  onAddSubcategory,
  onDeleteCategory
}: {
  data: AppData;
  month: string;
  summary: Summary | null;
  onViewHistory: () => void;
  onSetBudget: (categoryId: string, subcategoryId?: string) => void;
  onAddCategory: () => void;
  onEditCategory: (categoryId: string) => void;
  onAddSubcategory: (categoryId: string) => void;
  onDeleteCategory: (categoryId: string) => Promise<void>;
}) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeCategories = data.categories.filter((category) => !category.hidden);
  const categoryToDelete = activeCategories.find((category) => category.id === deleteConfirm) || null;
  const totalBudget = effectiveBudgetTotalWithThemes(activeCategories, summary);
  const fallbackSpent = data.transactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const ordinarySpent = summary?.health.ordinarySpentCents ?? summary?.health.spentCents ?? fallbackSpent;
  const savingsAllocated = summary?.health.savingsAllocatedCents ?? 0;
  const budgetProgress = summary?.health.progressCents ?? ordinarySpent + savingsAllocated;
  const budgetLeft = totalBudget - budgetProgress;
  const progressByGroup = budgetProgressByGroup(activeCategories, data, summary);
  const budgetByGroup = GROUPS.reduce((totals, group) => {
    const categories = activeCategories.filter((category) => category.group === group);
    totals[group] = themeBudget(summary, group) ?? effectiveBudgetTotal(categories);
    return totals;
  }, { Needs: 0, Wants: 0, Savings: 0 } as Record<BudgetGroup, number>);
  const budgetChartBackground = pieGradient(
    GROUPS.map((group) => ({ value: budgetByGroup[group], color: GROUP_COLORS[group] })),
    totalBudget,
    "#43504a"
  );
  const hasBudgetTargets = GROUPS.some((group) => themeBudget(summary, group) !== undefined)
    || activeCategories.some((category) => category.budget !== undefined || category.subcategories.some((subcategory) => subcategory.budget !== undefined));
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  return (
    <div className="screen-stack">
      <section className="budget-command-center budget-chart-card" aria-labelledby="budget-command-center-title">
        <div className="budget-score-panel">
          <div
            className="budget-score-ring"
            style={{ background: budgetChartBackground }}
            role="img"
            aria-label={`Budget split: ${GROUPS.map((group) => `${group} ${money(budgetByGroup[group])}`).join(", ")}`}
          >
            <div className="budget-score-ring-center">
              <strong>{totalBudget ? money(totalBudget) : "—"}</strong>
              <span>total budget</span>
            </div>
          </div>
          <div className="budget-score-copy">
            <p className="budget-score-period">{monthLabel(month)} budget</p>
            <h1 id="budget-command-center-title">{totalBudget ? budgetLeft < 0 ? `${money(Math.abs(budgetLeft))} over budget` : `${money(budgetLeft)} available` : "Set a budget"}</h1>
            <small>{totalBudget ? `${money(budgetProgress)} of ${money(totalBudget)} used or allocated` : "Add a budget target to start tracking this month"}</small>
            {summary ? <small>{summary.health.daysLeft} days remaining</small> : null}
          </div>
        </div>
        <div className="budget-chart-legend" role="list" aria-label="Budget split by group">
          {GROUPS.map((group) => {
            const groupBudget = budgetByGroup[group];
            const groupPct = totalBudget ? Math.round((groupBudget / totalBudget) * 100) : 0;
            return (
              <div key={group} className="budget-chart-legend-row" role="listitem">
                <span><i style={{ backgroundColor: GROUP_COLORS[group] }} />{group}</span>
                <strong>{money(groupBudget)}</strong>
                <small>{groupPct}%</small>
              </div>
            );
          })}
        </div>
        <div className="budget-stat-grid">
          <div className="budget-stat"><small>Set budget</small><strong>{money(totalBudget)}</strong></div>
          <div className="budget-stat"><small>Ordinary spend</small><strong>{money(ordinarySpent)}</strong></div>
          <div className="budget-stat"><small>Saved / invested</small><strong>{money(savingsAllocated)}</strong></div>
        </div>
      </section>

      <IncomeAllocationCard allocation={summary?.incomeAllocation || { incomeCents: 0, spentCents: 0, savedCents: 0, unallocatedCents: 0 }} />

      {summary?.spendingTrend.daily.length ? <SpendingTrend trend={summary.spendingTrend} onViewHistory={onViewHistory} /> : null}

      <section className="mini-card budget-breakdown-card" aria-label="Budget breakdown">
        <div className="section-line budget-breakdown-heading">
          <div>
            <p className="eyebrow">Budget breakdown</p>
          </div>
          <button className="inline-add" type="button" onClick={onAddCategory}>
            <Plus size={14} /> Add Category
          </button>
        </div>
        {GROUPS.map((group) => {
          const categories = activeCategories.filter((category) => category.group === group);
          const groupBudget = budgetByGroup[group];
          const groupActivity = progressByGroup[group];
          const groupPctRaw = groupBudget ? Math.round((groupActivity / groupBudget) * 100) : 0;
          const groupPct = Math.min(100, Math.max(0, groupPctRaw));
          return (
            <div key={group} className="budget-group-section">
              <div className="group-head">
                <div className="group-icon" style={{ color: GROUP_COLORS[group], backgroundColor: `${GROUP_COLORS[group]}22` }}>
                  {group === "Needs" ? <Home size={16} /> : group === "Wants" ? <ShoppingBag size={16} /> : <Wallet size={16} />}
                </div>
                <div>
                  <strong>{group}</strong>
                  <Progress label={`${group} budget ${groupPctRaw}% used`} value={groupPct} color={groupPctRaw > 90 ? "#f87171" : GROUP_COLORS[group]} />
                </div>
                <span>{groupBudget ? `${money(groupActivity)} / ${money(groupBudget)} · ${groupPctRaw}%` : money(groupActivity)}</span>
                <Button className="tiny-icon" variant="icon" onClick={() => onSetBudget(themeTarget(group))} aria-label={`Set ${group} budget`}>
                  <Pencil size={11} />
                </Button>
              </div>
              <div className="nested-list">
                {categories.length ? categories.map((category) => {
                  const spent = spentForCategory(data, category.id);
                  const pct = category.budget ? Math.max(0, Math.round((spent / category.budget) * 100)) : 0;
                  const childBudget = category.subcategories.reduce((sum, subcategory) => sum + (subcategory.budget || 0), 0);
                  const isExpanded = expandedCategories.has(category.id);
                  const childListId = `budget-subcategories-${category.id}`;
                  return (
                    <div key={category.id} className="budget-category-block">
                      <div className="budget-row budget-row-parent">
                        <div className="budget-row-leading">
                          {category.subcategories.length ? (
                            <button
                              className="tiny-icon collapse-toggle"
                              type="button"
                              onClick={() => toggleCategory(category.id)}
                              aria-expanded={isExpanded}
                              aria-controls={childListId}
                              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${category.name} subcategories`}
                            >
                              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          ) : <span className="collapse-spacer" aria-hidden="true" />}
                          <CategoryIcon category={category} />
                        </div>
                        <div className="budget-row-content">
                          <div className="budget-row-top">
                            <div className="budget-row-label">
                              <strong>{category.name}</strong>
                              <small>{category.subcategories.length ? `${category.subcategories.length} subcategories` : "Category budget"}</small>
                            </div>
                            <span className="budget-row-amount">{budgetRowAmount(spent, category.budget)} · {pct}%</span>
                            <Button className="tiny-icon" variant="icon" onClick={() => onSetBudget(category.id)} aria-label={`Set ${category.name} budget`}>
                              <Pencil size={11} />
                            </Button>
                          </div>
                          <Progress label={`${category.name} budget ${pct}% used`} value={pct} color={pct > 90 ? "#f87171" : category.color} thin />
                        </div>
                      </div>
                      <div className="budget-management-row" aria-label={`${category.name} category management`}>
                        <button type="button" onClick={() => onEditCategory(category.id)} aria-label={`Edit ${category.name}`}>
                          <Pencil size={11} />
                          Edit
                        </button>
                        <button type="button" onClick={() => onAddSubcategory(category.id)} aria-label={`Add subcategory to ${category.name}`}>
                          <Plus size={11} />
                          Subcategory
                        </button>
                        <button className="danger" type="button" onClick={() => setDeleteConfirm(deleteConfirm === category.id ? null : category.id)} aria-label={`Delete ${category.name}`}>
                          <Trash2 size={11} />
                          Delete
                        </button>
                      </div>
                      {category.subcategories.length && isExpanded ? (
                        <div className="subcategory-budget-list" id={childListId}>
                          {category.subcategories.map((subcategory) => {
                            const subSpent = spentForSubcategory(data, subcategory.id);
                            const subPct = subcategory.budget ? Math.max(0, Math.round((subSpent / subcategory.budget) * 100)) : 0;
                            return (
                              <div key={subcategory.id} className="budget-row budget-row-child">
                                <div className="budget-row-leading">
                                  <span className="subcategory-marker" aria-hidden="true" />
                                </div>
                                <div className="budget-row-content">
                                  <div className="budget-row-top">
                                    <div className="budget-row-label">
                                      <strong>{subcategory.name}</strong>
                                      <small>Subcategory budget</small>
                                    </div>
                                    <span className="budget-row-amount">{budgetRowAmount(subSpent, subcategory.budget)} · {subPct}%</span>
                                    <Button className="tiny-icon" variant="icon" onClick={() => onSetBudget(category.id, subcategory.id)} aria-label={`Set ${subcategory.name} budget`}>
                                      <Pencil size={11} />
                                    </Button>
                                  </div>
                                  <Progress label={`${subcategory.name} budget ${subPct}% used`} value={subPct} color={subPct > 90 ? "#f87171" : category.color} thin />
                                </div>
                              </div>
                            );
                          })}
                          {category.budget === undefined && childBudget > 0 ? <small className="child-budget-note">Child targets total {money(childBudget)}</small> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                }) : <EmptyState label={`No ${group.toLowerCase()} categories yet`} />}
              </div>
            </div>
          );
        })}
      </section>

      {!hasBudgetTargets ? <EmptyState label="No budgets set for this month yet." /> : null}

      <ConfirmDialog
        open={Boolean(categoryToDelete)}
        title="Delete category?"
        description={categoryToDelete ? `Delete ${categoryToDelete.name} and its subcategories? Transactions remain, but this category can no longer be used.` : ""}
        confirmLabel="Delete category"
        pendingLabel="Deleting..."
        pending={deleting}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteConfirm(null); }}
        onConfirm={() => {
          if (!categoryToDelete || deleting) return;
          setDeleting(true);
          void onDeleteCategory(categoryToDelete.id).finally(() => { setDeleting(false); setDeleteConfirm(null); });
        }}
      />

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
                  <Progress label={`${loan.name} ${loan.payoffProgress}% paid`} value={loan.payoffProgress} color={loan.payoffProgress >= 100 ? "#4ade80" : "#60a5fa"} thin />
                </div>
                <div className="loan-values">
                  <span>{loan.payoffProgress}% paid</span>
                  <span>{money(Math.max(0, -loan.balanceCents))} left</span>
                  <span>{money(loan.repaymentThisMonthCents)} this month</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CategoryModal({
  category,
  onSave,
  onClose
}: {
  category?: Category;
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
          <Input value={name} placeholder="Category name" onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Budget Group">
          <ToggleGroup type="single" value={group} onValueChange={(value) => { if (value) setGroup(value as BudgetGroup); }} aria-label="Budget group">
            {GROUPS.map((item) => <ToggleGroupItem key={item} value={item}>{item}</ToggleGroupItem>)}
          </ToggleGroup>
        </FieldLabel>
        <FieldLabel label="Monthly Budget">
          <Input value={budget} inputMode="decimal" placeholder="0.00" onChange={(event) => setBudget(event.target.value)} />
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
              <Button key={item} className={icon === item ? "selected" : ""} variant="icon" aria-label={`Use ${iconLabel(item)} icon`} aria-pressed={icon === item} onClick={() => setIcon(item)}>
                <Icon size={18} />
              </Button>
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
        <FieldLabel label="Name"><Input value={name} placeholder="Sub-category name" autoFocus onChange={(event) => setName(event.target.value)} /></FieldLabel>
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
    color: string;
    icon: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name || "");
  const [institution, setInstitution] = useState(account?.institution || "");
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType || "bank");
  const [openingBalance, setOpeningBalance] = useState(account ? String((account.accountType === "loan" || account.accountType === "card" ? Math.abs(account.openingBalanceCents) : account.openingBalanceCents) / 100) : "0");
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
      color,
      icon
    }));
  }

  return (
    <BottomSheet title={account ? "Edit Account" : "Add Account"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <FieldLabel label="Name">
          <Input value={name} placeholder="Checking, Savings, Credit Card" onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Institution">
          <Input value={institution} placeholder="Bank name, optional" onChange={(event) => setInstitution(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Type">
          <ToggleGroup className="wrap" type="single" value={accountType} onValueChange={(value) => { if (value) setAccountType(value as AccountType); }} aria-label="Account type">
            {ACCOUNT_TYPES.map((item) => <ToggleGroupItem key={item} value={item}>{accountTypeLabel(item)}</ToggleGroupItem>)}
          </ToggleGroup>
        </FieldLabel>
        <div className="form-grid-2">
          <FieldLabel label={accountType === "loan" || accountType === "card" ? "Opening Debt" : "Opening Balance"}>
            <Input value={openingBalance} inputMode="decimal" onChange={(event) => setOpeningBalance(event.target.value)} />
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
              <Button key={item} className={icon === item ? "selected" : ""} variant="icon" aria-label={`Use ${iconLabel(item)} icon`} aria-pressed={icon === item} onClick={() => setIcon(item)}>
                <Icon size={18} />
              </Button>
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
        <FieldLabel label="Portfolio Value">
          <Input value={value} inputMode="decimal" placeholder="0.00" autoFocus onChange={(event) => setValue(event.target.value)} />
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
          <ToggleGroup className="wrap" type="single" value={ruleType} onValueChange={(value) => { if (value) { setRuleType(value as RecurringRuleType); setToAccountId(""); } }} aria-label="Recurring rule type">
            {RECURRING_TYPES.map((item) => <ToggleGroupItem key={item} value={item}>{recurringTypeLabel(item)}</ToggleGroupItem>)}
          </ToggleGroup>
        </FieldLabel>
        <FieldLabel label="Name">
          <Input value={name} placeholder="Netflix, monthly ETF, loan payment" onChange={(event) => setName(event.target.value)} />
        </FieldLabel>
        <div className="form-grid-2">
          <FieldLabel label="Amount">
            <Input value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => setAmount(event.target.value)} />
          </FieldLabel>
        </div>
        <FieldLabel label="Category">
          <Input value={category} placeholder="subscription, investment, loan" onChange={(event) => setCategory(event.target.value)} />
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
            <Input value={dayOfMonth} inputMode="numeric" onChange={(event) => setDayOfMonth(event.target.value)} />
          </FieldLabel>
          <FieldLabel label="Active"><Switch checked={active} onCheckedChange={setActive} aria-label="Rule active" /></FieldLabel>
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
  defaultCategoryId,
  repeatTx,
  onSave,
  onClose
}: {
  data: AppData;
  editTx: Transaction | null;
  defaultCategoryId?: string;
  repeatTx?: Transaction;
  onSave: (tx: TransactionFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const initialTransaction = editTx || repeatTx;
  const [type, setType] = useState<TransactionType | "transfer">(initialTransaction?.transferGroupId ? "transfer" : initialTransaction?.kind === "transfer" ? "transfer" : initialTransaction?.type ?? "expense");
  const [amount, setAmount] = useState(initialTransaction ? String(initialTransaction.amount / 100) : "");
  const [description, setDescription] = useState(initialTransaction?.description ?? "");
  const [categoryId, setCategoryId] = useState(initialTransaction?.categoryId ?? defaultCategoryId ?? data.categories[0]?.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(initialTransaction?.subcategoryId ?? "");
  const initialAccount = data.accounts.find((item) => item.id === initialTransaction?.accountId);
  const [accountChoice, setAccountChoice] = useState(initialAccount?.accountKey || "");
  const initialToAccount = data.accounts.find((item) => item.id === initialTransaction?.toAccountId);
  const [toAccountChoice, setToAccountChoice] = useState(initialToAccount?.accountKey || "");
  const [date, setDate] = useState(editTx?.date ?? localDate());
  const [savingsAllocation, setSavingsAllocation] = useState(initialTransaction?.savingsAllocation ?? false);
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
      void saveAction.run(async () => {
        await onSave({
        id: editTx?.id,
        sourceId: editTx?.sourceId,
        transferGroupId: editTx?.transferGroupId || undefined,
        type,
        amount: cents,
        accountId: fromAccountId,
        toAccountId,
        description: description.trim(),
          date,
          savingsAllocation
        });
      });
      return;
    }
    if (!categoryId) {
      setError("Select a category.");
      return;
    }
    void saveAction.run(async () => {
      await onSave({
      id: editTx?.id,
      sourceId: editTx?.sourceId,
      type,
      amount: cents,
      categoryId,
      subcategoryId: subcategoryId || undefined,
      accountId: selectedAccount.id,
      description: description.trim(),
        date,
      });
    });
  }

  return (
    <BottomSheet title={editTx ? "Edit Transaction" : "Add Transaction"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <ToggleGroup type="single" value={type} onValueChange={(value) => { if (value) setType(value as typeof type); }} aria-label="Transaction type">
          <ToggleGroupItem className="danger" value="expense">Expense</ToggleGroupItem>
          <ToggleGroupItem value="income">Income</ToggleGroupItem>
          <ToggleGroupItem value="transfer">Transfer</ToggleGroupItem>
        </ToggleGroup>
        <FieldLabel label="Amount">
          <Input value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => setAmount(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Description">
          <Input value={description} placeholder="What was this for?" onChange={(event) => setDescription(event.target.value)} />
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
        {type === "transfer" ? (
          <div className="savings-allocation">
            <div><strong>Count as savings</strong><small>Add this transfer to this month&apos;s income allocation.</small></div>
            <Switch checked={savingsAllocation} onCheckedChange={setSavingsAllocation} aria-label="Count transfer as savings" />
          </div>
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

function BudgetModal({
  data,
  summary,
  categoryId,
  subcategoryId,
  onSave,
  onDelete,
  onClose
}: {
  data: AppData;
  summary: Summary | null;
  categoryId: string;
  subcategoryId?: string;
  onSave: (categoryId: string, amount: number, subcategoryId?: string) => Promise<void>;
  onDelete: (categoryId: string, subcategoryId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const category = data.categories.find((item) => item.id === categoryId);
  const theme = themeFromTarget(categoryId);
  const subcategory = category?.subcategories.find((item) => item.id === subcategoryId);
  const targetBudget = theme ? themeBudget(summary, theme) : subcategory ? subcategory.budget : category?.budget;
  const [amount, setAmount] = useState(targetBudget !== undefined ? String(targetBudget / 100) : "");
  const [error, setError] = useState("");
  const saveAction = usePendingAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Enter a valid budget amount.");
      return;
    }
    void saveAction.run(() => onSave(categoryId, cents, subcategoryId));
  }

  return (
    <BottomSheet title="Set Budget" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="budget-target">
          <small>Setting budget for</small>
          <strong>{theme || (subcategory ? `${category?.name} / ${subcategory.name}` : category?.name)}</strong>
          {targetBudget !== undefined ? <small>Current: {money(targetBudget)}</small> : <small>No budget set</small>}
        </div>
        <FieldLabel label="Budget Amount">
          <Input value={amount} inputMode="decimal" placeholder="0.00" autoFocus onChange={(event) => setAmount(event.target.value)} />
        </FieldLabel>
        {error ? <p className="form-error">{error}</p> : null}
        <PendingButton className="primary-action" type="submit" pending={saveAction.pending} pendingLabel="Saving…">
          Set Budget
        </PendingButton>
        {targetBudget !== undefined ? (
          <PendingButton className="secondary-action danger-action" type="button" pendingLabel="Deleting…" onAction={() => onDelete(categoryId, subcategoryId)}>
            Delete Budget
          </PendingButton>
        ) : null}
      </form>
    </BottomSheet>
  );
}

export function BottomSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent labelledBy={titleId}>
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <DialogTitle id={titleId}>{title}</DialogTitle>
          <DialogClose asChild>
            <Button className="ghost-button" variant="ghost" aria-label="Close">
            <X size={18} />
            </Button>
          </DialogClose>
        </header>
        {children}
      </DialogContent>
    </Dialog>
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

function TransactionCard({ tx, data, actions, onClick }: { tx: Transaction; data: AppData; actions?: ReactNode; onClick?: () => void }) {
  const category = data.categories.find((item) => item.id === tx.categoryId);
  const sub = category?.subcategories.find((item) => item.id === tx.subcategoryId);
  const fromAccount = data.accounts.find((item) => item.id === tx.accountId);
  const toAccount = data.accounts.find((item) => item.id === tx.toAccountId);
  const isPositive = tx.type === "income";
  const label = tx.kind === "investment" ? "Investment" : tx.kind === "transfer" ? "Transfer" : isPositive ? "Income" : "Expense";
  const detail = tx.kind === "transfer"
    ? [fromAccount?.name, toAccount?.name].filter(Boolean).join(" → ")
    : [category?.name || tx.categoryId, sub?.name, fromAccount?.name].filter(Boolean).join(" › ");
  const content = <>
      <CategoryIcon category={category} />
      <div className="transaction-body">
        <strong>{tx.description}</strong>
        <span>{detail} · {formatDate(tx.date)}</span>
      </div>
      <div className="transaction-amount">
        <strong className={isPositive ? "positive-text" : "danger-text"}>{isPositive ? "+" : "-"}{money(tx.amount)}</strong>
        <span className={isPositive ? "positive-text" : "danger-text"}>
          {isPositive ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
          {label}
        </span>
      </div>
      {actions}
  </>;
  return onClick ? <button className="transaction-card transaction-repeat" type="button" onClick={onClick} aria-label={`Repeat ${tx.description}`}>{content}</button> : <article className="transaction-card">{content}</article>;
}

function RepeatCard({ tx, data, onClick }: { tx: Transaction; data: AppData; onClick: () => void }) {
  const category = data.categories.find((item) => item.id === tx.categoryId);
  return <Button className="repeat-card" variant="ghost" onClick={onClick} aria-label={`Repeat ${tx.description}`}><strong>{tx.description}</strong><small>{[category?.name, money(tx.amount)].filter(Boolean).join(" · ")}</small></Button>;
}

function IncomeAllocationCard({ allocation }: { allocation: IncomeAllocation }) {
  const positiveIncome = Math.max(0, allocation.incomeCents);
  const unallocatedCents = Math.max(0, allocation.unallocatedCents);
  const overallocatedCents = Math.max(0, -allocation.unallocatedCents);
  const chartBackground = pieGradient([
    { value: allocation.spentCents, color: "#60a5fa" },
    { value: allocation.savedCents, color: "#4ade80" },
    { value: unallocatedCents, color: "#d9e4dc" }
  ], positiveIncome, "#d9e4dc");
  const chartLabel = positiveIncome
    ? `Income allocation: ${money(allocation.spentCents)} spent, ${money(allocation.savedCents)} saved, ${money(unallocatedCents)} unallocated`
    : "No income recorded for this month";
  return <section className="allocation-card" aria-labelledby="income-allocation-title">
    <div className="section-line">
      <div>
        <p className="eyebrow">Money in / money out</p>
        <h2 id="income-allocation-title">Income allocation</h2>
      </div>
      <span className="allocation-total">{money(positiveIncome)} income</span>
      </div>
      <div className="allocation-layout">
        <div className="allocation-ring" style={{ background: chartBackground }} role="img" aria-label={chartLabel}>
        <strong>{money(positiveIncome)}</strong>
        </div>
      <div className="allocation-legend" role="list" aria-label="Income allocation details">
        <div className="allocation-legend-row" role="listitem"><span><i className="allocation-dot" style={{ backgroundColor: "#60a5fa" }} />Spent</span><strong>{money(allocation.spentCents)}</strong></div>
        <div className="allocation-legend-row" role="listitem"><span><i className="allocation-dot" style={{ backgroundColor: "#4ade80" }} />Saved / invested</span><strong>{money(allocation.savedCents)}</strong></div>
        <div className="allocation-legend-row" role="listitem"><span><i className="allocation-dot" style={{ backgroundColor: overallocatedCents ? "#f87171" : "#d9e4dc" }} />{overallocatedCents ? "Over-allocated" : "Unallocated"}</span><strong>{money(overallocatedCents || unallocatedCents)}</strong></div>
      </div>
    </div>
    {positiveIncome === 0 && allocation.spentCents + allocation.savedCents > 0 ? <p className="income-summary-note">Record income to compare spending and savings.</p> : null}
  </section>;
}

function SpendingTrend({ trend, onViewHistory }: { trend: Summary["spendingTrend"]; onViewHistory: () => void }) {
  const [period, setPeriod] = useState<keyof Summary["spendingTrend"]>("daily");
  const pointsForPeriod = trend[period];
  const total = pointsForPeriod.reduce((sum, item) => sum + item.spentCents, 0);
  const average = pointsForPeriod.length ? total / pointsForPeriod.length : 0;
  const maximum = Math.max(...pointsForPeriod.map((item) => item.spentCents), 1);
  const points = pointsForPeriod.map((item, index) => {
    const x = pointsForPeriod.length === 1 ? 160 : (index / (pointsForPeriod.length - 1)) * 320;
    const y = 126 - (item.spentCents / maximum) * 110;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const areaPoints = points ? `0,126 ${points} 320,126` : "";
  const firstDay = pointsForPeriod[0];
  const lastDay = pointsForPeriod.at(-1);
  const labels = firstDay && lastDay && firstDay.periodStart !== lastDay.periodStart ? [firstDay, lastDay] : firstDay ? [firstDay] : [];
  const periodLabel = trendPeriodLabel(period);
  const chartTitle = `${capitalize(periodLabel)} spending trend, ${money(total)} total and ${money(Math.round(average))} average per ${periodLabel}`;
  return <section className="trend-card">
    <div className="section-line"><div><p className="eyebrow">Ordinary spending trend</p><strong>{money(Math.round(average))}</strong><small>Average per {periodLabel}</small></div><Button className="link-button" variant="ghost" onClick={onViewHistory}>View history</Button></div>
    <ToggleGroup className="trend-toggle" type="single" value={period} onValueChange={(value) => { if (value) setPeriod(value as typeof period); }} aria-label="Spending trend period"><ToggleGroupItem value="daily">Daily</ToggleGroupItem><ToggleGroupItem value="weekly">Weekly</ToggleGroupItem><ToggleGroupItem value="monthly">Monthly</ToggleGroupItem></ToggleGroup>
    <svg className="trend-chart" viewBox="0 0 320 142" preserveAspectRatio="none" role="img" aria-labelledby="trend-chart-title trend-chart-description">
      <title id="trend-chart-title">{chartTitle}</title>
      <desc id="trend-chart-description">Ordinary spending over the selected {periodLabel} periods. Open History for individual transactions.</desc>
      <line className="trend-grid" x1="0" y1="25" x2="320" y2="25" /><line className="trend-grid" x1="0" y1="70" x2="320" y2="70" /><line className="trend-grid" x1="0" y1="115" x2="320" y2="115" />
      {areaPoints ? <polygon className="trend-area" points={areaPoints} /> : null}
      {points ? <polyline className="trend-line" points={points} /> : null}
      {firstDay ? <circle className="trend-point" cx={pointsForPeriod.length === 1 ? 160 : 0} cy={126 - (firstDay.spentCents / maximum) * 110} r="3" /> : null}
      {lastDay && lastDay !== firstDay ? <circle className="trend-point" cx="320" cy={126 - (lastDay.spentCents / maximum) * 110} r="3" /> : null}
    </svg>
    {pointsForPeriod.length ? <div className="trend-labels">{labels.map((item) => <span key={item.periodStart}>{period === "monthly" ? item.periodStart : formatShortDate(item.periodStart)}</span>)}</div> : <p className="helper-copy">No ordinary spending recorded for this period.</p>}
  </section>;
}

function trendPeriodLabel(period: keyof Summary["spendingTrend"]) {
  if (period === "weekly") return "week";
  if (period === "monthly") return "month";
  return "day";
}

function RowActions({
  tx,
  onEdit,
  onToggleDelete
}: {
  tx: Transaction;
  onEdit: (tx: Transaction) => void;
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

function Progress({ value, color, thin = false, label }: { value: number; color: string; thin?: boolean; label: string }) {
  return <UiProgress value={value} color={color} thin={thin} label={label} />;
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state"><Banknote size={28} /><span>{label}</span></div>;
}

function buildAppData(summary: Summary | null, history?: RecentTransaction[]): AppData {
  if (!summary) return { categories: [], accounts: [], transactions: [] };
  const categoryMap = new Map<string, Category>();
  const storedCategories = new Map(summary.storedCategories.map((category) => [category.sourceKey, category]));
  const addCategory = (name: string) => {
    const id = slug(name);
    const existing = categoryMap.get(id);
    if (existing) return existing;
    const look = CATEGORY_LOOK[id] || CATEGORY_LOOK[name.toLowerCase()] || {
      group: "Needs" as BudgetGroup,
      color: FALLBACK_COLORS[categoryMap.size % FALLBACK_COLORS.length],
      icon: "Wallet"
    };
    const budget = summary.budgets.find((item) => item.subcategoryId === null && slug(item.category) === id);
    const spend = summary.categories.find((item) => slug(item.category) === id);
    const stored = storedCategories.get(id);
    const category: Category = {
      id,
      sourceName: stored?.sourceName || name,
      name: stored?.name || titleCase(name),
      group: stored?.group || look.group,
      color: stored?.color || look.color,
      icon: stored?.icon || look.icon,
      budget: budget?.budgetCents,
      spentCents: spend?.spentCents,
      subcategories: [],
      hidden: stored?.active === false
    };
    categoryMap.set(id, category);
    return category;
  };

  for (const item of summary.categories) addCategory(item.category);
  for (const item of summary.budgets) {
    if (!isThemeBudgetCategory(item.category)) addCategory(item.category);
  }
  for (const item of history || summary.recent) {
    if (item.category) addCategory(item.category);
  }
  for (const stored of summary.storedCategories) addCategory(stored.sourceName);

  const sourceTransactions = displayTransferGroups(history || summary.recent);
  const transactions = sourceTransactions.map((tx) => {
    const category = tx.category ? addCategory(tx.category) : null;
    const transfer = transferAccounts(tx, sourceTransactions);
    return {
      id: String(tx.id),
      sourceId: tx.id,
      amount: Math.abs(tx.amountCents),
      type: tx.kind === "income" || tx.amountCents > 0 ? "income" : "expense",
      kind: tx.transferGroupId ? "transfer" : tx.kind,
      transferGroupId: tx.transferGroupId,
      savingsAllocation: tx.savingsAllocation,
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
        const budget = summary.budgets.find((item) => item.subcategoryId === sub.id);
        const spend = summary.subcategories.find((item) => item.subcategoryId === sub.id);
        category.subcategories.push({
          id,
          name: sub.name,
          categoryId: stored.sourceKey,
          budget: budget?.budgetCents,
          spentCents: spend?.spentCents,
        });
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
  const category = data.categories.find((item) => item.id === categoryId);
  if (category?.spentCents !== undefined) return category.spentCents;
  return data.transactions.filter((tx) => tx.type === "expense" && tx.categoryId === categoryId).reduce((sum, tx) => sum + tx.amount, 0);
}

function spentForSubcategory(data: AppData, subcategoryId: string) {
  const subcategory = data.categories.flatMap((category) => category.subcategories).find((item) => item.id === subcategoryId);
  if (subcategory?.spentCents !== undefined) return subcategory.spentCents;
  return data.transactions.filter((tx) => tx.type === "expense" && tx.subcategoryId === subcategoryId).reduce((sum, tx) => sum + tx.amount, 0);
}

function effectiveBudgetTotal(categories: Category[]) {
  return categories.reduce((sum, category) => {
    if (category.budget !== undefined) return sum + category.budget;
    return sum + category.subcategories.reduce((subSum, subcategory) => subSum + (subcategory.budget || 0), 0);
  }, 0);
}

function effectiveBudgetTotalWithThemes(categories: Category[], summary: Summary | null) {
  return GROUPS.reduce((sum, group) => {
    const groupBudget = themeBudget(summary, group);
    if (groupBudget !== undefined) return sum + groupBudget;
    return sum + effectiveBudgetTotal(categories.filter((category) => category.group === group));
  }, 0);
}

function pieGradient(entries: { value: number; color: string }[], total: number, emptyColor: string) {
  if (total <= 0) return emptyColor;
  let offset = 0;
  const stops = entries.flatMap(({ value, color }) => {
    const visibleValue = Math.min(Math.max(0, value), Math.max(0, total - offset));
    if (visibleValue <= 0) return [];
    const start = offset / total * 100;
    offset += visibleValue;
    return [`${color} ${start}% ${offset / total * 100}%`];
  });
  if (offset < total) stops.push(`${emptyColor} ${offset / total * 100}% 100%`);
  return `conic-gradient(${stops.join(", ")})`;
}

function budgetProgressByGroup(categories: Category[], data: AppData, summary: Summary | null): Record<BudgetGroup, number> {
  if (summary?.health.progressByGroup) return summary.health.progressByGroup;
  return GROUPS.reduce((totals, group) => {
    totals[group] = categories
      .filter((category) => category.group === group)
      .reduce((sum, category) => sum + spentForCategory(data, category.id), 0);
    return totals;
  }, { Needs: 0, Wants: 0, Savings: 0 } as Record<BudgetGroup, number>);
}

function budgetRowAmount(spent: number, budget?: number) {
  return budget !== undefined ? `${money(spent)} / ${money(budget)}` : money(spent);
}

function themeTarget(group: BudgetGroup) {
  return `${THEME_TARGET_PREFIX}${group}`;
}

function themeFromTarget(value: string): BudgetGroup | null {
  if (!value.startsWith(THEME_TARGET_PREFIX)) return null;
  const group = value.slice(THEME_TARGET_PREFIX.length);
  return GROUPS.includes(group as BudgetGroup) ? group as BudgetGroup : null;
}

function themeFromBudgetCategory(category: string): BudgetGroup | null {
  if (!isThemeBudgetCategory(category)) return null;
  const normalized = category.slice(THEME_BUDGET_CATEGORY_PREFIX.length).toLowerCase();
  return GROUPS.find((group) => group.toLowerCase() === normalized) || null;
}

function themeBudget(summary: Summary | null, group: BudgetGroup) {
  return summary?.budgets.find((item) => themeFromBudgetCategory(item.category) === group && item.subcategoryId === null)?.budgetCents;
}

function storedSubcategoryNumber(subcategoryId?: string) {
  if (!subcategoryId) return null;
  const id = Number(subcategoryId.split("stored-").at(-1));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function money(cents: number) {
  return formatAmount(cents);
}

function formatDate(dateStr: string) {
  const localToday = localDate();
  const yesterday = new Date(`${localToday}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  if (dateStr === localToday) return `Today, ${formatShortDate(dateStr)}`;
  if (dateStr === yesterdayKey) return `Yesterday, ${formatShortDate(dateStr)}`;
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatShortDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function monthLabel(month?: string) {
  if (!month) return "Monthly";
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long" });
}

function recurringRuleDetail(rule: RecurringRule, accounts: Account[]) {
  const from = accounts.find((account) => account.id === rule.fromAccountId)?.name;
  const to = rule.toAccountId ? accounts.find((account) => account.id === rule.toAccountId)?.name : null;
  return [
    `Day ${rule.dayOfMonth}`,
    from && to ? `${from} to ${to}` : from,
    !from ? recurringTypeLabel(rule.ruleType) : null
  ].filter(Boolean).join(" · ");
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

function isDebtAccount(account: Account) {
  return account.accountType === "loan" || account.accountType === "card";
}

function recurringTypeLabel(type: RecurringRuleType) {
  if (type === "subscription") return "Subscription";
  if (type === "investment_transfer") return "Investment";
  return "Loan";
}

function headerTitle(tab: Tab, user?: Summary["user"]) {
  if (tab === "transactions") return "All Transactions";
  if (tab === "accounts") return "Accounts";
  if (tab === "budget") return "Monthly Budget";
  const name = user?.firstName || user?.username || "there";
  return `Hello, ${name}`;
}

function friendlyError(error: string) {
  if (error.includes("Telegram init data")) return "Open this dashboard inside Telegram after configuring your Mini App.";
  return error;
}
