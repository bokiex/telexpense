import type { RecentTransaction, Summary } from "@/components/Dashboard";
import { loanMetrics } from "@/lib/finance";
import { normalizeIdentity } from "@/lib/identity";

/** Apply a confirmed ordinary transaction creation, or return null if a refresh is required. */
export function applyCreatedTransaction(summary: Summary, tx: RecentTransaction, now = new Date()): Summary | null {
  if (!tx || !Number.isSafeInteger(tx.id) || tx.id <= 0 || tx.transferGroupId || tx.recurringRuleId ||
      (tx.kind !== "expense" && tx.kind !== "income") ||
      !Number.isSafeInteger(tx.amountCents) || (tx.kind === "expense" ? tx.amountCents >= 0 : tx.amountCents <= 0) ||
      !tx.category || !Number.isSafeInteger(tx.accountId) || !/^\d{4}-\d{2}-\d{2}$/.test(tx.occurredOn) ||
      tx.occurredOn.slice(0, 7) !== summary.month ||
      summary.recent.some((item) => item.id === tx.id) ||
      !summary.health.progressByGroup || summary.health.ordinarySpentCents === undefined ||
      summary.health.savingsAllocatedCents === undefined || summary.health.progressCents === undefined) return null;

  const account = summary.accounts.find((item) => item.id === tx.accountId);
  const category = summary.storedCategories.find((item) => normalizeIdentity(item.sourceName) === normalizeIdentity(tx.category!));
  if (!account || !category || (tx.subcategoryId !== null && !category.subcategories.some((item) => item.id === tx.subcategoryId))) return null;

  const result = structuredClone(summary);
  const targetAccount = result.accounts.find((item) => item.id === tx.accountId)!;
  targetAccount.balanceCents += tx.amountCents;
  const loan = result.loanProgress.find((item) => item.accountId === tx.accountId);
  if (targetAccount.accountType === "loan") {
    if (!loan) return null;
    loan.balanceCents = targetAccount.balanceCents;
    const metrics = loanMetrics(loan.openingBalanceCents, loan.balanceCents);
    loan.repaidCents = metrics.repaidCents;
    loan.payoffProgress = metrics.payoffProgress;
    if (tx.amountCents > 0) loan.repaymentThisMonthCents += tx.amountCents;
  }

  if (tx.kind === "income") {
    result.incomeAllocation.incomeCents += tx.amountCents;
    result.incomeAllocation.unallocatedCents += tx.amountCents;
  } else {
    const spent = -tx.amountCents;
    const savings = category.group === "Savings";
    const health = result.health;
    if (savings) health.savingsAllocatedCents! += spent;
    else health.ordinarySpentCents! += spent;
    health.spentCents = health.ordinarySpentCents!;
    health.progressCents! += spent;
    health.progressByGroup![category.group] += spent;
    health.remainingCents = health.budgetCents - health.progressCents!;
    health.budgetUsed = health.budgetCents ? Math.round(health.progressCents! / health.budgetCents * 100) : 0;
    health.dailySafeCents = health.daysLeft > 0 ? Math.floor(Math.max(0, health.remainingCents) / health.daysLeft) : 0;
    const daysInMonth = new Date(Date.UTC(Number(summary.month.slice(0, 4)), Number(summary.month.slice(5, 7)), 0)).getUTCDate();
    const currentMonth = now.toISOString().slice(0, 7);
    const elapsed = summary.month < currentMonth ? daysInMonth : summary.month > currentMonth ? 0 : now.getUTCDate();
    health.projectedSpendCents = elapsed > 0 ? Math.round(health.ordinarySpentCents! / elapsed * daysInMonth) : health.ordinarySpentCents!;
    if (savings) result.incomeAllocation.savedCents += spent;
    else result.incomeAllocation.spentCents += spent;
    result.incomeAllocation.unallocatedCents -= spent;

    const categorySpend = result.categories.find((item) => item.category === tx.category);
    if (categorySpend) categorySpend.spentCents += spent;
    else result.categories.push({ category: tx.category, categoryId: null, subcategoryId: null, spentCents: spent });
    result.categories.sort((a, b) => b.spentCents - a.spentCents);
    if (tx.subcategoryId !== null) {
      const subcategory = result.subcategories.find((item) => item.subcategoryId === tx.subcategoryId);
      if (subcategory) subcategory.spentCents += spent;
      else result.subcategories.push({ category: tx.category, subcategoryId: tx.subcategoryId, spentCents: spent });
      result.subcategories.sort((a, b) => b.spentCents - a.spentCents);
    }
    const daily = result.daily.find((item) => item.date === tx.occurredOn);
    if (daily) daily.spentCents += spent;
    else result.daily.push({ date: tx.occurredOn, spentCents: spent });
    result.daily.sort((a, b) => a.date.localeCompare(b.date));
    if (!savings) {
      for (const point of result.spendingTrend.daily) if (point.periodStart === tx.occurredOn) point.spentCents += spent;
      for (const point of result.spendingTrend.weekly) {
        const end = new Date(`${point.periodStart}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 7);
        if (tx.occurredOn >= point.periodStart && tx.occurredOn < end.toISOString().slice(0, 10)) point.spentCents += spent;
      }
      for (const point of result.spendingTrend.monthly) if (point.periodStart === summary.month) point.spentCents += spent;
    }
  }

  result.recent = [...result.recent, tx]
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id - a.id)
    .slice(0, 20);
  return result;
}
