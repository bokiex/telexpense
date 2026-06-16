import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { ParsedTransaction } from "@/lib/parser";

export type CategorySpend = {
  category: string;
  spentCents: number;
  currency: string;
};

export type Budget = {
  category: string;
  budgetCents: number;
  currency: string;
};

export type DailyPoint = {
  date: string;
  spentCents: number;
};

export type RecentTransaction = {
  id: number;
  kind: string;
  category: string;
  account: string;
  accountId: number | null;
  description: string;
  amountCents: number;
  currency: string;
  occurredOn: string;
};

export type BudgetHealth = {
  spentCents: number;
  budgetCents: number;
  remainingCents: number;
  budgetUsed: number;
  daysLeft: number;
  dailySafeCents: number;
  projectedSpendCents: number;
};

export type BudgetGroup = "Needs" | "Wants" | "Savings";
export type AccountType = "cash" | "bank" | "card" | "investment" | "other";

export type StoredAccount = {
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

export type StoredSubcategory = {
  id: number;
  name: string;
};

export type StoredCategory = {
  id: number;
  sourceKey: string;
  sourceName: string;
  name: string;
  group: BudgetGroup;
  color: string;
  icon: string;
  subcategories: StoredSubcategory[];
};

export async function upsertTelegramUser(user: { id: number; first_name?: string; username?: string }) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("users").upsert({
    telegram_user_id: user.id,
    first_name: user.first_name || null,
    username: user.username || null
  });
  if (error) throw error;
}

export async function addTransaction(telegramUserId: number, transaction: ParsedTransaction) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      telegram_user_id: telegramUserId,
      kind: transaction.kind,
      category: transaction.category,
      account: transaction.account,
      account_id: null,
      description: transaction.description,
      amount_cents: transaction.amountCents,
      currency: transaction.currency,
      occurred_on: new Date().toISOString().slice(0, 10)
    })
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function addTransactionFields(
  telegramUserId: number,
  values: {
    kind: ParsedTransaction["kind"];
    category: string;
    account: string;
    accountId?: number | null;
    description: string;
    amountCents: number;
    currency: string;
    occurredOn: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      telegram_user_id: telegramUserId,
      kind: values.kind,
      category: values.category.toLowerCase(),
      account: values.account.toLowerCase(),
      account_id: values.accountId ?? null,
      description: values.description,
      amount_cents: values.amountCents,
      currency: values.currency.toUpperCase(),
      occurred_on: values.occurredOn
    })
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function updateTransaction(telegramUserId: number, transactionId: number, transaction: ParsedTransaction) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("transactions")
    .update({
      kind: transaction.kind,
      category: transaction.category,
      account: transaction.account,
      description: transaction.description,
      amount_cents: transaction.amountCents,
      currency: transaction.currency
    })
    .eq("telegram_user_id", telegramUserId)
    .eq("id", transactionId);
  if (error) throw error;
}

export async function updateTransactionFields(
  telegramUserId: number,
  transactionId: number,
  values: {
    kind: ParsedTransaction["kind"];
    category: string;
    account: string;
    accountId?: number | null;
    description: string;
    amountCents: number;
    currency: string;
    occurredOn: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("transactions")
    .update({
      kind: values.kind,
      category: values.category.toLowerCase(),
      account: values.account.toLowerCase(),
      account_id: values.accountId ?? null,
      description: values.description,
      amount_cents: values.amountCents,
      currency: values.currency.toUpperCase(),
      occurred_on: values.occurredOn
    })
    .eq("telegram_user_id", telegramUserId)
    .eq("id", transactionId);
  if (error) throw error;
}

export async function deleteTransaction(telegramUserId: number, transactionId: number) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("telegram_user_id", telegramUserId)
    .eq("id", transactionId);
  if (error) throw error;
}

export async function setBudget(telegramUserId: number, category: string, month: string, amountCents: number, currency = "USD") {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("budgets").upsert(
    {
      telegram_user_id: telegramUserId,
      category: category.toLowerCase(),
      month,
      amount_cents: amountCents,
      currency
    },
    { onConflict: "telegram_user_id,category,month" }
  );
  if (error) throw error;
}

export async function deleteBudget(telegramUserId: number, category: string, month: string) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("budgets")
    .delete()
    .eq("telegram_user_id", telegramUserId)
    .eq("category", category.toLowerCase())
    .eq("month", month);
  if (error) throw error;
}

