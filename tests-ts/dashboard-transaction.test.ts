import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCreatedTransaction } from "../lib/dashboardTransaction";
import { budgetActivityTotals, incomeAllocationTotals } from "../lib/repository";
import type { RecentTransaction, Summary } from "../components/Dashboard";

const now = new Date("2026-04-20T12:00:00Z");
function snapshot(): Summary {
  return {
    user: { firstName: null, username: null }, month: "2026-04", categories: [], subcategories: [], budgets: [],
    health: { spentCents: 0, ordinarySpentCents: 0, savingsAllocatedCents: 0, progressCents: 0,
      progressByGroup: { Needs: 0, Wants: 0, Savings: 0 }, budgetCents: 10000, remainingCents: 10000,
      budgetUsed: 0, daysLeft: 11, dailySafeCents: 909, projectedSpendCents: 0 },
    daily: [], incomeAllocation: { incomeCents: 0, spentCents: 0, savedCents: 0, unallocatedCents: 0 },
    spendingTrend: { daily: [{ periodStart: "2026-04-20", spentCents: 0 }],
      weekly: [{ periodStart: "2026-04-20", spentCents: 0 }], monthly: [{ periodStart: "2026-04", spentCents: 0 }] },
    storedCategories: [{ id: 1, sourceKey: "food", sourceName: "food", name: "Food", group: "Needs", color: "", icon: "", active: true,
      subcategories: [{ id: 3, name: "Lunch" }] },
      { id: 2, sourceKey: "savings", sourceName: "savings", name: "Savings", group: "Savings", color: "", icon: "", active: true, subcategories: [] }],
    accounts: [{ id: 1, accountKey: "cash", name: "Cash", institution: null, accountType: "cash", openingBalanceCents: 20000,
      balanceCents: 20000, color: "", icon: "", active: true }],
    portfolioSnapshots: [], recurringRules: [], loanProgress: [], recent: []
  };
}
function expense(): RecentTransaction {
  return { id: 4, kind: "expense", category: "food", subcategoryId: 3, accountId: 1, transferGroupId: null,
    savingsAllocation: false, transferFromAccountId: null, transferToAccountId: null, recurringRuleId: null,
    description: "Lunch", amountCents: -2000, occurredOn: "2026-04-20" };
}

test("confirmed ordinary expense updates the dashboard without mutating the source", () => {
  const before = snapshot();
  const after = applyCreatedTransaction(before, expense(), now)!;
  assert.equal(before.accounts[0].balanceCents, 20000);
  assert.equal(after.accounts[0].balanceCents, 18000);
  assert.equal(after.categories[0].spentCents, 2000);
  assert.equal(after.subcategories[0].spentCents, 2000);
  assert.equal(after.daily[0].spentCents, 2000);
  assert.equal(after.health.spentCents, 2000);
  assert.equal(after.health.progressByGroup?.Needs, 2000);
  assert.equal(after.health.remainingCents, 8000);
  assert.equal(after.health.dailySafeCents, 727);
  assert.equal(after.health.projectedSpendCents, 3000);
  assert.deepEqual(after.incomeAllocation, { incomeCents: 0, spentCents: 2000, savedCents: 0, unallocatedCents: -2000 });
  assert.equal(after.spendingTrend.daily[0].spentCents, 2000);
  assert.equal(after.spendingTrend.weekly[0].spentCents, 2000);
  assert.equal(after.spendingTrend.monthly[0].spentCents, 2000);
  assert.equal(after.recent[0].id, 4);
});

test("savings expenses affect allocation, but not ordinary spending trends", () => {
  const after = applyCreatedTransaction(snapshot(), { ...expense(), category: "savings", subcategoryId: null }, now)!;
  assert.equal(after.health.savingsAllocatedCents, 2000);
  assert.equal(after.health.ordinarySpentCents, 0);
  assert.equal(after.health.progressByGroup?.Savings, 2000);
  assert.equal(after.incomeAllocation.savedCents, 2000);
  assert.equal(after.daily[0].spentCents, 2000);
  assert.equal(after.spendingTrend.daily[0].spentCents, 0);
});

test("income on a loan updates the balance and repayment progress", () => {
  const before = snapshot();
  before.accounts[0] = { ...before.accounts[0], accountType: "loan", openingBalanceCents: -10000, balanceCents: -8000 };
  before.loanProgress = [{ accountId: 1, name: "Cash", openingBalanceCents: -10000, balanceCents: -8000,
    repaidCents: 2000, repaymentThisMonthCents: 0, payoffProgress: 20 }];
  const after = applyCreatedTransaction(before, { ...expense(), kind: "income", amountCents: 2000 }, now)!;
  assert.equal(after.accounts[0].balanceCents, -6000);
  assert.equal(after.loanProgress[0].repaidCents, 4000);
  assert.equal(after.loanProgress[0].repaymentThisMonthCents, 2000);
  assert.equal(after.loanProgress[0].payoffProgress, 40);
  assert.equal(after.incomeAllocation.unallocatedCents, 2000);
});

test("incremental budget and income allocation match the server's financial rules", () => {
  const transactions: RecentTransaction[] = [expense(),
    { ...expense(), id: 5, category: "savings", subcategoryId: null },
    { ...expense(), id: 6, kind: "income", amountCents: 9000 }];
  let current = snapshot();
  for (const transaction of transactions) current = applyCreatedTransaction(current, transaction, now)!;
  const rows = transactions.map((transaction) => ({ kind: transaction.kind, category: transaction.category,
    amount_cents: transaction.amountCents, transfer_group_id: transaction.transferGroupId }));
  const activity = budgetActivityTotals(rows, current.storedCategories);
  assert.equal(current.health.ordinarySpentCents, activity.ordinarySpentCents);
  assert.equal(current.health.savingsAllocatedCents, activity.savingsAllocatedCents);
  assert.equal(current.health.progressCents, activity.progressCents);
  assert.deepEqual(current.health.progressByGroup, activity.progressByGroup);
  assert.deepEqual(current.incomeAllocation, incomeAllocationTotals(rows, current.storedCategories));
});

test("unsupported or incomplete changes require a server refresh", () => {
  assert.equal(applyCreatedTransaction(snapshot(), { ...expense(), occurredOn: "2026-03-20" }, now), null);
  assert.equal(applyCreatedTransaction(snapshot(), { ...expense(), kind: "investment" }, now), null);
  assert.equal(applyCreatedTransaction(snapshot(), { ...expense(), accountId: null }, now), null);
  assert.equal(applyCreatedTransaction(snapshot(), { ...expense(), subcategoryId: 55 }, now), null);
  const before = snapshot();
  before.recent = [expense()];
  assert.equal(applyCreatedTransaction(before, expense(), now), null);
});
