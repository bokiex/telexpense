import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { ParsedTransaction } from "@/lib/parser";
import { randomUUID } from "crypto";
import { normalizeIdentity, resolveIdentity } from "@/lib/identity";
import { loanMetrics, normalizeOpeningBalance } from "@/lib/finance";

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
  subcategoryId: number | null;
  accountId: number | null;
  transferGroupId: string | null;
  recurringRuleId: number | null;
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
export type AccountType = "cash" | "bank" | "card" | "investment" | "loan" | "other";
export type RecurringRuleType = "subscription" | "investment_transfer" | "loan_payment";

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

export type PortfolioSnapshot = {
  accountId: number;
  month: string;
  portfolioValueCents: number;
  contributionCents: number;
  monthlyContributionCents: number;
  marketGainLossCents: number;
  currency: string;
};

export type RecurringRule = {
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

export type LoanProgress = {
  accountId: number;
  name: string;
  openingBalanceCents: number;
  balanceCents: number;
  repaidCents: number;
  repaymentThisMonthCents: number;
  payoffProgress: number;
  currency: string;
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
  active: boolean;
  subcategories: StoredSubcategory[];
};

export type ResolvedTransactionIdentity = {
  categoryId: number;
  category: string;
  subcategoryId: number | null;
  accountId: number;
  account: string;
};

export type PendingTransactionCapture = {
  token: string;
  description: string;
  amountCents: number;
  currency: string;
  categoryId: number | null;
  subcategoryId: number | null;
};

export async function createPendingTransactionCapture(
  telegramUserId: number,
  values: Omit<PendingTransactionCapture, "token" | "categoryId" | "subcategoryId">
) {
  const supabase = createSupabaseAdmin();
  const token = randomUUID().replaceAll("-", "").slice(0, 16);
  const { error } = await supabase.from("pending_transaction_captures").insert({
    token,
    telegram_user_id: telegramUserId,
    description: values.description,
    amount_cents: values.amountCents,
    currency: values.currency,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString()
  });
  if (error) throw error;
  return token;
}

export async function getPendingTransactionCapture(telegramUserId: number, token: string) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_transaction_captures")
    .select("token, description, amount_cents, currency, category_id, subcategory_id")
    .eq("telegram_user_id", telegramUserId)
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    token: data.token,
    description: data.description,
    amountCents: data.amount_cents,
    currency: data.currency,
    categoryId: data.category_id === null ? null : Number(data.category_id),
    subcategoryId: data.subcategory_id === null ? null : Number(data.subcategory_id)
  } satisfies PendingTransactionCapture;
}

export async function updatePendingTransactionCapture(
  telegramUserId: number,
  token: string,
  values: { categoryId?: number; subcategoryId?: number | null }
) {
  const supabase = createSupabaseAdmin();
  const update: Record<string, number | null> = {};
  if (values.categoryId !== undefined) update.category_id = values.categoryId;
  if (values.subcategoryId !== undefined) update.subcategory_id = values.subcategoryId;
  const { error } = await supabase
    .from("pending_transaction_captures")
    .update(update)
    .eq("telegram_user_id", telegramUserId)
    .eq("token", token);
  if (error) throw error;
}

export async function consumePendingTransactionCapture(
  telegramUserId: number,
  token: string,
  accountId: number,
  expectedCategoryId: number,
  expectedSubcategoryId: number | null
) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.rpc("consume_pending_transaction_capture", {
    p_telegram_user_id: telegramUserId,
    p_token: token,
    p_account_id: accountId,
    p_expected_category_id: expectedCategoryId,
    p_expected_subcategory_id: expectedSubcategoryId
  });
  if (error) throw error;
  return data === null ? null : Number(data);
}

export async function upsertTelegramUser(user: { id: number; first_name?: string; username?: string }) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("users").upsert({
    telegram_user_id: user.id,
    first_name: user.first_name || null,
    username: user.username || null
  });
  if (error) throw error;
}

export async function addTransaction(
  telegramUserId: number,
  transaction: ParsedTransaction,
  resolved: ResolvedTransactionIdentity
) {
  const supabase = createSupabaseAdmin();
  const accountId = resolved.accountId;
  const insert = {
    telegram_user_id: telegramUserId,
    kind: transaction.kind,
    category: resolved.category,
    category_id: resolved.categoryId,
    subcategory_id: resolved.subcategoryId,
    account_id: accountId,
    description: transaction.description,
    amount_cents: transaction.amountCents,
    currency: transaction.currency,
    occurred_on: new Date().toISOString().slice(0, 10)
  };
  return insertTransactionCompat(supabase, insert, transaction.account);
}

