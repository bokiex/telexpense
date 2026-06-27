import assert from "node:assert/strict";
import test from "node:test";
import { debtAmount, loanMetrics, netWorth, netWorthByCurrency, normalizeOpeningBalance } from "../lib/finance";
import { normalizeIdentity, resolveIdentity } from "../lib/identity";
import { parseTransactionMessage } from "../lib/parser";

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

test("Telegram parser normalizes category/account and signs expense", () => {
  const parsed = parseTransactionMessage("  FoOd , Main   Card, Lunch, $4.20");
  assert.equal(parsed.category, "food");
  assert.equal(parsed.account, "main card");
  assert.equal(parsed.amountCents, -420);
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
