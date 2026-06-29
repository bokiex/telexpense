import { normalizeIdentity } from "@/lib/identity";
import type { StoredAccount, StoredCategory } from "@/lib/repository";

type CaptureAccount = Omit<StoredAccount, "balanceCents">;

export type CaptureChoice =
  | { status: "ready"; category: StoredCategory; subcategoryId: number | null; account: CaptureAccount }
  | { status: "choose-category"; categories: StoredCategory[] }
  | { status: "choose-subcategory"; category: StoredCategory; subcategories: StoredCategory["subcategories"] }
  | { status: "no-subcategories"; category: StoredCategory }
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
    const descriptionIdentity = normalizeIdentity(description);
    const matches = activeCategories.flatMap((item) =>
      item.subcategories
        .filter((subcategory) => normalizeIdentity(subcategory.name) === descriptionIdentity)
        .map((subcategory) => ({ category: item, subcategoryId: subcategory.id }))
    );
    if (matches.length === 1) {
      category = matches[0].category;
      subcategoryId = matches[0].subcategoryId;
    } else if (matches.length > 1 && matches.every((match) => match.category.id === matches[0].category.id)) {
      category = matches[0].category;
    } else {
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
    if (category.subcategories.length === 0) {
      return { status: "no-subcategories", category };
    }
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
