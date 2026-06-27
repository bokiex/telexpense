import type { AccountType } from "@/lib/repository";

export function normalizeOpeningBalance(accountType: AccountType, cents: number) {
  const rounded = Math.round(cents);
  return accountType === "loan" || accountType === "card" ? -Math.abs(rounded) : rounded;
}

export function debtAmount(balanceCents: number) {
  return Math.max(0, -balanceCents);
}

export function netWorth(balances: number[]) {
  return balances.reduce((total, balance) => total + balance, 0);
}

export function loanMetrics(openingBalanceCents: number, balanceCents: number) {
  const openingDebt = debtAmount(openingBalanceCents);
  const remainingDebt = debtAmount(balanceCents);
  const repaidCents = Math.max(0, openingDebt - remainingDebt);
  return {
    openingDebt,
    remainingDebt,
    repaidCents,
    payoffProgress: openingDebt ? Math.min(100, Math.round((repaidCents / openingDebt) * 100)) : 0
  };
}
