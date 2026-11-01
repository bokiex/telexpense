import assert from "node:assert/strict";
import { reconcileStatementPayments } from "../../lib/card-statements";

// Each baseline omits a different group. Their intersections create an
// exponential number of combinations in the former recursive implementation.
// No payment survives, so all full snapshots end full and no credit survives.
for (const size of [20, 24]) {
  const statements = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    accountId: 1,
    closingDate: `2024-01-${String(i + 1).padStart(2, "0")}`,
    originalAmountCents: 10000,
    remainingAmountCents: 10000,
    baseline: Array.from({ length: size }, (_, j) => ({
      groupId: `g${String(j).padStart(2, "0")}`, amountCents: 100
    })).filter((_, j) => i !== j)
  }));
  assert.deepEqual(reconcileStatementPayments(statements, []), {
    remainingById: Object.fromEntries(statements.map((statement) => [statement.id, 10000])),
    creditByAccount: { 1: 0 }
  });
}
