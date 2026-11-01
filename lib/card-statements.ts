import { isValidDate } from "@/lib/validation";

export type StatementSnapshotInput = {
  accountId: number;
  closingDate: string;
  dueDate: string;
  originalAmountCents: number;
  remainingAmountCents: number;
};

// The caller must supply only payments not already represented by the snapshots.
// This calculation does not mutate statements or account balances.
export function allocateStatementPayments(
  statements: readonly { id: number; closingDate: string; remainingAmountCents: number }[],
  paymentCents: number
): { remainingById: Record<number, number>; creditCents: number } {
  const remainingById: Record<number, number> = {};
  let creditCents = paymentCents;
  for (const statement of [...statements].sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.id - b.id)) {
    const allocated = Math.min(statement.remainingAmountCents, creditCents);
    remainingById[statement.id] = statement.remainingAmountCents - allocated;
    creditCents -= allocated;
  }
  return { remainingById, creditCents };
}

// Older captured baselines predate source identity and cannot preserve a
// non-bank source after reclassification without guessing its identity.
export type PaymentBaseline = { groupId: string; amountCents: number; sourceAccountId?: number };
export type ReconciliationStatement = {
  id: number; accountId: number; closingDate: string; originalAmountCents: number; remainingAmountCents: number;
  baseline: readonly PaymentBaseline[];
};
export type CardPayment = PaymentBaseline & { accountId: number };

// Each imported remaining amount is authoritative at its own baseline. Compare
// payments by group identity against each baseline, accounting for allocations
// to older statements before applying changes to this statement.
// Negative deltas restore debt (including debt that was implicit in a snapshot).
// Attribution rule: an imported snapshot's already-paid portion consumes any
// available older credit first. The issuer may actually have received an
// untracked payment, but that distinction cannot be recovered from the input.
// The remaining amount is authoritative at capture; later payment reductions
// restore the attributed portion. Unused credit remains available only when it
// can be established from changes after a first snapshot.
export function reconcileStatementPayments(
  statements: readonly ReconciliationStatement[], payments: readonly CardPayment[]
): { remainingById: Record<number, number>; creditByAccount: Record<number, number> } {
  const remainingById: Record<number, number> = {};
  const creditByAccount: Record<number, number> = {};
  for (const accountId of new Set([...statements.map((s) => s.accountId), ...payments.map((p) => p.accountId)])) {
    const ordered = statements.filter((s) => s.accountId === accountId)
      .sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.id - b.id);
    const accountPayments = payments.filter((p) => p.accountId === accountId);
    const ids = [...new Set([...accountPayments, ...ordered.flatMap((s) => s.baseline)].map((p) => p.groupId))].sort();
    const vector = (items: readonly PaymentBaseline[]) => ids.map((id) => items.filter((p) => p.groupId === id).reduce((sum, p) => sum + p.amountCents, 0));
    const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);
    const current = vector(accountPayments);
    if (!ordered.length) {
      creditByAccount[accountId] = 0;
      continue;
    }
    const baselines = ordered.map((s) => vector(s.baseline));
    const memo = new Map<string, number>();
    const allocatedThrough = (count: number, values: readonly number[]): number => {
      if (!count) return 0;
      const key = `${count}:${values.join(",")}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const i = count - 1;
      const baseline = baselines[i];
      // Restore reductions first, before applying increases/new identities.
      // Netting them would hide a replacement when restoration is capped.
      const reduced = values.map((value, index) => Math.min(value, baseline[index]));
      const beforeBase = allocatedThrough(i, baseline);
      const beforeReduced = allocatedThrough(i, reduced);
      const before = allocatedThrough(i, values);
      let decrease = total(reduced) - total(baseline) - beforeReduced + beforeBase;
      const priorCredit = creditThrough(i, baseline);
      const attributedCredit = Math.min(priorCredit, ordered[i].originalAmountCents - ordered[i].remainingAmountCents);
      if (decrease < 0) decrease += Math.min(-decrease, priorCredit - attributedCredit);
      const restoredLimit = ordered[i].remainingAmountCents - ordered[i].originalAmountCents;
      const afterDecrease = Math.max(restoredLimit, Math.min(ordered[i].remainingAmountCents, decrease));
      const increase = total(values) - total(reduced) - before + beforeReduced;
      const result = before + Math.max(restoredLimit, Math.min(ordered[i].remainingAmountCents, afterDecrease + increase));
      memo.set(key, result);
      return result;
    };
    // Attribute only credit established after an earlier snapshot; transactions
    // already present at the first capture do not imply historical credit.
    const creditMemo = new Map<string, number>();
    const creditThrough = (count: number, values: readonly number[]): number => {
      if (!count) return 0;
      const key = `${count}:${values.join(",")}`;
      const cached = creditMemo.get(key);
      if (cached !== undefined) return cached;
      const baseline = baselines[count - 1];
      const reduced = values.map((value, index) => Math.min(value, baseline[index]));
      const previousCredit = creditThrough(count - 1, baseline);
      const attributedCredit = Math.min(previousCredit, ordered[count - 1].originalAmountCents - ordered[count - 1].remainingAmountCents);
      const afterDecrease = Math.max(0, previousCredit - attributedCredit + total(reduced) - total(baseline) -
        allocatedThrough(count, reduced) + allocatedThrough(count, baseline));
      const credit = Math.max(0, afterDecrease + total(values) - total(reduced) -
        allocatedThrough(count, values) + allocatedThrough(count, reduced));
      creditMemo.set(key, credit);
      return credit;
    };
    ordered.forEach((statement, i) => {
      const paid = allocatedThrough(i + 1, current) - allocatedThrough(i, current);
      remainingById[statement.id] = statement.remainingAmountCents - paid;
    });
    creditByAccount[accountId] = creditThrough(ordered.length, current);
  }
  return { remainingById, creditByAccount };
}

export function parseStatementSnapshot(value: unknown): StatementSnapshotInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const money = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 2147483647;
  if (typeof input.accountId !== "number" || !Number.isSafeInteger(input.accountId) || input.accountId <= 0 ||
      typeof input.closingDate !== "string" || !isValidDate(input.closingDate) ||
      typeof input.dueDate !== "string" || !isValidDate(input.dueDate) ||
      !money(input.originalAmountCents) || !money(input.remainingAmountCents) ||
      input.remainingAmountCents > input.originalAmountCents) return null;
  return { accountId: input.accountId, closingDate: input.closingDate, dueDate: input.dueDate,
    originalAmountCents: input.originalAmountCents, remainingAmountCents: input.remainingAmountCents };
}
