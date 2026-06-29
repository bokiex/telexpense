import { NextRequest, NextResponse } from "next/server";
import { budgetWarningText } from "@/lib/budget";
import { optionalEnv } from "@/lib/env";
import { parseTransactionMessage } from "@/lib/parser";
import {
  addTransaction,
  currentMonth,
  deleteTransaction,
  getBudgetStatus,
  resolveTransactionIdentity,
  setBudget,
  updateTransaction,
  upsertTelegramUser
} from "@/lib/repository";
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
    const reply = [`${verb} ${parsed.category}: ${money(Math.abs(parsed.amountCents))} on ${parsed.account}.`, warning]
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
