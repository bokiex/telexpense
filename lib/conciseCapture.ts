import { normalizeIdentity } from "@/lib/identity";

export type ConciseCaptureInput = {
  kind: "expense" | "income" | "investment";
  description: string;
  accountHint: string | null;
  amountCents: number;
};

export type CaptureAccount = {
  id: number | null;
  accountKey: string;
  name: string;
  active: boolean;
};

export type CaptureCategory = {
  id: number;
  sourceKey: string;
  sourceName: string;
  name: string;
  active: boolean;
  subcategories: { id: number; name: string }[];
};

export type PendingConciseCapture = Omit<ConciseCaptureInput, "accountHint"> & {
  token: string;
  accountId: number | null;
  categoryId: number | null;
  subcategoryId: number | null;
};

export type ConciseCaptureResolution =
  | { status: "ready"; category: CaptureCategory; subcategoryId: number | null; account: CaptureAccount }
  | { status: "choose-category"; categories: CaptureCategory[] }
  | { status: "choose-subcategory"; category: CaptureCategory; subcategories: CaptureCategory["subcategories"] }
  | { status: "no-subcategories"; category: CaptureCategory }
  | { status: "choose-account"; category: CaptureCategory; subcategoryId: number | null; accounts: CaptureAccount[] };

export type PendingCaptureCommit =
  | { status: "saved"; transactionId: number }
  | { status: "already-used" }
  | { status: "unavailable" };

export type ConciseCaptureStore = {
  getCatalog(telegramUserId: number): Promise<{ categories: CaptureCategory[]; accounts: CaptureAccount[] }>;
  getLastUsedAccountId(telegramUserId: number): Promise<number | null>;
  createPending(telegramUserId: number, capture: Omit<PendingConciseCapture, "token" | "categoryId" | "subcategoryId">): Promise<string>;
  getPending(telegramUserId: number, token: string): Promise<PendingConciseCapture | null>;
  updatePending(telegramUserId: number, token: string, selection: { accountId?: number; categoryId?: number; subcategoryId?: number | null }): Promise<void>;
  saveResolved(telegramUserId: number, capture: ConciseCaptureInput, resolution: Extract<ConciseCaptureResolution, { status: "ready" }>): Promise<number>;
  consumePending(telegramUserId: number, token: string, selection: { accountId: number; categoryId: number; subcategoryId: number | null }): Promise<PendingCaptureCommit>;
};

export type ConciseCaptureOutcome =
  | { status: "saved"; transactionId: number; categoryId: number; subcategoryId: number | null; accountId: number; amountCents: number }
  | { status: "choose-category"; token: string; categories: CaptureCategory[] }
  | { status: "choose-subcategory"; token: string; category: CaptureCategory; subcategories: CaptureCategory["subcategories"] }
  | { status: "choose-account"; token: string; accounts: CaptureAccount[] }
  | { status: "no-subcategories"; category: CaptureCategory }
  | { status: "account-not-found"; accountHint: string }
  | { status: "expired" }
  | { status: "selection-unavailable"; selection: "category" | "subcategory" | "account" }
  | { status: "already-used" };

export type ConciseCaptureSelection =
  | { kind: "category"; id: number }
  | { kind: "subcategory"; id: number }
  | { kind: "account"; id: number };

export async function startConciseCapture(
  store: ConciseCaptureStore,
  telegramUserId: number,
  capture: ConciseCaptureInput
): Promise<ConciseCaptureOutcome> {
  const [{ categories, accounts }, lastUsedAccountId] = await Promise.all([
    store.getCatalog(telegramUserId),
    store.getLastUsedAccountId(telegramUserId)
  ]);
  const accountId = resolveConciseAccount(capture.accountHint, accounts);
  if (capture.accountHint && accountId === undefined) {
    return { status: "account-not-found", accountHint: capture.accountHint };
  }
  const resolution = resolveConciseCapture(
    capture.description,
    categories,
    accounts,
    undefined,
    undefined,
    accountId ?? lastUsedAccountId ?? undefined
  );
  if (resolution.status === "ready") {
    const transactionId = await store.saveResolved(telegramUserId, capture, resolution);
    return savedOutcome(transactionId, resolution, capture.amountCents);
  }
  const token = await store.createPending(telegramUserId, {
    kind: capture.kind,
    description: capture.description,
    amountCents: capture.amountCents,
    accountId: accountId ?? lastUsedAccountId ?? null
  });
  return outcomeForResolution(token, resolution);
}

