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

// Imported snapshots are authoritative at creation: earlier transfers may already be
// reflected in their remaining amount. Never replay those transfers into them.
export function allocateSnapshotPayments(
  snapshots: readonly { id: number; accountId: number; closingDate: string; remainingAmountCents: number; createdAt: string }[],
  payments: readonly { accountId: number; amountCents: number; createdAt: string; id: number }[]
): Record<number, number> {
  const remaining = Object.fromEntries(snapshots.map((s) => [s.id, s.remainingAmountCents]));
  const ordered = [...snapshots].sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.id - b.id);
  for (const payment of [...payments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) {
    let credit = payment.amountCents;
    for (const snapshot of ordered) {
      if (snapshot.accountId !== payment.accountId || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Number.isFinite(Date.parse(payment.createdAt)) || Date.parse(payment.createdAt) <= Date.parse(snapshot.createdAt)) continue;
      const allocated = Math.min(remaining[snapshot.id], credit);
      remaining[snapshot.id] -= allocated;
      credit -= allocated;
      if (!credit) break;
    }
  }
  return remaining;
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
