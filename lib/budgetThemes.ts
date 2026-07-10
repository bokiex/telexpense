export const THEME_BUDGET_CATEGORY_PREFIX = "__budget_group__:";

export function themeBudgetCategory(group: string) {
  return `${THEME_BUDGET_CATEGORY_PREFIX}${group.toLowerCase()}`;
}

export function isThemeBudgetCategory(category: string) {
  return category.startsWith(THEME_BUDGET_CATEGORY_PREFIX);
}
