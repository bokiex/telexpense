import assert from "node:assert/strict";
import test from "node:test";
import {
  selectConciseCapture,
  startConciseCapture,
  type CaptureAccount,
  type CaptureCategory,
  type ConciseCaptureStore,
  type PendingConciseCapture
} from "../lib/conciseCapture";

const userId = 42;

function category(id: number, name: string, subcategories: string[] = ["Daily"]): CaptureCategory {
  return {
    id,
    sourceKey: name.toLowerCase(),
    sourceName: name.toLowerCase(),
    name,
    active: true,
    subcategories: subcategories.map((subcategory, index) => ({ id: id * 10 + index, name: subcategory }))
  };
}

function account(id: number, name = "Card"): CaptureAccount {
  return { id, accountKey: name.toLowerCase(), name, active: true };
}

class InMemoryConciseCaptureStore implements ConciseCaptureStore {
  private readonly pending = new Map<string, PendingConciseCapture>();
  private nextToken = 1;
  private nextTransactionId = 100;
  lastUsedAccountId: number | null = null;
  saved = 0;

  constructor(
    private categories: CaptureCategory[],
    private accounts: CaptureAccount[]
  ) {}

  async getCatalog() {
    return { categories: this.categories, accounts: this.accounts };
  }

  async getLastUsedAccountId() {
    return this.lastUsedAccountId;
  }

  async createPending(_telegramUserId: number, capture: Omit<PendingConciseCapture, "token" | "categoryId" | "subcategoryId">) {
    const token = `capture-${this.nextToken++}`;
    this.pending.set(token, { ...capture, token, categoryId: null, subcategoryId: null });
    return token;
  }

  async getPending(_telegramUserId: number, token: string) {
    const capture = this.pending.get(token);
    return capture ? { ...capture } : null;
  }

  async updatePending(_telegramUserId: number, token: string, selection: { accountId?: number; categoryId?: number; subcategoryId?: number | null }) {
    const capture = this.pending.get(token);
    if (!capture) return;
    if (selection.accountId !== undefined) capture.accountId = selection.accountId;
    if (selection.categoryId !== undefined) capture.categoryId = selection.categoryId;
    if (selection.subcategoryId !== undefined) capture.subcategoryId = selection.subcategoryId;
  }

  async saveResolved() {
    this.saved += 1;
    return this.nextTransactionId++;
  }

  async consumePending(_telegramUserId: number, token: string, selection: { accountId: number; categoryId: number; subcategoryId: number | null }) {
    const capture = this.pending.get(token);
    if (!capture) return { status: "already-used" as const };
    if (
      capture.accountId !== selection.accountId
      || capture.categoryId !== selection.categoryId
      || capture.subcategoryId !== selection.subcategoryId
    ) return { status: "unavailable" as const };
    this.pending.delete(token);
    this.saved += 1;
    return { status: "saved" as const, transactionId: this.nextTransactionId++ };
  }

  removePending(token: string) {
    this.pending.delete(token);
  }

  deactivateAccount(id: number) {
    this.accounts = this.accounts.map((item) => item.id === id ? { ...item, active: false } : item);
  }
}

test("concise capture saves immediately with an exact subcategory and sole account", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food", ["Eat out"])], [account(7)]);

  const outcome = await startConciseCapture(store, userId, {
    kind: "expense", description: "Eat out", accountHint: null, amountCents: -420
  });

  assert.deepEqual(outcome, {
    status: "saved", transactionId: 100, categoryId: 1, subcategoryId: 10, accountId: 7, amountCents: -420
  });
  assert.equal(store.saved, 1);
});

test("category selection saves without a child when none exist", async () => {
  for (const accounts of [[account(7)], [account(7), account(8, "Cash")]]) {
    const store = new InMemoryConciseCaptureStore([category(1, "Food", [])], accounts);
    const started = await startConciseCapture(store, userId, {
      kind: "expense", description: "lunch", accountHint: null, amountCents: -420
    });
    assert.equal(started.status, "choose-category");
    if (started.status !== "choose-category") continue;
    let result = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
    if (accounts.length > 1) {
      assert.equal(result.status, "choose-account");
      if (result.status !== "choose-account") continue;
      result = await selectConciseCapture(store, userId, result.token, { kind: "account", id: 8 });
    }
    assert.equal(result.status, "saved");
    if (result.status === "saved") assert.equal(result.subcategoryId, null);
    assert.equal(store.saved, 1);
  }
});

test("skipping a child persists through account selection", async () => {
  for (const accounts of [[account(7)], [account(7), account(8, "Cash")]]) {
    const store = new InMemoryConciseCaptureStore([category(1, "Food")], accounts);
    const started = await startConciseCapture(store, userId, {
      kind: "expense", description: "lunch", accountHint: null, amountCents: -420
    });
    assert.equal(started.status, "choose-category");
    if (started.status !== "choose-category") continue;
    const categorySelected = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
    assert.equal(categorySelected.status, "choose-subcategory");
    if (categorySelected.status !== "choose-subcategory") continue;
    let result = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: null });
    if (accounts.length > 1) {
      assert.equal(result.status, "choose-account");
      if (result.status !== "choose-account") continue;
      result = await selectConciseCapture(store, userId, result.token, { kind: "account", id: 8 });
    }
    assert.equal(result.status, "saved");
    if (result.status === "saved") assert.equal(result.subcategoryId, null);
    assert.equal(store.saved, 1);
  }
});

