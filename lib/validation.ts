import type { ParsedTransaction } from "@/lib/parser";

export function isValidMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidDate(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function transactionAmountError(kind: ParsedTransaction["kind"], amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) return "Amount must be a non-zero integer number of cents.";
  if (kind === "income" && amountCents < 0) return "Income amount must be positive.";
  if ((kind === "expense" || kind === "investment") && amountCents > 0) {
    return `${kind === "expense" ? "Expense" : "Investment"} amount must be negative.`;
  }
  return null;
}
