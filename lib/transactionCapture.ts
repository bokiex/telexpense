import { normalizeIdentity } from "@/lib/identity";
import type { StoredAccount, StoredCategory } from "@/lib/repository";

type CaptureAccount = Omit<StoredAccount, "balanceCents">;

export type CaptureChoice =
  | { status: "ready"; category: StoredCategory; subcategoryId: number | null; account: CaptureAccount }
  | { status: "choose-category"; categories: StoredCategory[] }
  | { status: "choose-subcategory"; category: StoredCategory; subcategories: StoredCategory["subcategories"] }
  | { status: "choose-account"; category: StoredCategory; subcategoryId: number | null; accounts: CaptureAccount[] };

export function resolveConciseCapture(
  description: string,
  categories: StoredCategory[],
  accounts: CaptureAccount[],
  selectedCategoryId?: number,
  selectedSubcategoryId?: number
): CaptureChoice {
  const activeCategories = categories.filter((category) => category.active);
  const activeAccounts = accounts.filter((account) => account.active && account.id !== null);
  let category = selectedCategoryId
    ? activeCategories.find((item) => item.id === selectedCategoryId)
    : undefined;
  let subcategoryId = selectedSubcategoryId ?? null;

  if (!category) {
    const matches = activeCategories.filter((item) =>
      item.subcategories.some((subcategory) => normalizeIdentity(subcategory.name) === normalizeIdentity(description))
    );
    if (matches.length === 1) {
      category = matches[0];
      subcategoryId = category.subcategories.find(
        (subcategory) => normalizeIdentity(subcategory.name) === normalizeIdentity(description)
      )?.id ?? null;
    } else {
      return { status: "choose-category", categories: matches.length > 1 ? matches : activeCategories };
    }
  }

  if (subcategoryId === null) {
    const matches = category.subcategories.filter(
      (subcategory) => normalizeIdentity(subcategory.name) === normalizeIdentity(description)
    );
    if (matches.length === 1) subcategoryId = matches[0].id;
    else return { status: "choose-subcategory", category, subcategories: category.subcategories };
  }

  if (activeAccounts.length !== 1) {
    return { status: "choose-account", category, subcategoryId, accounts: activeAccounts };
  }
  return { status: "ready", category, subcategoryId, account: activeAccounts[0] };
}

export function callbackData(token: string, kind: "c" | "s" | "a", id: number) {
  const value = `pc:${token}:${kind}:${id}`;
  if (Buffer.byteLength(value, "utf8") > 64) throw new Error("Telegram callback data is too long.");
  return value;
}
