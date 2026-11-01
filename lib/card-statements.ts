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
// ambiguous, group IDs are processed lexicographically. Every snapshot's
// implied paid portion is historical and is never attributed to tracked credit.
// The first baseline is historical. Only group amounts above
// that baseline are tracked, including across subsequent captures. Reductions
// remove tracked credit first and then allocations newest-first;
// allocations on newer statements can move to newly restored older debt.
// Credit can fill restored debt only on statements captured before that credit
// arose; older credit must not indirectly override an authoritative snapshot.
// The ledger stores only nonzero credit and allocation buckets, rather than
// preallocating a statement-by-group matrix. Its size depends on actual
// payment changes and allocations, not all possible statement/group pairs.
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
    const initial = amounts(ordered[0].baseline);
    // Ignore the historical portion on every observation, not just the first:
    // a deleted and reappearing baseline group is not a new payment.
    const trackedAmounts = (items: readonly PaymentBaseline[]) => {
      const observed = amounts(items);
      for (const [id, amount] of observed) observed.set(id, Math.max(0, amount - (initial.get(id) ?? 0)));
      return observed;
    };
    // Credit and allocation buckets retain the capture boundary at which the
    // payment arose. Bucket n may fill restored debt at capture indices < n.
    const ledger = new Map(ids.map((id) => [id, { amount: 0, credit: new Map<number, number>(), allocated: new Map<number, Map<number, number>>() }]));
    const allocation = (group: { allocated: Map<number, Map<number, number>> }, i: number) => {
      let buckets = group.allocated.get(i);
      if (!buckets) group.allocated.set(i, buckets = new Map());
      return buckets;
    };
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
        for (const n of [...group.credit.keys()].sort((a, b) => b - a)) {
          if (!reduction) break;
          const amount = group.credit.get(n)!;
          const credit = Math.min(reduction, amount);
          if (amount === credit) group.credit.delete(n);
          else group.credit.set(n, amount - credit);
          reduction -= credit;
        }
        for (const i of [...oldest].reverse()) {
          if (reduction <= 0) break;
          const buckets = group.allocated.get(i);
          if (!buckets) continue;
          for (const cutoff of [...buckets.keys()].sort((a, b) => b - a)) {
            const undo = Math.min(reduction, buckets.get(cutoff)!);
            const left = buckets.get(cutoff)! - undo;
            if (left) buckets.set(cutoff, left);
            else buckets.delete(cutoff);
            allocatedTotals[i] -= undo;
            remaining[i] += undo;
            restored[i] += undo;
            reduction -= undo;
            if (reduction === 0) break;
          }
          if (!buckets.size) group.allocated.delete(i);
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
            const buckets = group.allocated.get(newer);
            if (!buckets) continue;
            for (const [cutoff, amount] of buckets) {
              if (cutoff <= older) continue;
              const moved = Math.min(restored[older], amount);
              if (amount === moved) buckets.delete(cutoff);
              else buckets.set(cutoff, amount - moved);
              addAllocation(allocation(group, older), cutoff, moved);
              allocatedTotals[newer] -= moved;
              allocatedTotals[older] += moved;
              remaining[newer] += moved;
              remaining[older] -= moved;
              restored[newer] += moved;
              restored[older] -= moved;
              if (restored[older] === 0) break;
            }
            if (!buckets.size) group.allocated.delete(newer);
          }
        }
        // Use the earliest eligible cutoff across all groups first. A later
        // cutoff can also cover newer restored debt; an earlier one cannot.
        if (restored[older] > 0) {
          const candidates = ids.flatMap((id) => [...ledger.get(id)!.credit.keys()]
            .filter((n) => n > older).map((n) => ({ id, n })));
          candidates.sort((a, b) => a.n - b.n || a.id.localeCompare(b.id));
          for (const { id, n } of candidates) {
            if (!restored[older]) break;
            const group = ledger.get(id)!;
            const amount = group.credit.get(n)!;
            const moved = Math.min(restored[older], amount);
            if (amount === moved) group.credit.delete(n);
            else group.credit.set(n, amount - moved);
            addAllocation(allocation(group, older), n, moved);
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
          if (paid) addAllocation(allocation(group, i), remaining.length, paid);
          allocatedTotals[i] += paid;
          increase -= paid;
        }
        if (increase) group.credit.set(remaining.length, (group.credit.get(remaining.length) ?? 0) + increase);
        group.amount = next;
      }
    };
    remaining.push(ordered[0].remainingAmountCents);
    for (let i = 1; i < ordered.length; i++) {
      const statement = ordered[i];
      apply(trackedAmounts(statement.baseline));
      remaining.push(statement.remainingAmountCents);
    }
    apply(trackedAmounts(accountPayments));
    ordered.forEach((statement, i) => { remainingById[statement.id] = remaining[i]; });
    creditByAccount[accountId] = ids.reduce((sum, id) => sum + [...ledger.get(id)!.credit.values()].reduce((a, b) => a + b, 0), 0);
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
