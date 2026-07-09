import { NextRequest, NextResponse } from "next/server";
import { budgetWarningText } from "@/lib/budget";
import { optionalEnv } from "@/lib/env";
import { isConciseTransactionMessage, parseConciseTransactionMessage, parseTransactionMessage } from "@/lib/parser";
import {
  addTransaction,
  createPendingTransactionCapture,
  currentMonth,
  consumePendingTransactionCapture,
  deleteTransaction,
  getPendingTransactionCapture,
  getBudgetStatus,
  getStoredAccounts,
  getStoredCategories,
  resolveTransactionIdentity,
  setBudget,
  updatePendingTransactionCapture,
  updateTransaction,
  upsertTelegramUser
} from "@/lib/repository";
import { callbackData, resolveConciseCapture } from "@/lib/transactionCapture";
import {
  answerTelegramCallback,
  dashboardKeyboard,
  editTelegramMessageReplyMarkup,
  sendTelegramMessage,
  transactionKeyboard
} from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const update = await request.json();
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text || !message.from?.id || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const chatId = Number(message.chat.id);
  const user = {
    id: Number(message.from.id),
    first_name: message.from.first_name as string | undefined,
    username: message.from.username as string | undefined
  };
  const text = String(message.text).trim();

  try {
    if (text.startsWith("/start")) {
      await upsertTelegramUser(user);
      await sendTelegramMessage(chatId, "Send expenses like: food, debit card, lunch, $4.20", dashboardKeyboard());
      return NextResponse.json({ ok: true });
    }

    await upsertTelegramUser(user);

    if (text.startsWith("/budget")) {
      const reply = await handleBudgetCommand(user.id, text);
      await sendTelegramMessage(chatId, reply, dashboardKeyboard());
      return NextResponse.json({ ok: true });
    }

    const editId = editTransactionIdFromReply(message);
    if (!editId && isConciseTransactionMessage(text)) {
      const concise = parseConciseTransactionMessage(text);
      await beginConciseCapture(user.id, chatId, concise);
      return NextResponse.json({ ok: true });
    }
    const parsedInput = parseTransactionMessage(text);
    const identity = await resolveTransactionIdentity(user.id, parsedInput.category, parsedInput.account);
    const parsed = { ...parsedInput, category: identity.category, account: identity.account };
    const transactionId = editId || (await addTransaction(user.id, parsed, identity));
    if (editId) {
      await updateTransaction(user.id, editId, parsed, identity);
    }

    const status = await getBudgetStatus(user.id, currentMonth(), parsed.category);
    const warning = budgetWarningText(status, Number(optionalEnv("BUDGET_WARNING_RATIO", "0.8")));
    const verb = editId ? "Updated" : "Saved";
    const breadcrumb = await identityBreadcrumb(user.id, identity.categoryId, identity.subcategoryId);
    const reply = [`${verb} ${breadcrumb}: ${money(Math.abs(parsed.amountCents))} on ${parsed.account}.`, warning]
      .filter(Boolean)
      .join("\n");
    await sendTelegramMessage(chatId, reply, transactionKeyboard(transactionId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Could not save transaction.";
    console.error("Telegram webhook handler failed", error);
    await safeSendTelegramMessage(chatId, `${messageText}\nExample: food, debit card, lunch, $4.20`);
    return NextResponse.json({ ok: true });
  }
}

async function handleCallbackQuery(callbackQuery: any) {
  const data = String(callbackQuery.data || "");
  const fromUserId = Number(callbackQuery.from?.id);
  const chatId = Number(callbackQuery.message?.chat?.id);
  const messageId = Number(callbackQuery.message?.message_id);
  const callbackId = String(callbackQuery.id || "");
  if (data.startsWith("pc:")) {
    await handlePendingChoice(callbackQuery);
    return;
  }
  const [, action, idValue] = data.split(":");
  const transactionId = Number(idValue);

  if (!callbackId || !fromUserId || !chatId || !Number.isFinite(transactionId)) return;

  try {
    if (action === "undo") {
      await deleteTransaction(fromUserId, transactionId);
      await answerTelegramCallback(callbackId, "Transaction removed.");
      if (messageId) await editTelegramMessageReplyMarkup(chatId, messageId, dashboardKeyboard());
      await sendTelegramMessage(chatId, `Removed transaction #${transactionId}.`, dashboardKeyboard());
      return;
    }

    if (action === "edit") {
      await answerTelegramCallback(callbackId, "Reply with the corrected transaction.");
      await sendTelegramMessage(
        chatId,
        `Editing transaction #${transactionId}. Reply with: category, account, description, $amount`,
        {
          force_reply: true,
          input_field_placeholder: "food, debit card, lunch, $4.20"
        }
      );
    }
  } catch (error) {
    console.error("Telegram callback handler failed", error);
    if (callbackId) await answerTelegramCallback(callbackId, "Could not complete that action.");
  }
}

async function beginConciseCapture(
  telegramUserId: number,
  chatId: number,
  concise: ReturnType<typeof parseConciseTransactionMessage>
) {
  const [categories, accounts] = await Promise.all([
    getStoredCategories(telegramUserId),
    getStoredAccounts(telegramUserId)
  ]);
  const resolution = resolveConciseCapture(concise.description, categories, accounts);
  if (resolution.status === "ready") {
    await saveConciseTransaction(telegramUserId, chatId, concise, resolution);
    return;
  }
  const token = await createPendingTransactionCapture(telegramUserId, concise);
  await sendCapturePrompt(chatId, token, resolution);
}

async function handlePendingChoice(callbackQuery: any) {
  const data = String(callbackQuery.data || "");
  const callbackId = String(callbackQuery.id || "");
  const telegramUserId = Number(callbackQuery.from?.id);
  const chatId = Number(callbackQuery.message?.chat?.id);
  const [, token, kind, idValue] = data.split(":");
  const choiceId = Number(idValue);
  if (!callbackId || !telegramUserId || !chatId || !token || !["c", "s", "a"].includes(kind) || !Number.isSafeInteger(choiceId)) return;

  let callbackAnswered = false;
  const answerCallback = async (text?: string) => {
    callbackAnswered = true;
    await answerTelegramCallback(callbackId, text);
  };

  try {
    const pending = await getPendingTransactionCapture(telegramUserId, token);
    if (!pending) {
      await answerCallback("This selection expired. Send the transaction again.");
      return;
    }
    const [categories, accounts] = await Promise.all([
      getStoredCategories(telegramUserId),
      getStoredAccounts(telegramUserId)
    ]);
    if (kind === "c") {
      const category = categories.find((item) => item.active && item.id === choiceId);
      if (!category) throw new Error("Category is not available.");
      await updatePendingTransactionCapture(telegramUserId, token, { categoryId: choiceId, subcategoryId: null });
      pending.categoryId = choiceId;
      pending.subcategoryId = null;
    } else if (kind === "s") {
      const category = categories.find((item) => item.id === pending.categoryId);
      if (!category?.subcategories.some((item) => item.id === choiceId)) throw new Error("Subcategory is not available.");
      await updatePendingTransactionCapture(telegramUserId, token, { subcategoryId: choiceId });
      pending.subcategoryId = choiceId;
    } else {
      const account = accounts.find((item) => item.active && item.id === choiceId);
      const category = categories.find((item) => item.id === pending.categoryId);
      if (!account || !category || pending.subcategoryId === null) throw new Error("Selection is incomplete.");
      const transactionId = await consumePendingTransactionCapture(
        telegramUserId,
        token,
        Number(account.id),
        category.id,
        pending.subcategoryId
      );
      if (transactionId === null) {
        await answerCallback("This selection was already used or expired.");
        return;
      }
      await answerCallback("Saving…");
      await sendConfirmation(telegramUserId, chatId, transactionId, category.id, pending.subcategoryId, account.name, pending.amountCents);
      return;
    }

    const resolution = resolveConciseCapture(
      pending.description,
      categories,
      accounts,
      pending.categoryId ?? undefined,
      pending.subcategoryId ?? undefined
    );
    if (resolution.status === "ready") {
      const transactionId = await consumePendingTransactionCapture(
        telegramUserId,
        token,
        Number(resolution.account.id),
        resolution.category.id,
        resolution.subcategoryId
      );
      if (transactionId === null) {
        await answerCallback("This selection was already used or expired.");
        return;
      }
      await answerCallback("Saving…");
      await sendConfirmation(telegramUserId, chatId, transactionId, resolution.category.id, resolution.subcategoryId, resolution.account.name, pending.amountCents);
    } else {
      await answerCallback();
      await sendCapturePrompt(chatId, token, resolution);
    }
  } catch (error) {
    console.error("Telegram pending choice failed", error);
    if (!callbackAnswered) await answerCallback("Could not save that choice.");
  }
}

async function saveConciseTransaction(
  telegramUserId: number,
  chatId: number,
  concise: ReturnType<typeof parseConciseTransactionMessage>,
  resolution: Extract<ReturnType<typeof resolveConciseCapture>, { status: "ready" }>
) {
  const transactionId = await addTransaction(telegramUserId, {
    ...concise,
    category: resolution.category.sourceName,
    account: resolution.account.name
  }, {
    categoryId: resolution.category.id,
    category: resolution.category.sourceName,
    subcategoryId: resolution.subcategoryId,
    accountId: Number(resolution.account.id),
    account: resolution.account.name
  });
  await sendConfirmation(telegramUserId, chatId, transactionId, resolution.category.id, resolution.subcategoryId, resolution.account.name, concise.amountCents);
}

async function sendCapturePrompt(chatId: number, token: string, resolution: Exclude<ReturnType<typeof resolveConciseCapture>, { status: "ready" }>) {
  if (resolution.status === "choose-category") {
    await sendTelegramMessage(chatId, "Choose a parent category:", choiceKeyboard(resolution.categories.map((item) => [item.name, callbackData(token, "c", item.id)])));
  } else if (resolution.status === "choose-subcategory") {
    await sendTelegramMessage(chatId, `Choose a subcategory under ${resolution.category.name}:`, choiceKeyboard(resolution.subcategories.map((item) => [item.name, callbackData(token, "s", item.id)])));
  } else if (resolution.status === "no-subcategories") {
    await sendTelegramMessage(chatId, `Add a subcategory under ${resolution.category.name} in the dashboard, then send the transaction again.`);
  } else {
    const rows = resolution.accounts.map((item) => [item.name, callbackData(token, "a", Number(item.id))] as [string, string]);
    await sendTelegramMessage(chatId, rows.length ? "Choose an account:" : "Add an active account in the dashboard, then send the transaction again.", choiceKeyboard(rows));
  }
}

function choiceKeyboard(choices: [string, string][]) {
  return dashboardKeyboard(choices.map(([text, callback_data]) => [{ text, callback_data }]));
}

async function sendConfirmation(telegramUserId: number, chatId: number, transactionId: number, categoryId: number, subcategoryId: number | null, account: string, amountCents: number) {
  const breadcrumb = await identityBreadcrumb(telegramUserId, categoryId, subcategoryId);
  const status = await getBudgetStatus(telegramUserId, currentMonth(), (await getStoredCategories(telegramUserId)).find((item) => item.id === categoryId)?.sourceName || "");
  const warning = budgetWarningText(status, Number(optionalEnv("BUDGET_WARNING_RATIO", "0.8")));
  await sendTelegramMessage(chatId, [`Saved ${breadcrumb}: ${money(Math.abs(amountCents))} on ${account}.`, warning].filter(Boolean).join("\n"), transactionKeyboard(transactionId));
}

async function identityBreadcrumb(telegramUserId: number, categoryId: number, subcategoryId: number | null) {
  const category = (await getStoredCategories(telegramUserId)).find((item) => item.id === categoryId);
  const subcategory = category?.subcategories.find((item) => item.id === subcategoryId);
  return [category?.name || category?.sourceName || "Transaction", subcategory?.name].filter(Boolean).join(" › ");
}

function editTransactionIdFromReply(message: any) {
  const prompt = String(message.reply_to_message?.text || "");
  const match = /^Editing transaction #(?<id>\d+)\./.exec(prompt);
  return match?.groups?.id ? Number(match.groups.id) : null;
}

async function safeSendTelegramMessage(chatId: number, text: string) {
  try {
    await sendTelegramMessage(chatId, text);
  } catch (error) {
    console.error("Could not send fallback Telegram message", error);
  }
}

async function handleBudgetCommand(telegramUserId: number, text: string) {
  const parts = text.split(/\s+/);
  if (parts.length < 3) return "Use: /budget category amount [YYYY-MM]";
  const category = parts[1].toLowerCase();
  const amount = Number(parts[2].replaceAll("$", "").replaceAll(",", ""));
  if (!Number.isFinite(amount)) return "Budget amount is not valid.";
  const month = parts[3] || currentMonth();
  await setBudget(telegramUserId, category, month, Math.round(amount * 100));
  return `Budget set for ${category}: ${money(Math.round(amount * 100))} in ${month}.`;
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