export async function addTransactionFields(
  telegramUserId: number,
  values: {
    kind: ParsedTransaction["kind"];
    category: string;
    accountId: number;
    subcategoryId?: number | null;
    description: string;
    amountCents: number;
    currency: string;
    occurredOn: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const category = await resolveCategoryIdentity(telegramUserId, values.category);
  await assertOwnedAccount(telegramUserId, values.accountId);
  await assertOwnedSubcategory(telegramUserId, values.subcategoryId ?? null, category.categoryId);
  const insert = {
    telegram_user_id: telegramUserId,
    kind: values.kind,
    category: category.category,
    category_id: category.categoryId,
    subcategory_id: values.subcategoryId ?? null,
    account_id: values.accountId,
    description: values.description,
    amount_cents: values.amountCents,
    currency: values.currency.toUpperCase(),
    occurred_on: values.occurredOn
  };
  const accountName = await getAccountName(telegramUserId, values.accountId);
  return insertTransactionCompat(supabase, insert, accountName.toLowerCase());
}

export async function addTransferFields(
  telegramUserId: number,
  values: {
    fromAccountId: number;
    toAccountId: number;
    category: string;
    description: string;
    amountCents: number;
    currency: string;
    occurredOn: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const category = await resolveCategoryIdentity(telegramUserId, values.category);
  await Promise.all([
    assertOwnedAccount(telegramUserId, values.fromAccountId),
    assertOwnedAccount(telegramUserId, values.toAccountId)
  ]);
  const transferGroupId = randomUUID();
  const amount = Math.abs(values.amountCents);
  const rows = [
    {
      telegram_user_id: telegramUserId,
      kind: "expense",
      category: category.category,
      category_id: category.categoryId,
      account_id: values.fromAccountId,
      transfer_group_id: transferGroupId,
      description: values.description,
      amount_cents: -amount,
      currency: values.currency.toUpperCase(),
      occurred_on: values.occurredOn
    },
    {
      telegram_user_id: telegramUserId,
      kind: await transferDestinationKind(telegramUserId, values.toAccountId),
      category: category.category,
      category_id: category.categoryId,
      account_id: values.toAccountId,
      transfer_group_id: transferGroupId,
      description: values.description,
      amount_cents: amount,
      currency: values.currency.toUpperCase(),
      occurred_on: values.occurredOn
    }
  ];
  const { error } = await supabase.from("transactions").insert(rows);
  if (error) throw error;
}

export async function updateTransaction(
  telegramUserId: number,
  transactionId: number,
  transaction: ParsedTransaction,
  resolved: ResolvedTransactionIdentity
) {
  const supabase = createSupabaseAdmin();
  const accountId = resolved.accountId;
  await updateTransactionCompat(supabase, telegramUserId, transactionId, {
    kind: transaction.kind,
    category: resolved.category,
    category_id: resolved.categoryId,
    subcategory_id: resolved.subcategoryId,
    account_id: accountId,
    description: transaction.description,
    amount_cents: transaction.amountCents,
    currency: transaction.currency
  }, transaction.account);
}

export async function updateTransactionFields(
  telegramUserId: number,
  transactionId: number,
  values: {
    kind: ParsedTransaction["kind"];
    category: string;
    accountId: number;
    subcategoryId?: number | null;
    description: string;
    amountCents: number;
    currency: string;
    occurredOn: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const category = await resolveCategoryIdentity(telegramUserId, values.category);
  await assertOwnedAccount(telegramUserId, values.accountId);
  await assertOwnedSubcategory(telegramUserId, values.subcategoryId ?? null, category.categoryId);
  const accountName = await getAccountName(telegramUserId, values.accountId);
  await updateTransactionCompat(supabase, telegramUserId, transactionId, {
    kind: values.kind,
    category: category.category,
    category_id: category.categoryId,
    subcategory_id: values.subcategoryId ?? null,
    account_id: values.accountId,
    description: values.description,
    amount_cents: values.amountCents,
    currency: values.currency.toUpperCase(),
    occurred_on: values.occurredOn
  }, accountName.toLowerCase());
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

export async function listTransactions(
  telegramUserId: number,
  cursor: { month: string; limit: number; beforeDate: string | null; beforeId: number | null }
) {
  const supabase = createSupabaseAdmin();
  const monthStart = `${cursor.month}-01`;
  const monthEnd = nextMonthStart(cursor.month);

  async function fetchPage(columns: string) {
    let query = supabase
      .from("transactions")
      .select(columns)
      .eq("telegram_user_id", telegramUserId)
      .gte("occurred_on", monthStart)
      .lt("occurred_on", monthEnd)
      .order("occurred_on", { ascending: false })
      .order("id", { ascending: false })
      .limit(cursor.limit + 1);
    if (cursor.beforeDate && cursor.beforeId) {
      query = query.or(`occurred_on.lt.${cursor.beforeDate},and(occurred_on.eq.${cursor.beforeDate},id.lt.${cursor.beforeId})`);
    }
    return query;
  }

  const optionalColumns = ["subcategory_id", "account_id", "transfer_group_id", "recurring_rule_id"];
  const rows = await selectTransactionsCompat(
    optionalColumns,
    (columns) => fetchPage(["id", "kind", "category", ...columns, "description", "amount_cents", "currency", "occurred_on"].join(", "))
  );

  const hasMore = rows.length > cursor.limit;
  const items = rows.slice(0, cursor.limit);
  const last = items.at(-1);
  return {
    items: items.map((tx) => ({
      id: tx.id, kind: tx.kind, category: tx.category, subcategoryId: tx.subcategory_id, accountId: tx.account_id,
      transferGroupId: tx.transfer_group_id, recurringRuleId: tx.recurring_rule_id,
      description: tx.description, amountCents: tx.amount_cents, currency: tx.currency, occurredOn: tx.occurred_on
    })),
    nextCursor: hasMore && last ? { beforeDate: last.occurred_on, beforeId: last.id } : null
  };
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
        account_key: normalizeIdentity(values.accountKey),
        name: values.name,
        institution: values.institution || null,
        account_type: values.accountType,
        opening_balance_cents: normalizeOpeningBalance(values.accountType, values.openingBalanceCents),
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
  if (error && isMissingSchemaError(error)) return [];
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

export async function upsertPortfolioSnapshot(
  telegramUserId: number,
  values: {
    accountId: number;
    month: string;
    portfolioValueCents: number;
    currency: string;
  }
) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("portfolio_snapshots").upsert(
    {
      telegram_user_id: telegramUserId,
      account_id: values.accountId,
      month: values.month,
      portfolio_value_cents: values.portfolioValueCents,
      currency: values.currency.toUpperCase(),
      updated_at: new Date().toISOString()
    },
    { onConflict: "telegram_user_id,account_id,month" }
  );
  if (error) throw error;
}

export async function upsertRecurringRule(
  telegramUserId: number,
  values: {
    id?: number | null;
    name: string;
    ruleType: RecurringRuleType;
    amountCents: number;
    currency: string;
    category: string;
    fromAccountId: number;
    toAccountId?: number | null;
    dayOfMonth: number;
    active: boolean;
  }
) {
  const supabase = createSupabaseAdmin();
  const payload = {
    telegram_user_id: telegramUserId,
    name: values.name,
    rule_type: values.ruleType,
    amount_cents: values.amountCents,
    currency: values.currency.toUpperCase(),
    category: values.category.toLowerCase(),
    from_account_id: values.fromAccountId,
    to_account_id: values.toAccountId || null,
    day_of_month: values.dayOfMonth,
    active: values.active,
    updated_at: new Date().toISOString()
  };

  if (values.id) {
    const { error } = await supabase
      .from("recurring_rules")
      .update(payload)
      .eq("telegram_user_id", telegramUserId)
      .eq("id", values.id);
    if (error) throw error;
    return values.id;
  }

  const { data, error } = await supabase
    .from("recurring_rules")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function deleteRecurringRule(telegramUserId: number, ruleId: number) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("recurring_rules")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("telegram_user_id", telegramUserId)
    .eq("id", ruleId);
  if (error) throw error;
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
  const sourceKey = normalizeIdentity(values.sourceKey);
  const sourceName = normalizeIdentity(values.sourceName);
  const { data, error } = await supabase
    .from("categories")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        source_key: sourceKey,
        source_name: sourceName,
        name: values.name,
        budget_group: values.group,
        color: values.color,
        icon: values.icon,
        active: true,
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
        name: normalizeIdentity(values.name)
      },
      { onConflict: "telegram_user_id,category_id,name" }
    )
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function deleteCategoryMetadata(telegramUserId: number, sourceKey: string, sourceName: string) {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("categories")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        source_key: sourceKey,
        source_name: sourceName.toLowerCase(),
        name: titleCase(sourceName),
        budget_group: "Needs",
        color: "#4ade80",
        icon: "Wallet",
        active: false,
        updated_at: new Date().toISOString()
      },
      { onConflict: "telegram_user_id,source_key" }
    );
  if (error && isMissingSchemaError(error)) return;
  if (error) throw error;
}

export async function getStoredCategories(telegramUserId: number): Promise<StoredCategory[]> {
  const supabase = createSupabaseAdmin();
  const [categoriesRes, subcategoriesRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id, source_key, source_name, name, budget_group, color, icon, active")
      .eq("telegram_user_id", telegramUserId)
      .order("name"),
    supabase
      .from("subcategories")
      .select("id, category_id, name")
      .eq("telegram_user_id", telegramUserId)
      .order("name")
  ]);

  if (categoriesRes.error && isMissingSchemaError(categoriesRes.error)) return [];
  if (subcategoriesRes.error && isMissingSchemaError(subcategoriesRes.error)) return [];
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
    active: row.active,
    subcategories: subcategories.get(Number(row.id)) || []
  }));
}

