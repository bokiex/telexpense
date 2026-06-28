import type { AccountType } from "@/lib/repository";

export function normalizeOpeningBalance(accountType: AccountType, cents: number) {
  const rounded = Math.round(cents);
  return accountType === "loan" || accountType === "card" ? -Math.abs(rounded) : Math.abs(rounded);
}

export function debtAmount(balanceCents: number) {
  return Math.max(0, -balanceCents);
}

export function netWorth(balances: number[]) {
  return balances.reduce((total, balance) => total + balance, 0);
}

type NetWorthAccount = {
  id?: number | null;
  accountType?: string;
  balanceCents: number;
  currency: string;
};

type PortfolioValuation = {
  accountId: number;
  portfolioValueCents: number;
  currency: string;
};

export function netWorthByCurrency(accounts: NetWorthAccount[], valuations: PortfolioValuation[] = []) {
  const valuationByAccount = new Map(valuations.map((valuation) => [valuation.accountId, valuation]));
  return accounts.reduce<Record<string, number>>((totals, account) => {
    const valuation = account.accountType === "investment" && account.id
      ? valuationByAccount.get(account.id)
      : undefined;
    const currency = valuation?.currency || account.currency;
    const balance = valuation?.portfolioValueCents ?? account.balanceCents;
    totals[currency] = (totals[currency] || 0) + balance;
    return totals;
  }, {});
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
