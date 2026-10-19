import { NextRequest, NextResponse } from "next/server";
import { budgetWarningText } from "@/lib/budget";
import { optionalEnv } from "@/lib/env";
import { isConciseTransactionMessage, parseConciseCommandMessage, parseConciseTransactionMessage, parseTransactionMessage } from "@/lib/parser";
import {
  addTransaction,
  currentMonth,
  deleteTransaction,
  getBudgetStatus,
  getStoredAccounts,
  getStoredCategories,
  resolveTransactionIdentity,
  setBudget,
  updateTransaction,
  upsertTelegramUser
} from "@/lib/repository";
import {
  selectConciseCapture,
  startConciseCapture,
  type ConciseCaptureOutcome,
  type ConciseCaptureSelection
} from "@/lib/conciseCapture";
import { supabaseConciseCaptureStore } from "@/lib/conciseCaptureStore";
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
      await sendTelegramMessage(chatId, "Send expenses like: 4.20 lunch. Add @account when needed. Use /income 5000 salary for income entries.", dashboardKeyboard());
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/budget")) {
      await upsertTelegramUser(user);
      const reply = await handleBudgetCommand(user.id, text);
      await sendTelegramMessage(chatId, reply, dashboardKeyboard());
      return NextResponse.json({ ok: true });
    }

    const editId = editTransactionIdFromReply(message);
    if (!editId) {
      const concise = parseConciseCommandMessage(text) || (isConciseTransactionMessage(text) ? parseConciseTransactionMessage(text) : null);
      if (concise) {
        await upsertTelegramUser(user);
        await beginConciseCapture(user.id, chatId, concise);
        return NextResponse.json({ ok: true });
      }
    }
    const parsedInput = parseTransactionMessage(text);
    await upsertTelegramUser(user);
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
    await safeSendTelegramMessage(chatId, `${messageText}\nExamples: 4.20 lunch, 4.20 lunch @dbs, /income 5000 salary`);
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
        `Editing transaction #${transactionId}. Reply with: category, account, description, amount`,
        {
          force_reply: true,
          input_field_placeholder: "food, debit card, lunch, 4.20"
        }
      );
    }
  } catch (error) {
    console.error("Telegram callback handler failed", error);
    if (callbackId) await answerTelegramCallback(callbackId, "Could not complete that action.");
  }
}

async function beginConciseCapture(telegramUserId: number, chatId: number, concise: ReturnType<typeof parseConciseTransactionMessage>) {
  const outcome = await startConciseCapture(supabaseConciseCaptureStore, telegramUserId, concise);
  if (outcome.status === "saved") return deliverSavedConciseCaptureOutcome(telegramUserId, chatId, outcome);
  await deliverConciseCaptureOutcome(telegramUserId, chatId, outcome);
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
    const selection: ConciseCaptureSelection = kind === "c"
      ? { kind: "category", id: choiceId }
      : kind === "s"
        ? { kind: "subcategory", id: choiceId }
        : { kind: "account", id: choiceId };
    const outcome = await selectConciseCapture(supabaseConciseCaptureStore, telegramUserId, token, selection);
    if (outcome.status === "saved") {
      await deliverSavedConciseCaptureOutcome(telegramUserId, chatId, outcome, callbackId);
      return;
    }
    await answerCallback(callbackAnswer(outcome));
    await deliverConciseCaptureOutcome(telegramUserId, chatId, outcome);
  } catch (error) {
    console.error("Telegram pending choice failed", error);
    if (!callbackAnswered) await answerTelegramCallback(callbackId, "Could not save that choice.");
  }
}

async function deliverConciseCaptureOutcome(telegramUserId: number, chatId: number, outcome: ConciseCaptureOutcome) {
  if (outcome.status === "saved") {
    await sendConfirmation(telegramUserId, chatId, outcome);
  } else if (outcome.status === "choose-category") {
    await sendTelegramMessage(chatId, "Choose a parent category:", choiceKeyboard(outcome.categories.map((item) => [item.name, callbackData(outcome.token, "c", item.id)])));
  } else if (outcome.status === "choose-subcategory") {
    await sendTelegramMessage(chatId, `Choose a subcategory under ${outcome.category.name}:`, choiceKeyboard(outcome.subcategories.map((item) => [item.name, callbackData(outcome.token, "s", item.id)])));
  } else if (outcome.status === "choose-account") {
    const rows = outcome.accounts.map((item) => [item.name, callbackData(outcome.token, "a", Number(item.id))] as [string, string]);
    await sendTelegramMessage(chatId, rows.length ? "Choose an account:" : "Add an active account in the dashboard, then send the transaction again.", choiceKeyboard(rows));
  } else if (outcome.status === "no-subcategories") {
    await sendTelegramMessage(chatId, `Add a subcategory under ${outcome.category.name} in the dashboard, then send the transaction again.`);
  } else if (outcome.status === "account-not-found") {
    await sendTelegramMessage(chatId, `Account "${outcome.accountHint}" was not found. Use the account name or key after @.`);
  }
}

async function deliverSavedConciseCaptureOutcome(
  telegramUserId: number,
  chatId: number,
  outcome: Extract<ConciseCaptureOutcome, { status: "saved" }>,
  callbackId?: string
) {
  try {
    if (callbackId) await answerTelegramCallback(callbackId, "Saving…");
    await sendConfirmation(telegramUserId, chatId, outcome);
  } catch (error) {
    console.error("Telegram concise-capture delivery failed", error);
  }
}

function choiceKeyboard(choices: [string, string][]) {
  return dashboardKeyboard(choices.map(([text, callback_data]) => [{ text, callback_data }]));
}

function callbackAnswer(outcome: ConciseCaptureOutcome) {
  if (outcome.status === "saved") return "Saving…";
  if (outcome.status === "expired") return "This selection expired. Send the transaction again.";
  if (outcome.status === "already-used") return "This selection was already used or expired.";
  if (outcome.status === "selection-unavailable") return `This ${outcome.selection} is not available.`;
  return undefined;
}

function callbackData(token: string, kind: "c" | "s" | "a", id: number) {
  const value = `pc:${token}:${kind}:${id}`;
  if (Buffer.byteLength(value, "utf8") > 64) throw new Error("Telegram callback data is too long.");
  return value;
}

async function sendConfirmation(telegramUserId: number, chatId: number, outcome: Extract<ConciseCaptureOutcome, { status: "saved" }>) {
  const [categories, accounts] = await Promise.all([getStoredCategories(telegramUserId), getStoredAccounts(telegramUserId)]);
  const category = categories.find((item) => item.id === outcome.categoryId);
  const subcategory = category?.subcategories.find((item) => item.id === outcome.subcategoryId);
  const breadcrumb = [category?.name || category?.sourceName || "Transaction", subcategory?.name].filter(Boolean).join(" › ");
  const account = accounts.find((item) => item.id === outcome.accountId)?.name || "account";
  const status = await getBudgetStatus(telegramUserId, currentMonth(), category?.sourceName || "");
  const warning = budgetWarningText(status, Number(optionalEnv("BUDGET_WARNING_RATIO", "0.8")));
  await sendTelegramMessage(chatId, [`Saved ${breadcrumb}: ${money(Math.abs(outcome.amountCents))} on ${account}.`, warning].filter(Boolean).join("\n"), transactionKeyboard(outcome.transactionId));
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
  const amount = Number(parts[2].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return "Budget amount is not valid.";
  const month = parts[3] || currentMonth();
  await setBudget(telegramUserId, category, month, Math.round(amount * 100));
  return `Budget set for ${category}: ${money(Math.round(amount * 100))} in ${month}.`;
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}