export async function getSummary(telegramUserId: number, month: string) {
  const supabase = createSupabaseAdmin();
  const start = `${month}-01`;
  const end = nextMonthStart(month);

  const [transactions, budgetsRes, storedCategories, storedAccounts, accountBalances, recurringRules] = await Promise.all([
    getSummaryTransactions(telegramUserId, start, end),
    supabase
      .from("budgets")
      .select("category, amount_cents, currency")
      .eq("telegram_user_id", telegramUserId)
      .eq("month", month)
      .order("category"),
    getStoredCategories(telegramUserId),
    getStoredAccounts(telegramUserId),
    getAccountBalances(telegramUserId),
    getRecurringRules(telegramUserId)
  ]);

  if (budgetsRes.error) throw budgetsRes.error;

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
  const accounts = buildAccountsFromBalances(storedAccounts, accountBalances);
  const portfolioSnapshots = await getPortfolioSnapshots(telegramUserId, month, storedAccounts);
  const loanProgress = buildLoanProgress(accounts, transactions);

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
    portfolioSnapshots,
    recurringRules,
    loanProgress,
    recent: transactions.slice(0, 20).map((tx) => ({
      id: tx.id,
      kind: tx.kind,
      category: tx.category,
      subcategoryId: tx.subcategory_id,
      accountId: tx.account_id,
      transferGroupId: tx.transfer_group_id,
      recurringRuleId: tx.recurring_rule_id,
      description: tx.description,
      amountCents: tx.amount_cents,
      currency: tx.currency,
      occurredOn: tx.occurred_on
    }))
  };
}

