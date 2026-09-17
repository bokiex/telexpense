import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount } from "../lib/amountFormat";
import { debtAmount, loanMetrics, netWorth, netWorthWithPortfolioValues, normalizeOpeningBalance } from "../lib/finance";
import { normalizeIdentity, resolveIdentity } from "../lib/identity";
import { isConciseTransactionMessage, parseConciseTransactionMessage, parseTransactionMessage } from "../lib/parser";
import { callbackData, resolveConciseCapture } from "../lib/transactionCapture";
import type { StoredAccount, StoredCategory } from "../lib/repository";
import { budgetActivityTotals, budgetStatusSpentCents, effectiveBudgetCents, incomeAllocationTotals, spendingTrend, subcategoryDisplayName } from "../lib/repository";
import { themeBudgetCategory } from "../lib/budgetThemes";
import {
  genericTransactionKindError,
  groupedTransactionEditError,
  transactionCategory,
  transactionCategoryError
} from "../lib/transactionCategory";
import { displayTransferGroups, transferAccounts } from "../lib/transfer";
import { isValidDate, isValidMonth, transactionAmountError } from "../lib/validation";
import crypto from "node:crypto";
import { validateTelegramInitData } from "../lib/telegram";

test("transfers omit categories while expense and income still require them", () => {
  assert.equal(transactionCategory("transfer", undefined), null);
  assert.equal(transactionCategory("transfer", "legacy-transfer-category"), null);
  assert.equal(transactionCategory("expense", " Food "), "Food");
  assert.equal(transactionCategory("expense", ""), null);
  assert.equal(transactionCategory("income", undefined), null);
  assert.equal(transactionCategoryError("transfer", null), null);
  assert.equal(transactionCategoryError("expense", null), "Category is required.");
  assert.equal(transactionCategoryError("income", null), "Category is required.");
});

test("calendar validation rejects normalized impossible dates and months", () => {
  assert.equal(isValidDate("2026-02-28"), true);
  assert.equal(isValidDate("2024-02-29"), true);
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(isValidMonth("2026-12"), true);
  assert.equal(isValidMonth("2026-13"), false);
});

test("effective budget total does not double-count child subcategory targets", () => {
  assert.equal(effectiveBudgetCents([
    { category: "food", subcategoryId: null, budgetCents: 100_00 },
    { category: "food", subcategoryId: 10, budgetCents: 40_00 },
    { category: "transport", subcategoryId: 20, budgetCents: 25_00 }
  ]), 125_00);
});

test("effective budget total ignores synthetic theme targets", () => {
  assert.equal(effectiveBudgetCents([
    { category: themeBudgetCategory("Needs"), subcategoryId: null, budgetCents: 500_00 },
    { category: "food", subcategoryId: null, budgetCents: 100_00 },
    { category: "transport", subcategoryId: 20, budgetCents: 25_00 }
  ]), 125_00);
});

test("budget activity excludes grouped legs and separates ordinary spending from savings allocation", () => {
  const totals = budgetActivityTotals([
    { kind: "expense", category: "food", amount_cents: -40_00, transfer_group_id: null },
    { kind: "investment", category: "investments", amount_cents: -25_00, transfer_group_id: null },
    { kind: "investment", category: null, amount_cents: 100_00, transfer_group_id: "transfer" },
    { kind: "transfer", category: null, amount_cents: -100_00, transfer_group_id: "transfer" }
  ], [
    { sourceName: "food", group: "Needs" },
    { sourceName: "investments", group: "Savings" }
  ]);

  assert.equal(totals.ordinarySpentCents, 40_00);
  assert.equal(totals.savingsAllocatedCents, 25_00);
  assert.equal(totals.progressCents, 65_00);
  assert.deepEqual(totals.progressByGroup, { Needs: 40_00, Wants: 0, Savings: 25_00 });
});

test("budget warning spending excludes grouped transaction legs", () => {
  assert.equal(budgetStatusSpentCents([
    { amount_cents: -40_00, transfer_group_id: null },
    { amount_cents: -100_00, transfer_group_id: "transfer" },
    { amount_cents: -25_00, transfer_group_id: "transfer" }
  ]), 40_00);
});

test("savings category expenses count as allocated progress, not ordinary spending", () => {
  const totals = budgetActivityTotals([
    { kind: "expense", category: "investments", amount_cents: -75_00, transfer_group_id: null },
    { kind: "expense", category: "shopping", amount_cents: -25_00, transfer_group_id: null }
  ], [
    { sourceName: "investments", group: "Savings" },
    { sourceName: "shopping", group: "Wants" }
  ]);

  assert.equal(totals.ordinarySpentCents, 25_00);
  assert.equal(totals.savingsAllocatedCents, 75_00);
  assert.deepEqual(totals.progressByGroup, { Needs: 0, Wants: 25_00, Savings: 75_00 });
});

