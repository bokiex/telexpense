export type TransferLeg = {
  transferGroupId: string | null;
  accountId: number | null;
  amountCents: number;
  transferFromAccountId?: number | null;
  transferToAccountId?: number | null;
};

export function transferAccounts(transaction: TransferLeg, transactions: TransferLeg[]) {
  if (!transaction.transferGroupId) return null;
  if (transaction.transferFromAccountId && transaction.transferToAccountId) {
    return {
      fromAccountId: transaction.transferFromAccountId,
      toAccountId: transaction.transferToAccountId
    };
  }
  const group = transactions.filter((item) => item.transferGroupId === transaction.transferGroupId);
  return {
    fromAccountId: group.find((item) => item.amountCents < 0)?.accountId ?? null,
    toAccountId: group.find((item) => item.amountCents > 0)?.accountId ?? null
  };
}
