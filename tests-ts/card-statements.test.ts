import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  const statements = [{ id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 20000, remainingAmountCents: 5000,
    baseline: [{ groupId: "old", amountCents: 3000 }] }];
  const payment = (amountCents: number) => [{ accountId: 1, groupId: "old", amountCents }];
  assert.deepEqual(reconcileStatementPayments(statements, payment(3000)), { remainingById: { 1: 5000 }, creditByAccount: { 1: 0 } });
  assert.equal(reconcileStatementPayments(statements, payment(4000)).remainingById[1], 4000);
  assert.equal(reconcileStatementPayments(statements, payment(1000)).remainingById[1], 7000);
  assert.equal(reconcileStatementPayments(statements, []).remainingById[1], 8000);
  assert.deepEqual(reconcileStatementPayments(statements, [...payment(3000), { accountId: 1, groupId: "new", amountCents: 7000 }]),
    { remainingById: { 1: 0 }, creditByAccount: { 1: 2000 } });
});

test("replacement payments are applied after restoring each captured payment", () => {
  const statement = { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 10000,
    baseline: [{ groupId: "old", amountCents: 10000 }] };
  assert.deepEqual(reconcileStatementPayments([statement], [{ accountId: 1, groupId: "new", amountCents: 10000 }]),
    { remainingById: { 1: 0 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(reconcileStatementPayments([{ ...statement, remainingAmountCents: 5000 }], [{ accountId: 1, groupId: "new", amountCents: 10000 }]),
    { remainingById: { 1: 0 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(reconcileStatementPayments([{ ...statement, remainingAmountCents: 5000 }], [{ accountId: 1, groupId: "old", amountCents: 3000 }, { accountId: 1, groupId: "new", amountCents: 10000 }]),
    { remainingById: { 1: 0 }, creditByAccount: { 1: 0 } });
});

test("a first snapshot does not infer historic credit from pre-existing payments", () => {
  const payment = { accountId: 1, groupId: "historic", amountCents: 20000 };
  const statement = { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [payment] };
  assert.deepEqual(reconcileStatementPayments([statement], [payment]),
    { remainingById: { 1: 10000 }, creditByAccount: { 1: 0 } });
});

test("replacement payments flow oldest first across captured statements", () => {
  const old = { groupId: "old", amountCents: 10000 };
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [old] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [old] }
  ];
  assert.deepEqual(reconcileStatementPayments(statements, [{ accountId: 1, groupId: "new", amountCents: 15000 }]),
    { remainingById: { 1: 0, 2: 5000 }, creditByAccount: { 1: 0 } });
});

test("allocates across independently captured statement baselines and carries excess", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 20000, remainingAmountCents: 5000, baseline: [] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 20000, remainingAmountCents: 4000, baseline: [{ groupId: "p", amountCents: 3000 }] }
  ];
  const status = (amountCents: number) => reconcileStatementPayments(statements, [{ accountId: 1, groupId: "p", amountCents }]);
  assert.deepEqual(status(3000), { remainingById: { 1: 2000, 2: 4000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(7000), { remainingById: { 1: 0, 2: 2000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(11000), { remainingById: { 1: 0, 2: 0 }, creditByAccount: { 1: 2000 } });
  assert.deepEqual(status(1000), { remainingById: { 1: 4000, 2: 4000 }, creditByAccount: { 1: 0 } });
});

test("reconciles divergent baselines with a replacement and later edits", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 5000, baseline: [{ groupId: "a", amountCents: 4000 }] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 10000, remainingAmountCents: 4000, baseline: [{ groupId: "b", amountCents: 3000 }] }
  ];
  assert.deepEqual(reconcileStatementPayments(statements, [
    { accountId: 1, groupId: "a", amountCents: 2000 },
    { accountId: 1, groupId: "b", amountCents: 6000 }
  ]), { remainingById: { 1: 1000, 2: 4000 }, creditByAccount: { 1: 0 } });
});

test("moving or deleting a baseline payment restores only its original card", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 20000, remainingAmountCents: 5000, baseline: [{ groupId: "p", amountCents: 2000 }] },
    { id: 2, accountId: 2, closingDate: "2024-01-31", originalAmountCents: 20000, remainingAmountCents: 4000, baseline: [] }
  ];
  assert.deepEqual(reconcileStatementPayments(statements, [{ groupId: "p", accountId: 2, amountCents: 2000 }]),
    { remainingById: { 1: 7000, 2: 2000 }, creditByAccount: { 1: 0, 2: 0 } });
});

test("does not infer available credit before a tracked statement", () => {
  assert.deepEqual(reconcileStatementPayments([], [{ groupId: "p", accountId: 2, amountCents: 4500 }]),
    { remainingById: {}, creditByAccount: { 2: 0 } });
});

