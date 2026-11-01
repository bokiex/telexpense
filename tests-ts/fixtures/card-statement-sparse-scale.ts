import assert from "node:assert/strict";
import { reconcileStatementPayments } from "../../lib/card-statements";

// Thousands of known groups but no tracked allocations: a dense ledger would
// allocate three million empty per-statement maps even for this sparse input.
const baseline = Array.from({ length: 3000 }, (_, i) => ({ groupId: `group-${i}`, amountCents: 100 }));
const statements = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1, accountId: 1, closingDate: `${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-28`,
  originalAmountCents: 100, remainingAmountCents: 100, baseline: i === 0 ? baseline : []
}));
const result = reconcileStatementPayments(statements, []);
assert.deepEqual(result.remainingById, Object.fromEntries(statements.map((s) => [s.id, 100])));
assert.deepEqual(result.creditByAccount, { 1: 0 });
