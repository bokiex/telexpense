import {
  addTransaction,
  consumePendingTransactionCapture,
  createPendingTransactionCapture,
  getLastUsedAccountId,
  getPendingTransactionCapture,
  getStoredAccounts,
  getStoredCategories,
  updatePendingTransactionCapture
} from "@/lib/repository";
import type {
  ConciseCaptureInput,
  ConciseCaptureStore,
  PendingCaptureCommit,
  PendingConciseCapture
} from "@/lib/conciseCapture";

export const supabaseConciseCaptureStore: ConciseCaptureStore = {
  async getCatalog(telegramUserId) {
    const [categories, accounts] = await Promise.all([
      getStoredCategories(telegramUserId),
      getStoredAccounts(telegramUserId)
    ]);
    return { categories, accounts };
  },

  getLastUsedAccountId,

  createPending(telegramUserId, capture) {
    return createPendingTransactionCapture(telegramUserId, capture);
  },

  async getPending(telegramUserId, token): Promise<PendingConciseCapture | null> {
    return getPendingTransactionCapture(telegramUserId, token);
  },

  updatePending(telegramUserId, token, selection) {
    return updatePendingTransactionCapture(telegramUserId, token, selection);
  },

  saveResolved(telegramUserId, capture: ConciseCaptureInput, resolution) {
    return addTransaction(telegramUserId, {
      kind: capture.kind,
      category: resolution.category.sourceName,
      account: resolution.account.name,
      description: capture.description,
      amountCents: capture.amountCents
    }, {
      categoryId: resolution.category.id,
      category: resolution.category.sourceName,
      subcategoryId: resolution.subcategoryId,
      accountId: Number(resolution.account.id),
      account: resolution.account.name
    });
  },

  async consumePending(telegramUserId, token, selection): Promise<PendingCaptureCommit> {
    try {
      const transactionId = await consumePendingTransactionCapture(
        telegramUserId,
        token,
        selection.accountId,
        selection.categoryId,
        selection.subcategoryId
      );
      return transactionId === null ? { status: "already-used" } : { status: "saved", transactionId };
    } catch (error) {
      if (error instanceof Error && error.message === "Pending transaction selection is not available") {
        return { status: "unavailable" };
      }
      throw error;
    }
  }
};
