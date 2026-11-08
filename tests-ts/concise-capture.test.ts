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

  async createPending(_telegramUserId: number, capture: Omit<PendingConciseCapture, "token" | "version">) {
    const token = `capture-${this.nextToken++}`;
    this.pending.set(token, { ...capture, token, version: 0 });
    return token;
  }

  async getPending(_telegramUserId: number, token: string) {
    const capture = this.pending.get(token);
    return capture ? { ...capture } : null;
  }

  async updatePending(_telegramUserId: number, token: string, version: number, selection: { accountId: number | null; categoryId: number; subcategoryId: number | null }) {
    const capture = this.pending.get(token);
    if (!capture || capture.version !== version) return false;
    this.pending.set(token, { ...capture, ...selection, version: version + 1 });
    return true;
  }

  async saveResolved() {
    this.saved += 1;
    return this.nextTransactionId++;
  }

  async consumePending(_telegramUserId: number, token: string, selection: { accountId: number; categoryId: number; subcategoryId: number | null; version: number }) {
    const capture = this.pending.get(token);
    if (!capture) return { status: "already-used" as const };
    if (capture.version !== selection.version) return { status: "unavailable" as const };
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

  makeCategoryUnavailable(id: number, removed: boolean) {
    this.categories = removed
      ? this.categories.filter((item) => item.id !== id)
      : this.categories.map((item) => item.id === id ? { ...item, active: false } : item);
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
      result = await selectConciseCapture(store, userId, result.token, { kind: "account", id: 8, version: result.version });
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
    let result = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: null, version: categorySelected.version });
    if (accounts.length > 1) {
      assert.equal(result.status, "choose-account");
      if (result.status !== "choose-account") continue;
      result = await selectConciseCapture(store, userId, result.token, { kind: "account", id: 8, version: result.version });
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
    const result = await selectConciseCapture(accountStore, userId, started.token, { kind: "account", id: 8, version: started.version });
    assert.equal(result.status, "saved");
    if (result.status === "saved") assert.equal(result.subcategoryId, description === "Food" ? null : 10);
  }
  const childStore = new InMemoryConciseCaptureStore([category(1, "Food", ["Daily", "daily"])], [account(7)]);
  const started = await startConciseCapture(childStore, userId, {
    kind: "expense", description: "daily", accountHint: null, amountCents: -420
  });
  assert.equal(started.status, "choose-subcategory");
  if (started.status !== "choose-subcategory") return;
  const result = await selectConciseCapture(childStore, userId, started.token, { kind: "subcategory", id: null, version: started.version });
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
  const selected = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10, version: categorySelected.version });
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

  const subcategorySelected = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10, version: categorySelected.version });
  assert.equal(subcategorySelected.status, "choose-account");
  if (subcategorySelected.status !== "choose-account") return;

  const accountSelected = await selectConciseCapture(store, userId, subcategorySelected.token, { kind: "account", id: 8, version: subcategorySelected.version });
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

  const subcategorySelected = await selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10, version: categorySelected.version });
  assert.equal(subcategorySelected.status, "choose-account");
  if (subcategorySelected.status !== "choose-account") return;

  store.deactivateAccount(8);
  const unavailable = await selectConciseCapture(store, userId, subcategorySelected.token, { kind: "account", id: 8, version: subcategorySelected.version });
  assert.deepEqual(unavailable, { status: "selection-unavailable", selection: "account" });
});

test("unavailable selected categories cannot be inferred as another category", async () => {
  for (const removed of [false, true]) {
    for (const stage of ["account", "child", "skip"] as const) {
      const store = new InMemoryConciseCaptureStore([category(1, "Food"), category(2, "Transport")], [account(7), account(8, "Cash")]);
      const started = await startConciseCapture(store, userId, {
        kind: "expense", description: stage === "account" ? "daily" : "lunch", accountHint: null, amountCents: -420
      });
      assert.equal(started.status, "choose-category");
      if (started.status !== "choose-category") continue;
      const prompt = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
      if (stage === "account") assert.equal(prompt.status, "choose-account");
      else assert.equal(prompt.status, "choose-subcategory");
      if (prompt.status !== "choose-account" && prompt.status !== "choose-subcategory") continue;
      const before = await store.getPending(userId, started.token);
      store.makeCategoryUnavailable(1, removed);
      const selection = stage === "account"
        ? { kind: "account" as const, id: 8, version: prompt.version }
        : { kind: "subcategory" as const, id: stage === "skip" ? null : 10, version: prompt.version };
      const result = await selectConciseCapture(store, userId, started.token, selection);
      assert.deepEqual(result, { status: "selection-unavailable", selection: "category" });
      assert.deepEqual(await store.getPending(userId, started.token), before);
      assert.equal(store.saved, 0);
      const replacement = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 2 });
      assert.equal(replacement.status, stage === "account" ? "choose-account" : "choose-subcategory");
      if (replacement.status === "choose-account") {
        const saved = await selectConciseCapture(store, userId, started.token, { kind: "account", id: 8, version: replacement.version });
        assert.equal(saved.status, "saved");
        if (saved.status === "saved") assert.equal(saved.categoryId, 2);
      }
    }
  }
});