export async function upsertAccount(
  telegramUserId: number,
  values: {
    accountKey: string;
    name: string;
    institution?: string | null;
    accountType: AccountType;
    openingBalanceCents: number;
    currency: string;
    color: string;
    icon: string;
    active?: boolean;
  }
) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("accounts")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        account_key: values.accountKey,
        name: values.name,
        institution: values.institution || null,
        account_type: values.accountType,
        opening_balance_cents: values.openingBalanceCents,
        currency: values.currency.toUpperCase(),
        color: values.color,
        icon: values.icon,
        active: values.active ?? true,
        updated_at: new Date().toISOString()
      },
      { onConflict: "telegram_user_id,account_key" }
    )
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function getStoredAccounts(telegramUserId: number): Promise<Omit<StoredAccount, "balanceCents">[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, account_key, name, institution, account_type, opening_balance_cents, currency, color, icon, active")
    .eq("telegram_user_id", telegramUserId)
    .order("name");
  if (error) throw error;
  return (data || []).map((row) => ({
    id: Number(row.id),
    accountKey: row.account_key,
    name: row.name,
    institution: row.institution,
    accountType: row.account_type as AccountType,
    openingBalanceCents: row.opening_balance_cents,
    currency: row.currency,
    color: row.color,
    icon: row.icon,
    active: row.active
  }));
}

export async function upsertCategory(
  telegramUserId: number,
  values: {
    sourceKey: string;
    sourceName: string;
    name: string;
    group: BudgetGroup;
    color: string;
    icon: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("categories")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        source_key: values.sourceKey,
        source_name: values.sourceName.toLowerCase(),
        name: values.name,
        budget_group: values.group,
        color: values.color,
        icon: values.icon,
        updated_at: new Date().toISOString()
      },
      { onConflict: "telegram_user_id,source_key" }
    )
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function addSubcategory(
  telegramUserId: number,
  values: {
    sourceKey: string;
    sourceName: string;
    categoryName: string;
    group: BudgetGroup;
    color: string;
    icon: string;
    name: string;
  }
) {
  const categoryId = await upsertCategory(telegramUserId, {
    sourceKey: values.sourceKey,
    sourceName: values.sourceName,
    name: values.categoryName,
    group: values.group,
    color: values.color,
    icon: values.icon
  });
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("subcategories")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        category_id: categoryId,
        name: values.name
      },
      { onConflict: "telegram_user_id,category_id,name" }
    )
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function getStoredCategories(telegramUserId: number): Promise<StoredCategory[]> {
  const supabase = createSupabaseAdmin();
  const [categoriesRes, subcategoriesRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id, source_key, source_name, name, budget_group, color, icon")
      .eq("telegram_user_id", telegramUserId)
      .order("name"),
    supabase
      .from("subcategories")
      .select("id, category_id, name")
      .eq("telegram_user_id", telegramUserId)
      .order("name")
  ]);

  if (categoriesRes.error) throw categoriesRes.error;
  if (subcategoriesRes.error) throw subcategoriesRes.error;

  const subcategories = new Map<number, StoredSubcategory[]>();
  for (const row of subcategoriesRes.data || []) {
    const categoryId = Number(row.category_id);
    subcategories.set(categoryId, [...(subcategories.get(categoryId) || []), { id: Number(row.id), name: row.name }]);
  }

  return (categoriesRes.data || []).map((row) => ({
    id: Number(row.id),
    sourceKey: row.source_key,
    sourceName: row.source_name,
    name: row.name,
    group: row.budget_group as BudgetGroup,
    color: row.color,
    icon: row.icon,
    subcategories: subcategories.get(Number(row.id)) || []
  }));
}