export async function getBudgetStatus(telegramUserId: number, month: string, category: string) {
  const supabase = createSupabaseAdmin();
  const normalized = normalizeIdentity(category);
  const start = `${month}-01`;
  const end = nextMonthStart(month);
  const [budgetRes, transactionsRes] = await Promise.all([
    supabase.from("budgets").select("category, amount_cents").eq("telegram_user_id", telegramUserId).eq("month", month).eq("category", normalized).maybeSingle(),
    supabase.from("transactions").select("amount_cents").eq("telegram_user_id", telegramUserId).eq("category", normalized)
      .eq("kind", "expense").lt("amount_cents", 0).gte("occurred_on", start).lt("occurred_on", end)
  ]);
  if (budgetRes.error) throw budgetRes.error;
  if (transactionsRes.error) throw transactionsRes.error;
  if (!budgetRes.data) return null;
  const spent = (transactionsRes.data || []).reduce((sum, row) => sum + Math.abs(row.amount_cents), 0);
  const budgetCents = budgetRes.data.amount_cents;
  return {
    category: normalized,
    spentCents: spent,
    budgetCents,
    ratio: budgetCents ? spent / budgetCents : 0
  };
}

async function getPortfolioSnapshots(
  telegramUserId: number,
  month: string,
  storedAccounts: Omit<StoredAccount, "balanceCents">[]
): Promise<PortfolioSnapshot[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("account_id, month, portfolio_value_cents, currency")
    .eq("telegram_user_id", telegramUserId)
    .lte("month", month)
    .order("month", { ascending: false });

  if (error && isMissingSchemaError(error)) return [];
  if (error) throw error;

  const latestRows = Array.from(
    (data || []).reduce((rows, row) => {
      const accountId = Number(row.account_id);
      if (!rows.has(accountId)) rows.set(accountId, row);
      return rows;
    }, new Map<number, NonNullable<typeof data>[number]>()).values()
  );
  const contributionCutoffs = new Map(
    latestRows.map((row) => [Number(row.account_id), row.month] as const)
  );
  const contributions = await getInvestmentContributionTotals(telegramUserId, contributionCutoffs);

  return latestRows.map((row) => {
    const accountId = Number(row.account_id);
    const previous = (data || []).find((candidate) => Number(candidate.account_id) === accountId && candidate.month < row.month);
    const account = storedAccounts.find((item) => item.id === accountId);
    const openingContributionCents = Math.max(0, account?.openingBalanceCents || 0);
    const contribution = contributions.get(accountId) || { totalCents: 0, monthCents: 0 };
    const totalContributionCents = openingContributionCents + contribution.totalCents;
    const previousValueCents = previous
      ? Number(previous.portfolio_value_cents)
      : openingContributionCents + contribution.totalCents - contribution.monthCents;
    return {
      accountId,
      month: row.month,
      portfolioValueCents: Number(row.portfolio_value_cents),
      contributionCents: totalContributionCents,
      monthlyContributionCents: contribution.monthCents,
      marketGainLossCents: Number(row.portfolio_value_cents) - previousValueCents - contribution.monthCents,
      currency: row.currency
    };
  });
}

