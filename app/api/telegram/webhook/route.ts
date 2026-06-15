import { NextRequest, NextResponse } from "next/server";
import { budgetWarningText } from "@/lib/budget";
import { optionalEnv } from "@/lib/env";
import { parseTransactionMessage } from "@/lib/parser";
import {
  addTransaction,
  currentMonth,
  getBudgetStatus,
  setBudget,
  upsertTelegramUser
} from "@/lib/repository";
import { dashboardKeyboard, sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const update = await request.json();
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

    const parsed = parseTransactionMessage(text);
    await addTransaction(user.id, parsed);
    const status = await getBudgetStatus(user.id, currentMonth(), parsed.category);
    const warning = budgetWarningText(status, Number(optionalEnv("BUDGET_WARNING_RATIO", "0.8")));
    const reply = [`Saved ${parsed.category}: ${money(Math.abs(parsed.amountCents))} on ${parsed.account}.`, warning]
      .filter(Boolean)
      .join("\n");
    await sendTelegramMessage(chatId, reply, dashboardKeyboard());
    return NextResponse.json({ ok: true });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Could not save transaction.";
    console.error("Telegram webhook handler failed", error);
    await safeSendTelegramMessage(chatId, `${messageText}\nExample: food, debit card, lunch, $4.20`);
    return NextResponse.json({ ok: true });
  }
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