export async function getSummary(telegramUserId: number, month: string) {
  const supabase = createSupabaseAdmin();
  const start = `${month}-01`;
  const end = nextMonthStart(month);

  const [transactionsRes, budgetsRes, storedCategories, storedAccounts, accountTransactionsRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, kind, category, account, account_id, description, amount_cents, currency, occurred_on")
      .eq("telegram_user_id", telegramUserId)
      .gte("occurred_on", start)
      .lt("occurred_on", end)
      .order("occurred_on", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("budgets")
      .select("category, amount_cents, currency")
      .eq("telegram_user_id", telegramUserId)
      .eq("month", month)
      .order("category"),
    getStoredCategories(telegramUserId),
    getStoredAccounts(telegramUserId),
    supabase
      .from("transactions")
      .select("account, account_id, amount_cents, currency")
      .eq("telegram_user_id", telegramUserId)
  ]);

  if (transactionsRes.error) throw transactionsRes.error;
  if (budgetsRes.error) throw budgetsRes.error;
  if (accountTransactionsRes.error) throw accountTransactionsRes.error;

  const transactions = transactionsRes.data || [];
  const allAccountTransactions = accountTransactionsRes.data || [];
  const budgets = (budgetsRes.data || []).map((row) => ({
    category: row.category,
    budgetCents: row.amount_cents,
    currency: row.currency
  }));

  const categories = new Map<string, CategorySpend>();
  const daily = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.kind !== "expense" || tx.amount_cents >= 0) continue;
    const spent = Math.abs(tx.amount_cents);
    const category = categories.get(tx.category) || { category: tx.category, spentCents: 0, currency: tx.currency };
    category.spentCents += spent;
    categories.set(tx.category, category);
    daily.set(tx.occurred_on, (daily.get(tx.occurred_on) || 0) + spent);
  }

  const categoryList = Array.from(categories.values()).sort((a, b) => b.spentCents - a.spentCents);
  const spentCents = categoryList.reduce((sum, item) => sum + item.spentCents, 0);
  const budgetCents = budgets.reduce((sum, item) => sum + item.budgetCents, 0);
  const daysElapsed = daysElapsedInMonth(month);
  const daysLeft = daysLeftInMonth(month);
  const accounts = buildAccounts(storedAccounts, allAccountTransactions);

  return {
    month,
    categories: categoryList,
    budgets,
    health: {
      spentCents,
      budgetCents,
      remainingCents: budgetCents - spentCents,
      budgetUsed: budgetCents ? Math.round((spentCents / budgetCents) * 100) : 0,
      daysLeft,
      dailySafeCents: daysLeft > 0 ? Math.floor(Math.max(0, budgetCents - spentCents) / daysLeft) : 0,
      projectedSpendCents: daysElapsed > 0 ? Math.round((spentCents / daysElapsed) * daysInMonth(month)) : spentCents
    },
    daily: Array.from(daily.entries())
      .map(([date, spentCents]) => ({ date, spentCents }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    storedCategories,
    accounts,
    recent: transactions.slice(0, 20).map((tx) => ({
      id: tx.id,
      kind: tx.kind,
      category: tx.category,
      account: tx.account,
      accountId: tx.account_id,
      description: tx.description,
      amountCents: tx.amount_cents,
      currency: tx.currency,
      occurredOn: tx.occurred_on
    }))
  };
}

export async function getBudgetStatus(telegramUserId: number, month: string, category: string) {
  const summary = await getSummary(telegramUserId, month);
  const budget = summary.budgets.find((item) => item.category === category.toLowerCase());
  if (!budget) return null;
  const spent = summary.categories.find((item) => item.category === category.toLowerCase())?.spentCents || 0;
  return {
    category: budget.category,
    spentCents: spent,
    budgetCents: budget.budgetCents,
    ratio: budget.budgetCents ? spent / budget.budgetCents : 0
  };
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function buildAccounts(
  storedAccounts: Omit<StoredAccount, "balanceCents">[],
  transactions: { account: string; account_id: number | null; amount_cents: number; currency: string }[]
): StoredAccount[] {
  const accounts = new Map<string, StoredAccount>();
  const accountIdToKey = new Map<number, string>();

  for (const account of storedAccounts) {
    accounts.set(account.accountKey, { ...account, balanceCents: account.openingBalanceCents });
    if (account.id) accountIdToKey.set(account.id, account.accountKey);
  }

  for (const tx of transactions) {
    const accountKey = tx.account_id ? accountIdToKey.get(Number(tx.account_id)) || slug(tx.account) : slug(tx.account);
    const existing = accounts.get(accountKey);
    if (existing) {
      existing.balanceCents += tx.amount_cents;
      continue;
    }
    accounts.set(accountKey, {
      id: null,
      accountKey,
      name: titleCase(tx.account),
      institution: null,
      accountType: "other",
      openingBalanceCents: 0,
      balanceCents: tx.amount_cents,
      currency: tx.currency,
      color: "#60a5fa",
      icon: "Wallet",
      active: true
    });
  }

  return Array.from(accounts.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function nextMonthStart(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
}

function daysInMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

function daysElapsedInMonth(month: string) {
  const now = new Date();
  const current = now.toISOString().slice(0, 7);
  if (month < current) return daysInMonth(month);
  if (month > current) return 0;
  return now.getUTCDate();
}

function daysLeftInMonth(month: string) {
  const now = new Date();
  const current = now.toISOString().slice(0, 7);
  if (month < current) return 0;
  if (month > current) return daysInMonth(month);
  return Math.max(0, daysInMonth(month) - now.getUTCDate() + 1);
}