async function getInvestmentContributionTotals(telegramUserId: number, cutoffs: Map<number, string>) {
  const totals = new Map<number, { totalCents: number; monthCents: number }>();
  if (!cutoffs.size) return totals;

  const supabase = createSupabaseAdmin();
  const accountCutoffs = Object.fromEntries(
    Array.from(cutoffs, ([accountId, month]) => [String(accountId), month])
  );
  const aggregated = await supabase.rpc("investment_contribution_totals", {
    target_user_id: telegramUserId,
    account_cutoffs: accountCutoffs
  });
  if (!aggregated.error) {
    for (const row of aggregated.data || []) {
      totals.set(Number(row.account_id), {
        totalCents: Number(row.total_cents),
        monthCents: Number(row.month_cents)
      });
    }
    return totals;
  }
  if (!isMissingSchemaError(aggregated.error)) throw aggregated.error;

  const latestMonth = Array.from(cutoffs.values()).sort().at(-1)!;
  let lastId = 0;
  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, account_id, amount_cents, occurred_on")
      .eq("telegram_user_id", telegramUserId)
      .in("account_id", Array.from(cutoffs.keys()))
      .in("kind", ["investment", "transfer"])
      .gt("amount_cents", 0)
      .lt("occurred_on", nextMonthStart(latestMonth))
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(500);

    if (error && isMissingSchemaError(error)) return totals;
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      const accountId = Number(row.account_id);
      const cutoff = cutoffs.get(accountId);
      if (!cutoff || String(row.occurred_on) >= nextMonthStart(cutoff)) continue;
      const current = totals.get(accountId) || { totalCents: 0, monthCents: 0 };
      const amount = Number(row.amount_cents);
      current.totalCents += amount;
      if (String(row.occurred_on) >= `${cutoff}-01`) current.monthCents += amount;
      totals.set(accountId, current);
    }
    lastId = Number(data.at(-1)!.id);
  }
  return totals;
}

