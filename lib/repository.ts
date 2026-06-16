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

export async function getSummary(telegramUserId: number, month: string) {
  const supabase = createSupabaseAdmin();
  const start = `${month}-01`;
  const end = nextMonthStart(month);

  const [transactionsRes, budgetsRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, kind, category, account, description, amount_cents, currency, occurred_on")
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
      .order("category")
  ]);

  if (transactionsRes.error) throw transactionsRes.error;
  if (budgetsRes.error) throw budgetsRes.error;

  const transactions = transactionsRes.data || [];
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
    recent: transactions.slice(0, 20).map((tx) => ({
      id: tx.id,
      kind: tx.kind,
      category: tx.category,
      account: tx.account,
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
