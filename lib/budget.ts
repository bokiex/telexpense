export function budgetWarningText(
  status: { category: string; spentCents: number; budgetCents: number; ratio: number } | null,
  threshold: number
) {
  if (!status || status.ratio < threshold) return null;
  const spent = money(status.spentCents);
  const budget = money(status.budgetCents);
  const percent = Math.round(status.ratio * 100);
  if (status.ratio >= 1) {
    return `Budget exceeded for ${status.category}: ${spent} of ${budget} (${percent}%).`;
  }
  return `Budget warning for ${status.category}: ${spent} of ${budget} (${percent}%).`;
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

