import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount } from "../lib/amountFormat";
import { debtAmount, loanMetrics, netWorth, netWorthByCurrency, normalizeOpeningBalance } from "../lib/finance";
import { normalizeIdentity, resolveIdentity } from "../lib/identity";
import { isConciseTransactionMessage, parseConciseTransactionMessage, parseTransactionMessage } from "../lib/parser";
import { callbackData, resolveConciseCapture } from "../lib/transactionCapture";
import type { StoredAccount, StoredCategory } from "../lib/repository";
import { budgetActivityTotals, effectiveBudgetCents, subcategoryDisplayName } from "../lib/repository";
import { themeBudgetCategory } from "../lib/budgetThemes";
import {
  genericTransactionKindError,
  groupedTransactionEditError,
  transactionCategory,
  transactionCategoryError
} from "../lib/transactionCategory";
import { transferAccounts } from "../lib/transfer";
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
    { category: "food", subcategoryId: null, budgetCents: 100_00, currency: "USD" },
    { category: "food", subcategoryId: 10, budgetCents: 40_00, currency: "USD" },
    { category: "transport", subcategoryId: 20, budgetCents: 25_00, currency: "USD" }
  ]), 125_00);
});

test("effective budget total ignores synthetic theme targets", () => {
  assert.equal(effectiveBudgetCents([
    { category: themeBudgetCategory("Needs"), subcategoryId: null, budgetCents: 500_00, currency: "USD" },
    { category: "food", subcategoryId: null, budgetCents: 100_00, currency: "USD" },
    { category: "transport", subcategoryId: 20, budgetCents: 25_00, currency: "USD" }
  ]), 125_00);
});

test("budget activity separates ordinary spending from savings allocation", () => {
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
  assert.equal(totals.savingsAllocatedCents, 125_00);
  assert.equal(totals.progressCents, 165_00);
  assert.deepEqual(totals.progressByGroup, { Needs: 40_00, Wants: 0, Savings: 125_00 });
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

test("frontend amount display omits currency markers", () => {
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
  const parsed = parseTransactionMessage("  FoOd , Main   Card, Lunch, $4.20");
  assert.equal(parsed.category, "food");
  assert.equal(parsed.account, "main card");
  assert.equal(parsed.amountCents, -420);
});

test("concise Telegram parser extracts amount and subcategory text", () => {
  assert.deepEqual(parseConciseTransactionMessage("4.20 eat out"), {
    kind: "expense", description: "eat out", amountCents: -420, currency: "USD"
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
  openingBalanceCents: 0, balanceCents: 0, currency: "USD", color: "#000", icon: "Wallet", active: true
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

test("net worth keeps currencies separate", () => {
  assert.deepEqual(netWorthByCurrency([
    { balanceCents: 100_000, currency: "SGD" },
    { balanceCents: -10_000, currency: "SGD" },
    { balanceCents: 50_000, currency: "USD" }
  ]), {
    SGD: 90_000,
    USD: 50_000
  });
});

test("net worth substitutes investment valuations without converting currencies", () => {
  assert.deepEqual(netWorthByCurrency([
    { id: 1, accountType: "bank", balanceCents: 100_000, currency: "SGD" },
    { id: 2, accountType: "investment", balanceCents: 50_000, currency: "SGD" },
    { id: 3, accountType: "investment", balanceCents: 20_000, currency: "USD" }
  ], [
    { accountId: 2, portfolioValueCents: 65_000, currency: "SGD" },
    { accountId: 3, portfolioValueCents: 25_000, currency: "USD" }
  ]), {
    SGD: 165_000,
    USD: 25_000
  });
});