async function getRecurringRules(telegramUserId: number): Promise<RecurringRule[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("recurring_rules")
    .select("id, name, rule_type, amount_cents, currency, category, from_account_id, to_account_id, day_of_month, active")
    .eq("telegram_user_id", telegramUserId)
    .order("name");

  if (error && isMissingSchemaError(error)) return [];
  if (error) throw error;

  return (data || []).map((row) => ({
    id: Number(row.id),
    name: row.name,
    ruleType: row.rule_type as RecurringRuleType,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    category: row.category,
    fromAccountId: Number(row.from_account_id),
    toAccountId: row.to_account_id === null ? null : Number(row.to_account_id),
    dayOfMonth: Number(row.day_of_month),
    active: Boolean(row.active)
  }));
}

export async function materializeRecurringTransactions(month: string, batchSize = 100, maxRules = batchSize) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Month must use YYYY-MM format.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Batch size must be between 1 and 500.");
  }
  if (!Number.isInteger(maxRules) || maxRules < batchSize || maxRules > 10_000) {
    throw new Error("Rule limit must be between the batch size and 10000.");
  }
  const supabase = createSupabaseAdmin();
  let usersProcessed = 0;
  let rulesMaterialized = 0;
  let batchesProcessed = 0;
  while (rulesMaterialized < maxRules) {
    const requested = Math.min(batchSize, maxRules - rulesMaterialized);
    const { data, error } = await supabase.rpc("materialize_recurring_transactions", {
      target_month: month,
      batch_size: requested
    });
    if (error && isMissingSchemaError(error)) break;
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    const batchRules = Number(result?.rules_materialized || 0);
    usersProcessed += Number(result?.users_processed || 0);
    rulesMaterialized += batchRules;
    batchesProcessed += 1;
    if (batchRules < requested) break;
  }
  return { usersProcessed, rulesMaterialized, batchesProcessed };
}

function buildLoanProgress(accounts: StoredAccount[], transactions: Awaited<ReturnType<typeof getSummaryTransactions>>): LoanProgress[] {
  return accounts
    .filter((account) => account.accountType === "loan" && account.id)
    .map((account) => {
      const { openingDebt, repaidCents, payoffProgress } = loanMetrics(account.openingBalanceCents, account.balanceCents);
      const repaymentThisMonthCents = transactions
        .filter((tx) => tx.account_id === account.id && tx.amount_cents > 0)
        .reduce((sum, tx) => sum + tx.amount_cents, 0);
      return {
        accountId: Number(account.id),
        name: account.name,
        openingBalanceCents: account.openingBalanceCents,
        balanceCents: account.balanceCents,
        repaidCents,
        repaymentThisMonthCents,
        payoffProgress,
        currency: account.currency
      };
    });
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

async function getAccountName(telegramUserId: number, accountId: number) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("accounts")
    .select("name")
    .eq("telegram_user_id", telegramUserId)
    .eq("id", accountId)
    .single();
  if (error) throw error;
  return String(data.name || "account");
}

async function transferDestinationKind(telegramUserId: number, accountId: number): Promise<ParsedTransaction["kind"]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("accounts")
    .select("account_type")
    .eq("telegram_user_id", telegramUserId)
    .eq("id", accountId)
    .single();
  if (error) throw error;
  return data.account_type === "investment" ? "investment" : "transfer";
}

export async function resolveTransactionIdentity(
  telegramUserId: number,
  categoryText: string,
  accountText: string
): Promise<ResolvedTransactionIdentity> {
  const [categories, accounts] = await Promise.all([getStoredCategories(telegramUserId), getStoredAccounts(telegramUserId)]);
  const categoryResolution = resolveIdentity(categoryText, categories.filter((item) => item.active).map((item) => ({
    id: item.id,
    canonical: item.sourceName,
    aliases: [item.name, item.sourceKey, ...item.subcategories.map((sub) => sub.name)]
  })));
  if (categoryResolution.status !== "matched") {
    const choices = categoryResolution.status === "ambiguous" ? categoryResolution.candidates : categoryResolution.suggestions;
    throw new Error(`Category "${categoryText}" is ${categoryResolution.status}. ${formatChoices(choices, "Available categories")}`);
  }
  const accountResolution = resolveIdentity(accountText, accounts.filter((item) => item.active && item.id).map((item) => ({
    id: Number(item.id),
    canonical: item.name,
    aliases: [item.accountKey]
  })));
  if (accountResolution.status !== "matched") {
    const choices = accountResolution.status === "ambiguous" ? accountResolution.candidates : accountResolution.suggestions;
    throw new Error(`Account "${accountText}" is ${accountResolution.status}. ${formatChoices(choices, "Available accounts")}`);
  }
  return {
    categoryId: categoryResolution.candidate.id,
    category: normalizeIdentity(categoryResolution.candidate.canonical),
    subcategoryId: resolveSubcategoryId(categoryText, categories, categoryResolution.candidate.id),
    accountId: accountResolution.candidate.id,
    account: normalizeIdentity(accountResolution.candidate.canonical)
  };
}