test("income allocation separates income, ordinary spend, savings, and remaining funds", () => {
  const allocation = incomeAllocationTotals([
    { kind: "income", category: "salary", amount_cents: 500_00, transfer_group_id: null },
    { kind: "income", category: "freelance", amount_cents: 125_00, transfer_group_id: null },
    { kind: "expense", category: "food", amount_cents: -200_00, transfer_group_id: null },
    { kind: "expense", category: "investments", amount_cents: -75_00, transfer_group_id: null },
    { kind: "investment", category: "investments", amount_cents: -100_00, transfer_group_id: null }
  ], [{ sourceName: "food", group: "Needs" }, { sourceName: "investments", group: "Savings" }]);

  assert.deepEqual(allocation, { incomeCents: 625_00, spentCents: 200_00, savedCents: 175_00, unallocatedCents: 250_00 });
});

test("income allocation and trends exclude grouped transfers", () => {
  const transactions = [
    { kind: "income", category: "salary", amount_cents: 300_00, transfer_group_id: null, occurred_on: "2026-01-05" },
    { kind: "expense", category: "food", amount_cents: -50_00, transfer_group_id: null, occurred_on: "2026-01-05" },
    { kind: "expense", category: null, amount_cents: -100_00, transfer_group_id: "transfer", occurred_on: "2026-01-06" },
    { kind: "investment", category: null, amount_cents: 100_00, transfer_group_id: "transfer", occurred_on: "2026-01-06" }
  ];
  const categories = [{ sourceName: "food", group: "Needs" as const }];

  assert.deepEqual(incomeAllocationTotals(transactions, categories), { incomeCents: 300_00, spentCents: 50_00, savedCents: 0, unallocatedCents: 250_00 });
  assert.equal(spendingTrend(transactions, categories, "2026-01").daily[5].spentCents, 0);
});

test("spending trend zero-fills daily, weekly, and monthly calendar buckets", () => {
  const trend = spendingTrend([
    { kind: "expense", category: "food", amount_cents: -10_00, transfer_group_id: null, occurred_on: "2024-02-01" },
    { kind: "expense", category: "food", amount_cents: -20_00, transfer_group_id: null, occurred_on: "2024-02-29" },
    { kind: "expense", category: "food", amount_cents: -30_00, transfer_group_id: null, occurred_on: "2023-10-10" }
  ], [{ sourceName: "food", group: "Needs" }], "2024-02");

  assert.equal(trend.daily.length, 29);
  assert.deepEqual(trend.daily[0], { periodStart: "2024-02-01", spentCents: 10_00 });
  assert.deepEqual(trend.daily[1], { periodStart: "2024-02-02", spentCents: 0 });
  assert.deepEqual(trend.daily[28], { periodStart: "2024-02-29", spentCents: 20_00 });
  assert.deepEqual(trend.monthly.map((point) => point.periodStart), ["2023-09", "2023-10", "2023-11", "2023-12", "2024-01", "2024-02"]);
  assert.equal(trend.monthly[1].spentCents, 30_00);
});

test("frontend amount display is neutral", () => {
  const displayed = formatAmount(123_45);

  assert.equal(displayed, "123.45");
  assert.doesNotMatch(displayed, /US\$|\$|USD|SGD|currency/i);
});

test("subcategory display names preserve typed casing", () => {
  assert.equal(subcategoryDisplayName("  Grab Rides  "), "Grab Rides");
});

test("transaction amounts enforce integer cents and kind sign invariants", () => {
  assert.equal(transactionAmountError("expense", -100), null);
  assert.equal(transactionAmountError("income", 100), null);
  assert.equal(transactionAmountError("investment", -100), null);
  assert.equal(transactionAmountError("expense", 100), "Expense amount must be negative.");
  assert.equal(transactionAmountError("income", -100), "Income amount must be positive.");
  assert.match(transactionAmountError("expense", 1.5) || "", /integer/);
});

test("Telegram init data rejects future authentication dates", () => {
  const token = "test-token";
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) + 60),
    user: JSON.stringify({ id: 123 })
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  assert.throws(() => validateTelegramInitData(params.toString(), token), /expired/);
});