test("inferred categories survive pending account and child choices", async () => {
  const accountStore = new InMemoryConciseCaptureStore([category(1, "Food")], [account(7), account(8, "Cash")]);
  for (const description of ["Food", "Daily"]) {
    const started = await startConciseCapture(accountStore, userId, {
      kind: "expense", description, accountHint: null, amountCents: -420
    });
    assert.equal(started.status, "choose-account");
    if (started.status !== "choose-account") continue;
    const result = await selectConciseCapture(accountStore, userId, started.token, { kind: "account", id: 8 });
    assert.equal(result.status, "saved");
    if (result.status === "saved") assert.equal(result.subcategoryId, description === "Food" ? null : 10);
  }
  const childStore = new InMemoryConciseCaptureStore([category(1, "Food", ["Daily", "daily"])], [account(7)]);
  const started = await startConciseCapture(childStore, userId, {
    kind: "expense", description: "daily", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-subcategory");
  if (started.status !== "choose-subcategory") return;
  const result = await selectConciseCapture(childStore, userId, started.token, { kind: "subcategory", id: null });
  assert.equal(result.status, "saved");
  if (result.status === "saved") assert.equal(result.subcategoryId, null);
});

test("concise capture prefers an explicit account hint over the last-used account", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food", ["Eat out"])], [account(7, "Card"), account(8, "Cash")]);
  store.lastUsedAccountId = 7;

  const outcome = await startConciseCapture(store, userId, {
    kind: "expense", description: "Eat out", accountHint: "Cash", amountCents: -420
  });

  assert.equal(outcome.status, "saved");
  if (outcome.status === "saved") assert.equal(outcome.accountId, 8);
});

test("concise capture preserves a last-used account while category selection is pending", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food"), category(2, "Transport")], [account(7)]);
  store.lastUsedAccountId = 7;

  const started = await startConciseCapture(store, userId, {
    kind: "expense", description: "mystery", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;

  const categorySelected = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  assert.equal(categorySelected.status, "choose-subcategory");
  if (categorySelected.status !== "choose-subcategory") return;
  const selected = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10 });
  assert.equal(selected.status, "saved");
  if (selected.status === "saved") assert.equal(selected.accountId, 7);
});

test("concise capture prompts for an account after a selected category", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food")], [account(7), account(8, "Cash")]);

  const started = await startConciseCapture(store, userId, {
    kind: "expense", description: "mystery", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;

  const categorySelected = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  assert.equal(categorySelected.status, "choose-subcategory");
  if (categorySelected.status !== "choose-subcategory") return;

  const subcategorySelected = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10 });
  assert.equal(subcategorySelected.status, "choose-account");
  if (subcategorySelected.status !== "choose-account") return;

  const accountSelected = await selectConciseCapture(store, userId, subcategorySelected.token, { kind: "account", id: 8 });
  assert.equal(accountSelected.status, "saved");
  if (accountSelected.status === "saved") assert.equal(accountSelected.accountId, 8);
});

test("concise capture rejects expired and unavailable choices", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food")], [account(7)]);

  const expired = await selectConciseCapture(store, userId, "missing", { kind: "category", id: 1 });
  assert.deepEqual(expired, { status: "expired" });

  const started = await startConciseCapture(store, userId, {
    kind: "expense", description: "mystery", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;
  const unavailable = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 99 });
  assert.deepEqual(unavailable, { status: "selection-unavailable", selection: "category" });
});

test("concise capture rechecks active accounts before consuming a selection", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food")], [account(7), account(8, "Cash")]);
  const started = await startConciseCapture(store, userId, {
    kind: "expense", description: "mystery", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;

  const categorySelected = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  assert.equal(categorySelected.status, "choose-subcategory");
  if (categorySelected.status !== "choose-subcategory") return;

  const subcategorySelected = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10 });
  assert.equal(subcategorySelected.status, "choose-account");
  if (subcategorySelected.status !== "choose-account") return;

  store.deactivateAccount(8);
  const unavailable = await selectConciseCapture(store, userId, subcategorySelected.token, { kind: "account", id: 8 });
  assert.deepEqual(unavailable, { status: "selection-unavailable", selection: "account" });
});

test("concurrent concise-capture callbacks save only once", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food")], [account(7)]);
  const started = await startConciseCapture(store, userId, {
    kind: "expense", description: "mystery", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;

  const categorySelected = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  assert.equal(categorySelected.status, "choose-subcategory");
  if (categorySelected.status !== "choose-subcategory") return;

  const [first, second] = await Promise.all([
    selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10 }),
    selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10 })
  ]);

  assert.deepEqual([first.status, second.status].sort(), ["already-used", "saved"]);
  assert.equal(store.saved, 1);
});
