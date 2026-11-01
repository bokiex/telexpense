import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementSnapshot } from "../lib/card-statements";

const snapshot = { accountId: 1, closingDate: "2024-02-29", dueDate: "2024-03-20", originalAmountCents: 12000, remainingAmountCents: 5000 };

test("accepts an issued statement including prior payments", () => {
  assert.deepEqual(parseStatementSnapshot(snapshot), snapshot);
  assert.ok(parseStatementSnapshot({ ...snapshot, remainingAmountCents: 0 }));
});

test("rejects invalid dates, identities, and amounts", () => {
  for (const patch of [
    { closingDate: "2023-02-29" }, { dueDate: "2024-13-01" }, { accountId: 0 },
    { originalAmountCents: -1 }, { remainingAmountCents: -1 }, { remainingAmountCents: 12001 },
    { originalAmountCents: 1.5 }, { originalAmountCents: "12000" }, { originalAmountCents: 2147483648 }
  ]) assert.equal(parseStatementSnapshot({ ...snapshot, ...patch }), null);
});
