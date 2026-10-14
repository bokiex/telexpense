export function resolveRecurringCategoryId(
  categoryKey: string,
  categories: Array<{ id: string; storedId: number | null }>
): number | null {
  return categories.find((category) => category.id === categoryKey)?.storedId ?? null;
}

export function resolveRecurringSubcategoryId(
  subcategoryKey: string,
  subcategories: Array<{ id: string; storedId: number }>
): number | null {
  return subcategories.find((subcategory) => subcategory.id === subcategoryKey)?.storedId ?? null;
}