export async function selectConciseCapture(
  store: ConciseCaptureStore,
  telegramUserId: number,
  token: string,
  selection: ConciseCaptureSelection
): Promise<ConciseCaptureOutcome> {
  const pending = await store.getPending(telegramUserId, token);
  if (!pending) return { status: "expired" };

  const { categories, accounts } = await store.getCatalog(telegramUserId);
  if (selection.kind === "category") {
    const category = categories.find((item) => item.active && item.id === selection.id);
    if (!category) return { status: "selection-unavailable", selection: "category" };
    await store.updatePending(telegramUserId, token, { categoryId: category.id, subcategoryId: null });
    pending.categoryId = category.id;
    pending.subcategoryId = null;
  } else if (selection.kind === "subcategory") {
    const category = categories.find((item) => item.active && item.id === pending.categoryId);
    if (!category?.subcategories.some((item) => item.id === selection.id)) {
      return { status: "selection-unavailable", selection: "subcategory" };
    }
    await store.updatePending(telegramUserId, token, { subcategoryId: selection.id });
    pending.subcategoryId = selection.id;
  } else {
    const account = accounts.find((item) => item.active && item.id === selection.id);
    if (!account) return { status: "selection-unavailable", selection: "account" };
    const accountId = Number(account.id);
    await store.updatePending(telegramUserId, token, { accountId });
    pending.accountId = accountId;
  }

  const resolution = resolveConciseCapture(
    pending.description,
    categories,
    accounts,
    pending.categoryId ?? undefined,
    pending.subcategoryId ?? undefined,
    pending.accountId ?? undefined
  );
  if (resolution.status !== "ready") return outcomeForResolution(token, resolution);

  await store.updatePending(telegramUserId, token, { accountId: Number(resolution.account.id) });
  const committed = await store.consumePending(telegramUserId, token, {
    accountId: Number(resolution.account.id),
    categoryId: resolution.category.id,
    subcategoryId: resolution.subcategoryId
  });
  if (committed.status === "saved") return savedOutcome(committed.transactionId, resolution, pending.amountCents);
  if (committed.status === "already-used") return { status: "already-used" };
  return { status: "selection-unavailable", selection: "account" };
}

export function resolveConciseCapture(
  description: string,
  categories: CaptureCategory[],
  accounts: CaptureAccount[],
  selectedCategoryId?: number,
  selectedSubcategoryId?: number,
  selectedAccountId?: number
): ConciseCaptureResolution {
  const activeCategories = categories.filter((category) => category.active);
  const activeAccounts = accounts.filter((account) => account.active && account.id !== null);
  let category = selectedCategoryId
    ? activeCategories.find((item) => item.id === selectedCategoryId)
    : undefined;
  let subcategoryId = selectedSubcategoryId ?? null;
  let categoryOnly = false;

  if (!category) {
    const descriptionIdentity = normalizeIdentity(description);
    const categoryMatches = activeCategories.filter((item) =>
      [item.sourceName, item.sourceKey, item.name].some((value) => normalizeIdentity(value) === descriptionIdentity)
    );
    if (categoryMatches.length === 1) {
      category = categoryMatches[0];
      categoryOnly = true;
    }

    const matches = activeCategories.flatMap((item) =>
      item.subcategories
        .filter((subcategory) => normalizeIdentity(subcategory.name) === descriptionIdentity)
        .map((subcategory) => ({ category: item, subcategoryId: subcategory.id }))
    );
    if (!category && matches.length === 1) {
      category = matches[0].category;
      subcategoryId = matches[0].subcategoryId;
    } else if (!category && matches.length > 1 && matches.every((match) => match.category.id === matches[0].category.id)) {
      category = matches[0].category;
    } else if (!category) {
      const matchingCategories = activeCategories.filter((item) =>
        matches.some((match) => match.category.id === item.id)
      );
      return { status: "choose-category", categories: matches.length > 1 ? matchingCategories : activeCategories };
    }
  }

  if (subcategoryId !== null && !category.subcategories.some((subcategory) => subcategory.id === subcategoryId)) {
    subcategoryId = null;
  }

  if (subcategoryId === null) {
    if (!categoryOnly && category.subcategories.length === 0) {
      return { status: "no-subcategories", category };
    } else if (!categoryOnly) {
      const matches = category.subcategories.filter(
        (subcategory) => normalizeIdentity(subcategory.name) === normalizeIdentity(description)
      );
      if (matches.length === 1) subcategoryId = matches[0].id;
      else return { status: "choose-subcategory", category, subcategories: category.subcategories };
    }
  }

  const selectedAccount = selectedAccountId
    ? activeAccounts.find((item) => item.id === selectedAccountId)
    : undefined;
  if (selectedAccount) return { status: "ready", category, subcategoryId, account: selectedAccount };
  if (activeAccounts.length !== 1) {
    return { status: "choose-account", category, subcategoryId, accounts: activeAccounts };
  }
  return { status: "ready", category, subcategoryId, account: activeAccounts[0] };
}

export function resolveConciseAccount(accountHint: string | null, accounts: CaptureAccount[]) {
  if (!accountHint) return undefined;
  const normalized = normalizeIdentity(accountHint);
  const matches = accounts.filter(
    (account) => account.active && account.id !== null
      && [account.name, account.accountKey].some((value) => normalizeIdentity(value) === normalized)
  );
  return matches.length === 1 ? Number(matches[0].id) : undefined;
}

function outcomeForResolution(token: string, resolution: Exclude<ConciseCaptureResolution, { status: "ready" }>): ConciseCaptureOutcome {
  if (resolution.status === "choose-category") return { ...resolution, token };
  if (resolution.status === "choose-subcategory") return { ...resolution, token };
  if (resolution.status === "choose-account") return { status: "choose-account", token, accounts: resolution.accounts };
  return resolution;
}

function savedOutcome(
  transactionId: number,
  resolution: Extract<ConciseCaptureResolution, { status: "ready" }>,
  amountCents: number
): ConciseCaptureOutcome {
  return {
    status: "saved",
    transactionId,
    categoryId: resolution.category.id,
    subcategoryId: resolution.subcategoryId,
    accountId: Number(resolution.account.id),
    amountCents
  };
}
