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

export type PaymentBaseline = { groupId: string; amountCents: number };
export type ReconciliationStatement = {
  id: number; accountId: number; closingDate: string; originalAmountCents: number; remainingAmountCents: number;
  baseline: readonly PaymentBaseline[];
};
export type CardPayment = PaymentBaseline & { accountId: number };

// Each imported remaining amount is authoritative at its own baseline. Compare
// both the current payment total and the baseline total against older statements
// so an amount already assigned there is not also assigned to this statement.
// Negative deltas restore debt (including debt that was implicit in a snapshot).
// Attribution rule: an imported snapshot's already-paid portion consumes any
// available older credit first. The issuer may actually have received an
// untracked payment, but that distinction cannot be recovered from the input.
// The remaining amount is authoritative at capture; later payment reductions
// restore the attributed portion. Unused credit remains available.
export function reconcileStatementPayments(
  statements: readonly ReconciliationStatement[], payments: readonly CardPayment[]
): { remainingById: Record<number, number>; creditByAccount: Record<number, number> } {
  const remainingById: Record<number, number> = {};
  const creditByAccount: Record<number, number> = {};
  for (const accountId of new Set([...statements.map((s) => s.accountId), ...payments.map((p) => p.accountId)])) {
    const ordered = statements.filter((s) => s.accountId === accountId)
      .sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.id - b.id);
    const current = payments.filter((p) => p.accountId === accountId).reduce((sum, p) => sum + p.amountCents, 0);
    if (!ordered.length) {
      creditByAccount[accountId] = Math.max(0, current);
      continue;
    }
    const baselines = ordered.map((s) => s.baseline.reduce((sum, p) => sum + p.amountCents, 0));
    const memo = new Map<string, number>();
    const allocatedThrough = (count: number, total: number): number => {
      if (!count) return 0;
      const key = `${count}:${total}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const i = count - 1;
      const before = allocatedThrough(i, total);
      let available = total - baselines[i] - before + allocatedThrough(i, baselines[i]);
      // Previously unallocated credit absorbs a decrease before debt on a
      // later imported snapshot can be restored.
      const priorCredit = creditThrough(i, baselines[i]);
      const attributedCredit = Math.min(priorCredit, ordered[i].originalAmountCents - ordered[i].remainingAmountCents);
      if (available < 0) available += Math.min(-available, priorCredit - attributedCredit);
      const restoredLimit = ordered[i].remainingAmountCents - ordered[i].originalAmountCents;
      const result = before + Math.max(restoredLimit, Math.min(ordered[i].remainingAmountCents, available));
      memo.set(key, result);
      return result;
    };
    // Attribute prior credit to the already-paid portion of this snapshot,
    // then carry any unused credit separately from later payment changes.
    const creditMemo = new Map<string, number>();
    const creditThrough = (count: number, total: number): number => {
      if (!count) return 0;
      const key = `${count}:${total}`;
      const cached = creditMemo.get(key);
      if (cached !== undefined) return cached;
      const baseline = baselines[count - 1];
      const previousCredit = creditThrough(count - 1, baseline);
      const attributedCredit = Math.min(previousCredit, ordered[count - 1].originalAmountCents - ordered[count - 1].remainingAmountCents);
      const credit = Math.max(0, previousCredit - attributedCredit + total - baseline -
        allocatedThrough(count, total) + allocatedThrough(count, baseline));
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