test("generic transaction persistence rejects ungrouped transfers", () => {
  assert.equal(genericTransactionKindError("transfer"), "Transfers must use the grouped transfer endpoint.");
  assert.equal(genericTransactionKindError("expense"), null);
  assert.equal(genericTransactionKindError("income"), null);
  assert.equal(genericTransactionKindError("investment"), null);
});

test("generic transaction editing rejects grouped transfer legs", () => {
  assert.equal(
    groupedTransactionEditError("af39b195-e616-45a1-9974-f82ff1d837c6"),
    "Grouped transfers must use the grouped transfer endpoint."
  );
  assert.equal(groupedTransactionEditError(null), null);
});

test("grouped transfer legs resolve edit source and destination accounts", () => {
  const legs = [
    { transferGroupId: "group", accountId: 10, amountCents: -500 },
    { transferGroupId: "group", accountId: 20, amountCents: 500 }
  ];
  assert.deepEqual(transferAccounts(legs[1], legs), {
    fromAccountId: 10,
    toAccountId: 20
  });
  assert.deepEqual(transferAccounts({
    transferGroupId: "group", accountId: 10, amountCents: -500,
    transferFromAccountId: 10, transferToAccountId: 20
  }, []), { fromAccountId: 10, toAccountId: 20 });
  assert.equal(transferAccounts({ transferGroupId: null, accountId: 10, amountCents: -500 }, legs), null);
});

test("history displays one source leg per transfer group across pages", () => {
  const destination = {
    id: 2,
    transferGroupId: "group",
    accountId: 20,
    transferFromAccountId: 10,
    transferToAccountId: 20,
    amountCents: 500
  };
  const source = {
    id: 1,
    transferGroupId: "group",
    accountId: 10,
    transferFromAccountId: 10,
    transferToAccountId: 20,
    amountCents: -500
  };
  const expense = { id: 3, transferGroupId: null, accountId: 30, amountCents: -250 };

  assert.deepEqual(displayTransferGroups([destination]), [{ ...destination, accountId: 10, amountCents: -500 }]);
  assert.deepEqual(displayTransferGroups([destination, expense, source]), [source, expense]);
});

test("category identity collapses whitespace and case", () => {
  assert.equal(normalizeIdentity("  FoOd \t Delivery "), "food delivery");
  const candidates = [{ id: 1, canonical: "food", aliases: ["Dining"] }];
  assert.equal(resolveIdentity(" FOOD ", candidates).status, "matched");
  assert.equal(resolveIdentity(" dining ", candidates).status, "matched");
});

test("ambiguous aliases never select a category", () => {
  const result = resolveIdentity("daily", [
    { id: 1, canonical: "food", aliases: ["daily"] },
    { id: 2, canonical: "transport", aliases: ["daily"] }
  ]);
  assert.equal(result.status, "ambiguous");
});

test("canonical category identity takes precedence over aliases", () => {
  const result = resolveIdentity("food", [
    { id: 1, canonical: "food", aliases: [] },
    { id: 2, canonical: "transport", aliases: ["food"] }
  ]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.candidate.id, 1);
});

test("Telegram parser normalizes category/account and signs expense", () => {
  const parsed = parseTransactionMessage("  FoOd , Main   Card, Lunch, 4.20");
  assert.equal(parsed.category, "food");
  assert.equal(parsed.account, "main card");
  assert.equal(parsed.amountCents, -420);
  assert.throws(() => parseTransactionMessage("food, card, lunch, $4.20"), /Could not find an amount/);
  assert.throws(() => parseTransactionMessage("food, card, lunch, 4.20 SGD"), /Could not find an amount/);
});

test("Telegram comma parser rejects transfers before identity resolution", () => {
  assert.throws(
    () => parseTransactionMessage("transfer, savings, checking, 20"),
    /Transfers must be created in the dashboard\./
  );
});

test("concise Telegram parser extracts amount and subcategory text", () => {
  assert.deepEqual(parseConciseTransactionMessage("4.20 eat out"), {
    kind: "expense", description: "eat out", amountCents: -420
  });
  assert.throws(() => parseConciseTransactionMessage("food, card, lunch, 4.20"));
});

test("grouped concise amounts are distinct from comma-separated transactions", () => {
  assert.equal(isConciseTransactionMessage("1,000 eat out"), true);
  assert.equal(isConciseTransactionMessage("food, card, lunch, 4.20"), false);
  assert.equal(parseConciseTransactionMessage("1,000 eat out").amountCents, -100_000);
});

