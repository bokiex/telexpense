import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateSnapshotPayments, allocateStatementPayments, parseStatementSnapshot } from "../lib/card-statements";

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

test("snapshot allocation excludes pre-tracking payments and recomputes edits and deletions", () => {
  const snapshots = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", remainingAmountCents: 5000, createdAt: "2024-03-01T00:00:00Z" },
    { id: 2, accountId: 1, closingDate: "2024-02-29", remainingAmountCents: 4000, createdAt: "2024-03-01T00:00:00Z" },
    { id: 3, accountId: 2, closingDate: "2024-01-31", remainingAmountCents: 3000, createdAt: "2024-03-01T00:00:00Z" }
  ];
  const prior = { id: 1, accountId: 1, amountCents: 9000, createdAt: "2024-02-01T00:00:00Z" };
  const payment = { id: 2, accountId: 1, amountCents: 6000, createdAt: "2024-03-02T00:00:00Z" };
  assert.deepEqual(allocateSnapshotPayments(snapshots, [prior, payment]), { 1: 0, 2: 3000, 3: 3000 });
  assert.deepEqual(allocateSnapshotPayments(snapshots, [prior, { ...payment, amountCents: 2000 }]), { 1: 3000, 2: 4000, 3: 3000 });
  assert.deepEqual(allocateSnapshotPayments(snapshots, [prior]), { 1: 5000, 2: 4000, 3: 3000 });
});

test("rejects invalid dates, identities, and amounts", () => {
  for (const patch of [
    { closingDate: "2023-02-29" }, { dueDate: "2024-13-01" }, { accountId: 0 },
    { originalAmountCents: -1 }, { remainingAmountCents: -1 }, { remainingAmountCents: 12001 },
    { originalAmountCents: 1.5 }, { originalAmountCents: "12000" }, { originalAmountCents: 2147483648 }
  ]) assert.equal(parseStatementSnapshot({ ...snapshot, ...patch }), null);
});