async function resolveCategoryIdentity(telegramUserId: number, categoryText: string) {
  const categories = await getStoredCategories(telegramUserId);
  const resolution = resolveIdentity(categoryText, categories.filter((item) => item.active).map((item) => ({
    id: item.id,
    canonical: item.sourceName,
    aliases: [item.name, item.sourceKey, ...item.subcategories.map((sub) => sub.name)]
  })));
  if (resolution.status !== "matched") {
    const choices = resolution.status === "ambiguous" ? resolution.candidates : resolution.suggestions;
    throw new Error(`Category "${categoryText}" is ${resolution.status}. ${formatChoices(choices, "Available categories")}`);
  }
  return { categoryId: resolution.candidate.id, category: normalizeIdentity(resolution.candidate.canonical) };
}

async function assertOwnedAccount(telegramUserId: number, accountId: number) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.from("accounts").select("id").eq("telegram_user_id", telegramUserId).eq("id", accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Account is not available.");
}

async function assertOwnedSubcategory(telegramUserId: number, subcategoryId: number | null, categoryId: number) {
  if (subcategoryId === null) return;
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("subcategories")
    .select("id")
    .eq("telegram_user_id", telegramUserId)
    .eq("category_id", categoryId)
    .eq("id", subcategoryId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Subcategory is not available for this category.");
}

function resolveSubcategoryId(categoryText: string, categories: StoredCategory[], categoryId: number) {
  const normalized = normalizeIdentity(categoryText);
  const matches = categories
    .find((category) => category.id === categoryId)
    ?.subcategories.filter((subcategory) => normalizeIdentity(subcategory.name) === normalized) || [];
  return matches.length === 1 ? matches[0].id : null;
}

function formatChoices(choices: { canonical: string }[], label: string) {
  return choices.length ? `${label}: ${choices.map((item) => item.canonical).join(", ")}.` : `${label}: open the Mini App to add one.`;
}

async function getSummaryTransactions(telegramUserId: number, start: string, end: string) {
  const supabase = createSupabaseAdmin();
  const optionalColumns = ["subcategory_id", "account_id", "transfer_group_id", "recurring_rule_id"];
  return selectTransactionsCompat(optionalColumns, (columns) => supabase
    .from("transactions")
    .select(["id", "kind", "category", ...columns, "description", "amount_cents", "currency", "occurred_on"].join(", "))
    .eq("telegram_user_id", telegramUserId)
    .gte("occurred_on", start)
    .lt("occurred_on", end)
    .order("occurred_on", { ascending: false })
    .order("id", { ascending: false }));
}

async function getAccountTransactions(telegramUserId: number) {
  const supabase = createSupabaseAdmin();
  const withAccountId = await supabase
    .from("transactions")
    .select("account_id, amount_cents, currency")
    .eq("telegram_user_id", telegramUserId);

  if (!withAccountId.error) return withAccountId.data || [];
  if (!isMissingSchemaError(withAccountId.error)) throw withAccountId.error;

  const legacy = await supabase
    .from("transactions")
    .select("account, amount_cents, currency")
    .eq("telegram_user_id", telegramUserId);

  if (legacy.error) throw legacy.error;
  return (legacy.data || []).map((row) => ({ ...row, account_id: null }));
}

async function getAccountBalances(telegramUserId: number): Promise<{ account_id: number; balance_cents: number }[]> {
  const supabase = createSupabaseAdmin();
  const result = await supabase.rpc("account_transaction_balances", { target_user_id: telegramUserId });
  if (!result.error) return (result.data || []).map((row: any) => ({ account_id: Number(row.account_id), balance_cents: Number(row.balance_cents) }));
  if (!isMissingSchemaError(result.error)) throw result.error;
  const rows = await getAccountTransactions(telegramUserId);
  const totals = new Map<number, number>();
  for (const row of rows) if (row.account_id) totals.set(Number(row.account_id), (totals.get(Number(row.account_id)) || 0) + row.amount_cents);
  return Array.from(totals, ([account_id, balance_cents]) => ({ account_id, balance_cents }));
}

function buildAccountsFromBalances(
  storedAccounts: Omit<StoredAccount, "balanceCents">[],
  balances: { account_id: number; balance_cents: number }[]
) {
  const totals = new Map(balances.map((row) => [row.account_id, row.balance_cents]));
  return storedAccounts.map((account) => ({
    ...account,
    balanceCents: account.openingBalanceCents + (account.id ? totals.get(account.id) || 0 : 0)
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function buildAccounts(
  storedAccounts: Omit<StoredAccount, "balanceCents">[],
  transactions: { account?: string; account_id: number | null; amount_cents: number; currency: string }[]
): StoredAccount[] {
  const accounts = new Map<string, StoredAccount>();
  const accountIdToKey = new Map<number, string>();

  for (const account of storedAccounts) {
    accounts.set(account.accountKey, { ...account, balanceCents: account.openingBalanceCents });
    if (account.id) accountIdToKey.set(account.id, account.accountKey);
  }

  for (const tx of transactions) {
    const accountKey = tx.account_id ? accountIdToKey.get(Number(tx.account_id)) : tx.account ? slug(tx.account) : null;
    if (!accountKey) continue;
    const existing = accounts.get(accountKey);
    if (existing) {
      existing.balanceCents += tx.amount_cents;
      continue;
    }
    accounts.set(accountKey, {
      id: null,
      accountKey,
      name: titleCase(tx.account || accountKey),
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

function isMissingSchemaError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  return candidate.code === "42P01" || candidate.code === "42703" || /does not exist|Could not find/i.test(candidate.message || "");
}

function isLegacyAccountColumnRequired(error: unknown) {
  const candidate = error as { code?: string; message?: string; details?: string };
  return candidate.code === "23502" && /account/i.test(`${candidate.message || ""} ${candidate.details || ""}`);
}

async function insertTransactionCompat(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  insert: Record<string, unknown>,
  account: string
) {
  const values = { ...insert };
  for (;;) {
    const result = await supabase.from("transactions").insert(values).select("id").single();
    if (!result.error) return Number(result.data.id);
    if (isLegacyAccountColumnRequired(result.error) && !("account" in values)) {
      values.account = account;
      continue;
    }
    const column = missingCompatibilityColumn(result.error, values);
    if (!column) throw result.error;
    delete values[column];
  }
}

async function updateTransactionCompat(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  telegramUserId: number,
  transactionId: number,
  update: Record<string, unknown>,
  account: string
) {
  const values = { ...update };
  for (;;) {
    const result = await supabase
      .from("transactions")
      .update(values)
      .eq("telegram_user_id", telegramUserId)
      .eq("id", transactionId);
    if (!result.error) return;
    const column = missingCompatibilityColumn(result.error, values);
    if (!column) throw result.error;
    delete values[column];
    if (column === "account_id") values.account = account;
  }
}

async function selectTransactionsCompat(
  optionalColumns: string[],
  select: (columns: string[]) => PromiseLike<{ data: any[] | null; error: unknown }>
) {
  const columns = [...optionalColumns];
  for (;;) {
    const result = await select(columns);
    if (!result.error) {
      return (result.data || []).map((row) => Object.fromEntries([
        ...Object.entries(row),
        ...optionalColumns.filter((column) => !columns.includes(column)).map((column) => [column, null])
      ]));
    }
    const column = missingCompatibilityColumn(result.error, Object.fromEntries(columns.map((item) => [item, true])));
    if (!column) throw result.error;
    columns.splice(columns.indexOf(column), 1);
  }
}

function missingCompatibilityColumn(error: unknown, values: Record<string, unknown>) {
  if (!isMissingSchemaError(error)) return null;
  const message = (error as { message?: string }).message || "";
  return ["subcategory_id", "category_id", "account_id", "transfer_group_id", "recurring_rule_id"]
    .find((column) => column in values && new RegExp(`\\b${column}\\b`, "i").test(message)) || null;
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