test("a paid imported snapshot consumes prior credit and restores debt if that payment is reduced", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 10000, remainingAmountCents: 0, baseline: [{ groupId: "p", amountCents: 20000 }] }
  ];
  const status = (amountCents: number) => reconcileStatementPayments(statements, [{ accountId: 1, groupId: "p", amountCents }]);
  assert.deepEqual(status(20000), { remainingById: { 1: 0, 2: 0 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(10000), { remainingById: { 1: 0, 2: 10000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(15000), { remainingById: { 1: 0, 2: 5000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(status(25000), { remainingById: { 1: 0, 2: 0 }, creditByAccount: { 1: 5000 } });
  assert.deepEqual(reconcileStatementPayments(statements, []), { remainingById: { 1: 10000, 2: 10000 }, creditByAccount: { 1: 0 } });
});

test("ambiguous first-snapshot payments are attributed deterministically by group identity", () => {
  const a = { groupId: "a", amountCents: 1000 };
  const b = { groupId: "b", amountCents: 1000 };
  const statement = { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 1000, remainingAmountCents: 0, baseline: [b, a] };
  assert.deepEqual(reconcileStatementPayments([statement], [{ ...b, accountId: 1 }]),
    { remainingById: { 1: 1000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(reconcileStatementPayments([statement], [{ ...a, accountId: 1 }]),
    { remainingById: { 1: 0 }, creditByAccount: { 1: 0 } });
});

test("a removed older payment moves a newer allocation to the restored oldest debt", () => {
  const a = { groupId: "a", amountCents: 1000 };
  const b = { groupId: "b", amountCents: 1000 };
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 1000, remainingAmountCents: 0, baseline: [a] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 1000, remainingAmountCents: 1000, baseline: [a] },
    { id: 3, accountId: 1, closingDate: "2024-03-31", originalAmountCents: 1000, remainingAmountCents: 1000, baseline: [a, b] }
  ];
  assert.deepEqual(reconcileStatementPayments(statements, [{ ...b, accountId: 1 }]),
    { remainingById: { 1: 0, 2: 1000, 3: 1000 }, creditByAccount: { 1: 0 } });
});

test("divergent 20-by-20 and 24-by-24 baselines finish and restore all deleted payments", () => {
  // A subprocess makes the timeout effective even for a synchronous exponential implementation.
  const result = spawnSync(process.execPath, ["--import", "tsx", "tests-ts/fixtures/card-statement-scale.ts"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects invalid dates, identities, and amounts", () => {
  for (const patch of [
    { closingDate: "2023-02-29" }, { dueDate: "2024-13-01" }, { accountId: 0 },
    { originalAmountCents: -1 }, { remainingAmountCents: -1 }, { remainingAmountCents: 12001 },
    { originalAmountCents: 1.5 }, { originalAmountCents: "12000" }, { originalAmountCents: 2147483648 }
  ]) assert.equal(parseStatementSnapshot({ ...snapshot, ...patch }), null);
});

test("imported remaining is authoritative and unused credit can fund a future generated statement", () => {
  const payment = { groupId: "p", accountId: 1, amountCents: 20000 };
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [payment] }
  ];
  const status = reconcileStatementPayments(statements, [payment]);
  assert.equal(status.remainingById[2], 10000);
  assert.equal(status.creditByAccount[1], 10000);
  assert.deepEqual(allocateStatementPayments([{ id: 3, closingDate: "2024-03-31", remainingAmountCents: 12000 }], status.creditByAccount[1]),
    { remainingById: { 3: 2000 }, creditCents: 0 });
});

test("deleting an overpayment cannot inflate a later full snapshot and retained credit survives capture", () => {
  const statements = [
    { id: 1, accountId: 1, closingDate: "2024-01-31", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [] },
    { id: 2, accountId: 1, closingDate: "2024-02-29", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [{ groupId: "p", amountCents: 20000 }] }
  ];
  assert.deepEqual(reconcileStatementPayments(statements, []), { remainingById: { 1: 10000, 2: 10000 }, creditByAccount: { 1: 0 } });
  assert.deepEqual(reconcileStatementPayments(statements, [{ groupId: "p", accountId: 1, amountCents: 20000 }]),
    { remainingById: { 1: 0, 2: 10000 }, creditByAccount: { 1: 10000 } });
  assert.deepEqual(reconcileStatementPayments(statements, [{ groupId: "p", accountId: 1, amountCents: 25000 }]),
    { remainingById: { 1: 0, 2: 5000 }, creditByAccount: { 1: 10000 } });
  const third = { id: 3, accountId: 1, closingDate: "2024-03-31", originalAmountCents: 10000, remainingAmountCents: 10000, baseline: [{ groupId: "p", amountCents: 20000 }] };
  assert.deepEqual(reconcileStatementPayments([...statements, third], [{ groupId: "p", accountId: 1, amountCents: 20000 }]),
    { remainingById: { 1: 0, 2: 10000, 3: 10000 }, creditByAccount: { 1: 10000 } });
  const partiallyPaid = [statements[0], { ...statements[1], remainingAmountCents: 5000 }];
  assert.deepEqual(reconcileStatementPayments(partiallyPaid, [{ groupId: "p", accountId: 1, amountCents: 10000 }]),
    { remainingById: { 1: 0, 2: 10000 }, creditByAccount: { 1: 0 } });
});