const category = (id: number, name: string, subcategoryName: string): StoredCategory => ({
  id, sourceKey: name.toLowerCase(), sourceName: name.toLowerCase(), name,
  group: "Needs", color: "#000", icon: "Wallet", active: true,
  subcategories: [{ id: id * 10, name: subcategoryName }]
});
const account = {
  id: 7, accountKey: "card", name: "Card", institution: null, accountType: "card",
  openingBalanceCents: 0, balanceCents: 0, color: "#000", icon: "Wallet", active: true
} satisfies StoredAccount;

test("concise capture uniquely resolves subcategory, parent, and sole account", () => {
  const result = resolveConciseCapture("EAT OUT", [category(1, "Food", "Eat out")], [account]);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.category.id, 1);
    assert.equal(result.subcategoryId, 10);
    assert.equal(result.account.id, 7);
  }
});

test("duplicate subcategory names require a parent choice and multiple accounts require a prompt", () => {
  const categories = [category(1, "Food", "Daily"), category(2, "Transport", "Daily")];
  const ambiguous = resolveConciseCapture("daily", categories, [account]);
  assert.equal(ambiguous.status, "choose-category");
  if (ambiguous.status === "choose-category") assert.deepEqual(ambiguous.categories.map((item) => item.id), [1, 2]);

  const accountChoice = resolveConciseCapture("daily", categories, [{ ...account }, { ...account, id: 8, accountKey: "cash", name: "Cash" }], 1);
  assert.equal(accountChoice.status, "choose-account");
});

test("duplicate subcategory names under one parent require a subcategory choice", () => {
  const duplicateCategory = {
    ...category(1, "Food", "Daily"),
    subcategories: [{ id: 10, name: "Daily" }, { id: 11, name: "daily" }]
  };
  const result = resolveConciseCapture("DAILY", [duplicateCategory], [account]);
  assert.equal(result.status, "choose-subcategory");
  if (result.status === "choose-subcategory") {
    assert.deepEqual(result.subcategories.map((item) => item.id), [10, 11]);
  }
});

test("a subcategory selected under another category is rejected", () => {
  const categories = [category(1, "Food", "Daily"), category(2, "Transport", "Train")];
  const result = resolveConciseCapture("daily", categories, [account], 2, 10);
  assert.equal(result.status, "choose-subcategory");
  if (result.status === "choose-subcategory") assert.equal(result.category.id, 2);
});

test("a category without subcategories returns explicit guidance state", () => {
  const emptyCategory = { ...category(1, "Food", "Daily"), subcategories: [] };
  const result = resolveConciseCapture("daily", [emptyCategory], [account], 1);
  assert.equal(result.status, "no-subcategories");
  if (result.status === "no-subcategories") assert.equal(result.category.id, 1);
});

test("unknown concise text starts category selection and callback payloads stay compact", () => {
  const result = resolveConciseCapture("mystery", [category(1, "Food", "Eat out")], [account]);
  assert.equal(result.status, "choose-category");
  assert.ok(Buffer.byteLength(callbackData("0123456789abcdef", "s", Number.MAX_SAFE_INTEGER)) <= 64);
});

test("liability signs, net worth, and repayment are consistent", () => {
  const opening = normalizeOpeningBalance("loan", 1_000_000);
  assert.equal(opening, -1_000_000);
  assert.equal(netWorth([opening]), -1_000_000);
  const afterRepayment = opening + 50_000;
  assert.equal(debtAmount(afterRepayment), 950_000);
  assert.deepEqual(loanMetrics(opening, afterRepayment), {
    openingDebt: 1_000_000,
    remainingDebt: 950_000,
    repaidCents: 50_000,
    payoffProgress: 5
  });
});

test("asset opening balances are always positive", () => {
  assert.equal(normalizeOpeningBalance("cash", -50_000), 50_000);
  assert.equal(normalizeOpeningBalance("bank", -50_000), 50_000);
  assert.equal(normalizeOpeningBalance("investment", -50_000), 50_000);
});

test("net worth sums all account balances in SGD", () => {
  assert.equal(netWorthWithPortfolioValues([
    { balanceCents: 100_000 },
    { balanceCents: -10_000 },
    { balanceCents: 50_000 }
  ]), 140_000);
});

test("net worth substitutes investment valuations", () => {
  assert.equal(netWorthWithPortfolioValues([
    { id: 1, accountType: "bank", balanceCents: 100_000 },
    { id: 2, accountType: "investment", balanceCents: 50_000 },
    { id: 3, accountType: "investment", balanceCents: 20_000 }
  ], [
    { accountId: 2, portfolioValueCents: 65_000 },
    { accountId: 3, portfolioValueCents: 25_000 }
  ]), 190_000);
});
