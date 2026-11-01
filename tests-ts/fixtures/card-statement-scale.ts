import assert from "node:assert/strict";
import { reconcileStatementPayments } from "../../lib/card-statements";

// Each baseline omits a different group. Their intersections create an
// exponential number of combinations in the former recursive implementation.
// The 120-statement case has hundreds of groups repeatedly changing between
// captures, forcing both allocation and restoration. No payment survives, so
// all full snapshots end full and no credit survives.
for (const [size, groups] of [[20, 20], [24, 24], [120, 600]]) {
  const statements = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    accountId: 1,
    closingDate: `${2015 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-28`,
    originalAmountCents: 10000,
    remainingAmountCents: 10000,
    baseline: Array.from({ length: groups }, (_, j) => ({
      groupId: `g${String(j).padStart(3, "0")}`, amountCents: 100
    })).filter((_, j) => (i + j) % 4 !== 0)
  }));
  assert.deepEqual(reconcileStatementPayments(statements, []), {
    remainingById: Object.fromEntries(statements.map((statement) => [statement.id, 10000])),
    creditByAccount: { 1: 0 }
  });
}
