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
  id: number; captureOrder?: number; accountId: number; closingDate: string; originalAmountCents: number; remainingAmountCents: number;
  baseline: readonly PaymentBaseline[];
};
export type CardPayment = PaymentBaseline & { accountId: number };

// Replay the observed baseline changes in capture order, then today's
// payments. A group owns its allocations and credit, so reductions can undo
// them without exploring combinations of other baselines. When identity is
// ambiguous, group IDs are processed lexicographically. A snapshot is
// authoritative when captured: only already-paid debt consumes prior credit.
// The first baseline's payments are attributed to its already-paid portion
// (up to that amount); any remainder is historical and is not available credit.
// Later reductions remove credit first and then allocations newest-first;
// allocations on newer statements can move to newly restored older debt.
// Credit can fill restored debt only on statements captured before that credit
// arose; older credit must not indirectly override an authoritative snapshot.
// After sorting, this is O(S^4 * G + B) time and O(S^2 * G + B) space per
// account, for S statements, G groups and B baseline/payment entries. It does
// not explore combinations of baselines.
export function reconcileStatementPayments(
  statements: readonly ReconciliationStatement[], payments: readonly CardPayment[]
): { remainingById: Record<number, number>; creditByAccount: Record<number, number> } {
  const remainingById: Record<number, number> = {};
  const creditByAccount: Record<number, number> = {};
  for (const accountId of new Set([...statements.map((s) => s.accountId), ...payments.map((p) => p.accountId)])) {
    const ordered = statements.filter((s) => s.accountId === accountId)
      .sort((a, b) => (a.captureOrder ?? a.id) - (b.captureOrder ?? b.id) || a.id - b.id);
    const accountPayments = payments.filter((p) => p.accountId === accountId);
    if (!ordered.length) {
      creditByAccount[accountId] = 0;
      continue;
    }
    const ids = [...new Set([...accountPayments, ...ordered.flatMap((s) => s.baseline)].map((p) => p.groupId))].sort();
    const amounts = (items: readonly PaymentBaseline[]) => {
      const result = new Map<string, number>();
      for (const item of items) result.set(item.groupId, (result.get(item.groupId) ?? 0) + item.amountCents);
      return result;
    };
    // Credit and allocation buckets retain the capture boundary at which the
    // payment arose. Bucket n may fill restored debt at capture indices < n,
    // even after credit was attributed to a later already-paid snapshot.
    const ledger = new Map(ids.map((id) => [id, { amount: 0, credit: new Array<number>(ordered.length + 1).fill(0), allocated: ordered.map(() => new Map<number, number>()) }]));
    const addAllocation = (buckets: Map<number, number>, cutoff: number, amount: number) => {
      if (amount) buckets.set(cutoff, (buckets.get(cutoff) ?? 0) + amount);
    };
    const remaining: number[] = [];
    const allocatedTotals = new Array<number>(ordered.length).fill(0);
    const apply = (target: Map<string, number>) => {
      // Undo all reductions before allocating increases, including replacements.
      const restored = new Array<number>(remaining.length).fill(0);
      const oldest = remaining.map((_, i) => i).sort((a, b) =>
        ordered[a].closingDate.localeCompare(ordered[b].closingDate) || ordered[a].id - ordered[b].id);
      for (const id of ids) {
        const group = ledger.get(id)!;
        const next = target.get(id) ?? 0;
        let reduction = Math.max(0, group.amount - next);
        for (let n = remaining.length; n >= 0 && reduction > 0; n--) {
          const credit = Math.min(reduction, group.credit[n]);
          group.credit[n] -= credit;
          reduction -= credit;
        }
        for (const i of [...oldest].reverse()) {
          if (reduction <= 0) break;
          for (const cutoff of [...group.allocated[i].keys()].sort((a, b) => b - a)) {
            const undo = Math.min(reduction, group.allocated[i].get(cutoff)!);
            const left = group.allocated[i].get(cutoff)! - undo;
            if (left) group.allocated[i].set(cutoff, left);
            else group.allocated[i].delete(cutoff);
            allocatedTotals[i] -= undo;
            remaining[i] += undo;
            restored[i] += undo;
            reduction -= undo;
            if (reduction === 0) break;
          }
        }
      }
      // Only fill newly restored debt: pre-existing unpaid snapshot amounts
      // must not consume allocations that the snapshot already included.
      for (const [position, older] of oldest.entries()) {
        // Most observations restore no debt. Stop as soon as the restored
        // amount is filled, rather than scanning every later allocation.
        for (let p = position + 1; p < oldest.length && restored[older] > 0; p++) {
          const newer = oldest[p];
          if (allocatedTotals[newer] === 0) continue;
          for (const id of ids) {
            if (restored[older] === 0 || allocatedTotals[newer] === 0) break;
            const group = ledger.get(id)!;
            for (const [cutoff, amount] of group.allocated[newer]) {
              if (cutoff <= older) continue;
              const moved = Math.min(restored[older], amount);
              if (amount === moved) group.allocated[newer].delete(cutoff);
              else group.allocated[newer].set(cutoff, amount - moved);
              addAllocation(group.allocated[older], cutoff, moved);
              allocatedTotals[newer] -= moved;
              allocatedTotals[older] += moved;
              remaining[newer] += moved;
              remaining[older] -= moved;
              restored[newer] += moved;
              restored[older] -= moved;
              if (restored[older] === 0) break;
            }
          }
        }
        // Only credit created after this snapshot can replace a deleted
        // allocation without indirectly overriding its authoritative amount.
        for (const id of ids) {
          if (restored[older] === 0) break;
          const group = ledger.get(id)!;
          for (let n = older + 1; n <= remaining.length && restored[older] > 0; n++) {
            const moved = Math.min(restored[older], group.credit[n]);
            group.credit[n] -= moved;
            addAllocation(group.allocated[older], n, moved);
            allocatedTotals[older] += moved;
            remaining[older] -= moved;
            restored[older] -= moved;
          }
        }
      }
      for (const id of ids) {
        const group = ledger.get(id)!;
        const next = target.get(id) ?? 0;
        let increase = Math.max(0, next - group.amount);
        for (const i of oldest) {
          if (increase <= 0) break;
          const paid = Math.min(increase, remaining[i]);
          remaining[i] -= paid;
          addAllocation(group.allocated[i], remaining.length, paid);
          allocatedTotals[i] += paid;
          increase -= paid;
        }
        group.credit[remaining.length] += increase;
        group.amount = next;
      }
    };
    const first = ordered[0];
    const initial = amounts(first.baseline);
    remaining.push(first.remainingAmountCents);
    let implicitPaid = first.originalAmountCents - first.remainingAmountCents;
    for (const id of ids) {
      const group = ledger.get(id)!;
      group.amount = initial.get(id) ?? 0;
      const attributed = Math.min(group.amount, implicitPaid);
      addAllocation(group.allocated[0], 1, attributed);
      allocatedTotals[0] += attributed;
      implicitPaid -= attributed;
    }
    for (let i = 1; i < ordered.length; i++) {
      const statement = ordered[i];
      apply(amounts(statement.baseline));
      remaining.push(statement.remainingAmountCents);
      let paid = statement.originalAmountCents - statement.remainingAmountCents;
      for (const id of ids) {
        const group = ledger.get(id)!;
        for (let n = 0; n <= i && paid > 0; n++) {
          const attributed = Math.min(group.credit[n], paid);
          group.credit[n] -= attributed;
          addAllocation(group.allocated[i], n, attributed);
          allocatedTotals[i] += attributed;
          paid -= attributed;
        }
      }
    }
    apply(amounts(accountPayments));
    ordered.forEach((statement, i) => { remainingById[statement.id] = remaining[i]; });
    creditByAccount[accountId] = ids.reduce((sum, id) => sum + ledger.get(id)!.credit.reduce((a, b) => a + b, 0), 0);
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