test("old child and account prompts cannot act on a changed category", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food"), category(2, "Transport")], [account(7), account(8, "Cash")]);
  const started = await startConciseCapture(store, userId, { kind: "expense", description: "lunch", accountHint: null, amountCents: -420 });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;
  const food = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  assert.equal(food.status, "choose-subcategory");
  if (food.status !== "choose-subcategory") return;
  const foodAccount = await selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: null, version: food.version });
  assert.equal(foodAccount.status, "choose-account");
  if (foodAccount.status !== "choose-account") return;
  const transport = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 2 });
  assert.equal(transport.status, "choose-subcategory");
  if (transport.status !== "choose-subcategory") return;
  assert.deepEqual(await selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: null, version: food.version }), { status: "selection-unavailable", selection: "subcategory" });
  assert.deepEqual(await selectConciseCapture(store, userId, started.token, { kind: "account", id: 8, version: foodAccount.version }), { status: "selection-unavailable", selection: "account" });
  const transportAccount = await selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: null, version: transport.version });
  assert.equal(transportAccount.status, "choose-account");
  if (transportAccount.status !== "choose-account") return;
  const saved = await selectConciseCapture(store, userId, started.token, { kind: "account", id: 8, version: transportAccount.version });
  assert.equal(saved.status, "saved");
  if (saved.status === "saved") assert.equal(saved.categoryId, 2);
});

test("an old account prompt stays stale after reselecting the same category", async () => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food")], [account(7), account(8, "Cash")]);
  const started = await startConciseCapture(store, userId, { kind: "expense", description: "lunch", accountHint: null, amountCents: -420 });
  assert.equal(started.status, "choose-category");
  if (started.status !== "choose-category") return;
  const first = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  if (first.status !== "choose-subcategory") assert.fail("expected child prompt");
  const oldAccount = await selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: null, version: first.version });
  if (oldAccount.status !== "choose-account") assert.fail("expected account prompt");
  const second = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  assert.equal(second.status, "choose-subcategory");
  assert.deepEqual(await selectConciseCapture(store, userId, started.token, { kind: "account", id: 8, version: oldAccount.version }), { status: "selection-unavailable", selection: "account" });
  assert.equal(store.saved, 0);
});

test("a delayed category callback cannot consume a final account choice", async (t) => {
  const store = new InMemoryConciseCaptureStore([category(1, "Food"), category(2, "Transport", [])], [account(7), account(8, "Cash")]);
  const started = await startConciseCapture(store, userId, { kind: "expense", description: "lunch", accountHint: null, amountCents: -420 });
  if (started.status !== "choose-category") assert.fail("expected category prompt");
  const food = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
  if (food.status !== "choose-subcategory") assert.fail("expected child prompt");
  const accountPrompt = await selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: null, version: food.version });
  if (accountPrompt.status !== "choose-account") assert.fail("expected account prompt");
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  const pause = async (accountId: number | null) => {
    if (!held && accountId === 8) { held = true; entered(); await gate; }
  };
  const update = store.updatePending.bind(store);
  t.mock.method(store, "updatePending", async (...[user, token, version, selection]: Parameters<typeof update>) => {
    const result = await update(user, token, version, selection);
    await pause(selection.accountId);
    return result;
  });
  const consume = store.consumePending.bind(store);
  t.mock.method(store, "consumePending", async (...[user, token, selection]: Parameters<typeof consume>) => {
    const result = await consume(user, token, selection);
    await pause(selection.accountId);
    return result;
  });
  const finalChoice = selectConciseCapture(store, userId, started.token, { kind: "account", id: 8, version: accountPrompt.version });
  await paused;
  const stale = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 2 });
  release();
  const result = await finalChoice;
  assert.deepEqual(stale, { status: "expired" });
  assert.equal(result.status, "saved");
  if (result.status === "saved") assert.equal(result.categoryId, 1);
  assert.equal(store.saved, 1);
});

test("a callback cannot overwrite a newer choice", async (t) => {
  for (const accounts of [[account(7)], [account(7), account(8, "Cash")]]) {
    const store = new InMemoryConciseCaptureStore([category(1, "Food", ["First", "Second"])], accounts);
    const started = await startConciseCapture(store, userId, { kind: "expense", description: "lunch", accountHint: null, amountCents: -420 });
    assert.equal(started.status, "choose-category");
    if (started.status !== "choose-category") continue;
    const prompt = await selectConciseCapture(store, userId, started.token, { kind: "category", id: 1 });
    assert.equal(prompt.status, "choose-subcategory");
    if (prompt.status !== "choose-subcategory") continue;
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const update = store.updatePending.bind(store);
    const consume = store.consumePending.bind(store);
    const updateMock = t.mock.method(store, "updatePending", async (...[user, token, version, selection]: Parameters<typeof update>) => {
      if (selection.subcategoryId === 10) { entered(); await gate; }
      return update(user, token, version, selection);
    });
    const consumeMock = t.mock.method(store, "consumePending", async (...[user, token, selection]: Parameters<typeof consume>) => {
      if (selection.subcategoryId === 10) { entered(); await gate; }
      return consume(user, token, selection);
    });
    const stale = selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: 10, version: prompt.version });
    await paused;
    let newer = await selectConciseCapture(store, userId, started.token, { kind: "subcategory", id: 11, version: prompt.version });
    release();
    assert.deepEqual(await stale, accounts.length === 1
      ? { status: "already-used" }
      : { status: "selection-unavailable", selection: "subcategory" });
    if (newer.status === "choose-account") newer = await selectConciseCapture(store, userId, started.token, { kind: "account", id: 8, version: newer.version });
    assert.equal(newer.status, "saved");
    if (newer.status === "saved") assert.equal(newer.subcategoryId, 11);
    assert.equal(store.saved, 1);
    updateMock.mock.restore();
    consumeMock.mock.restore();
  }
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
    selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10, version: categorySelected.version }),
    selectConciseCapture(store, userId, categorySelected.token, { kind: "subcategory", id: 10, version: categorySelected.version })
  ]);

  assert.deepEqual([first.status, second.status].sort(), ["already-used", "saved"]);
  assert.equal(store.saved, 1);
});
