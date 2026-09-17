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

export function displayTransferGroups<T extends TransferLeg>(transactions: T[]): T[] {
  const displayed: T[] = [];
  const groupIndexes = new Map<string, number>();

  for (const transaction of transactions) {
    if (!transaction.transferGroupId) {
      displayed.push(transaction);
      continue;
    }

    const index = groupIndexes.get(transaction.transferGroupId);
    if (transaction.amountCents < 0) {
      if (index === undefined) {
        groupIndexes.set(transaction.transferGroupId, displayed.length);
        displayed.push(transaction);
      } else {
        displayed[index] = transaction;
      }
      continue;
    }

    if (index === undefined) {
      groupIndexes.set(transaction.transferGroupId, displayed.length);
      displayed.push({
        ...transaction,
        accountId: transaction.transferFromAccountId ?? transaction.accountId,
        amountCents: -Math.abs(transaction.amountCents)
      });
    }
  }

  return displayed;
}
