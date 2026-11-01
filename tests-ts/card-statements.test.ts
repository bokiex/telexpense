import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateStatementPayments, parseStatementSnapshot } from "../lib/card-statements";

const snapshot = { accountId: 1, closingDate: "2024-02-29", dueDate: "2024-03-20", originalAmountCents: 12000, remainingAmountCents: 5000 };

test("accepts an issued statement including prior payments", () => {
  assert.deepEqual(parseStatementSnapshot(snapshot), snapshot);
  assert.ok(parseStatementSnapshot({ ...snapshot, remainingAmountCents: 0 }));
});

test("allocates payments oldest first without overwriting snapshot prior payments", () => {
  const result = allocateStatementPayments([
    { id: 2, closingDate: "2024-02-29", remainingAmountCents: 4000 },
    { id: 1, closingDate: "2024-01-31", remainingAmountCents: 5000 }
  ], 6000);
  assert.deepEqual(result, { remainingById: { 1: 0, 2: 3000 }, creditCents: 0 });
});

test("carries excess payment forward without changing snapshot amounts", () => {
  const statements = [{ id: 1, closingDate: "2024-01-31", remainingAmountCents: 5000 }];
  assert.deepEqual(allocateStatementPayments(statements, 7000), { remainingById: { 1: 0 }, creditCents: 2000 });
  assert.equal(statements[0].remainingAmountCents, 5000);
});

test("rejects invalid dates, identities, and amounts", () => {
  for (const patch of [
    { closingDate: "2023-02-29" }, { dueDate: "2024-13-01" }, { accountId: 0 },
    { originalAmountCents: -1 }, { remainingAmountCents: -1 }, { remainingAmountCents: 12001 },
    { originalAmountCents: 1.5 }, { originalAmountCents: "12000" }, { originalAmountCents: 2147483648 }
  ]) assert.equal(parseStatementSnapshot({ ...snapshot, ...patch }), null);
});
