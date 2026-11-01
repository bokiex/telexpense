import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateStatementPayments, parseStatementSnapshot, reconcileStatementPayments } from "../lib/card-statements";

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

test("baseline payment edits and deletions change the snapshot without replaying prior payments", () => {
  const statements = [{ id: 1, accountId: 1, closingDate: "2024-01-31", remainingAmountCents: 5000,
    baseline: [{ groupId: "old", amountCents: 3000 }] }];
  const payment = (amountCents: number) => [{ accountId: 1, groupId: "old", amountCents }];
  assert.deepEqual(reconcileStatementPayments(statements, payment(3000)), { remainingById: { 1: 5000 }, creditByAccount: { 1: 0 } });
  assert.equal(reconcileStatementPayments(statements, payment(4000)).remainingById[1], 4000);
  assert.equal(reconcileStatementPayments(statements, payment(1000)).remainingById[1], 7000);
  assert.equal(reconcileStatementPayments(statements, []).remainingById[1], 8000);
  assert.deepEqual(reconcileStatementPayments(statements, [...payment(3000), { accountId: 1, groupId: "new", amountCents: 7000 }]),
    { remainingById: { 1: 0 }, creditByAccount: { 1: 2000 } });
});

test("allocates across independently captured statement baselines and carries excess", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", remainingAmountCents: 5000, baseline: [] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", remainingAmountCents: 4000, baseline: [{ groupId: "p", amountCents: 3000 }] }
  ];
  const status = (amountCents: number) => reconcileStatementPayments(statements, [{ accountId: 1, groupId: "p", amountCents }]);
  assert.deepEqual(status(3000), { remainingById: { 1: 2000, 2: 4000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(7000), { remainingById: { 1: 0, 2: 2000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(11000), { remainingById: { 1: 0, 2: 0 }, creditByAccount: { 1: 2000 } });
  assert.deepEqual(status(1000), { remainingById: { 1: 4000, 2: 4000 }, creditByAccount: { 1: 0 } });
});

test("moving or deleting a baseline payment restores only its original card", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", remainingAmountCents: 5000, baseline: [{ groupId: "p", amountCents: 2000 }] },
    { id: 2, accountId: 2, closingDate: "2024-01-31", remainingAmountCents: 4000, baseline: [] }
  ];
  assert.deepEqual(reconcileStatementPayments(statements, [{ groupId: "p", accountId: 2, amountCents: 2000 }]),
    { remainingById: { 1: 7000, 2: 2000 }, creditByAccount: { 1: 0, 2: 0 } });
});

test("exposes payments made before any tracked statement as available credit", () => {
  assert.deepEqual(reconcileStatementPayments([], [{ groupId: "p", accountId: 2, amountCents: 4500 }]),
    { remainingById: {}, creditByAccount: { 2: 4500 } });
});

test("rejects invalid dates, identities, and amounts", () => {
  for (const patch of [
    { closingDate: "2023-02-29" }, { dueDate: "2024-13-01" }, { accountId: 0 },
    { originalAmountCents: -1 }, { remainingAmountCents: -1 }, { remainingAmountCents: 12001 },
    { originalAmountCents: 1.5 }, { originalAmountCents: "12000" }, { originalAmountCents: 2147483648 }
  ]) assert.equal(parseStatementSnapshot({ ...snapshot, ...patch }), null);
});
