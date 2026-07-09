export function transactionCategory(kind: string, value: unknown): string | null {
  if (kind === "transfer") return null;
  const category = String(value || "").trim();
  return category || null;
}

export function transactionCategoryError(kind: string, category: string | null): string | null {
  return kind !== "transfer" && !category ? "Category is required." : null;
}

export function genericTransactionKindError(kind: string): string | null {
  return kind === "transfer" ? "Transfers must use the grouped transfer endpoint." : null;
}
