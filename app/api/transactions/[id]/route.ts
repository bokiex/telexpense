import { NextRequest, NextResponse } from "next/server";
import { deleteTransaction, updateTransactionFields } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { requireEnv } from "@/lib/env";
import type { ParsedTransaction } from "@/lib/parser";

export const runtime = "nodejs";

const kinds = new Set(["expense", "income", "investment", "transfer"]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const userId = authenticatedUserId(request);
    const transactionId = await transactionIdFromContext(context);
    const body = await request.json();
    const kind = String(body.kind || "").trim().toLowerCase();
    const category = String(body.category || "").trim();
    const account = String(body.account || "").trim();
    const accountId = body.accountId === null || body.accountId === undefined || body.accountId === "" ? null : Number(body.accountId);
    const description = String(body.description || "").trim();
    const amountCents = Number(body.amountCents);
    const currency = String(body.currency || "USD").trim().toUpperCase();
    const occurredOn = String(body.occurredOn || "").trim();

    if (!kinds.has(kind)) return NextResponse.json({ error: "Transaction kind is not valid." }, { status: 400 });
    if (!category) return NextResponse.json({ error: "Category is required." }, { status: 400 });
    if (!account) return NextResponse.json({ error: "Account is required." }, { status: 400 });
    if (accountId !== null && !Number.isFinite(accountId)) return NextResponse.json({ error: "Account id is not valid." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Description is required." }, { status: 400 });
    if (!Number.isFinite(amountCents)) return NextResponse.json({ error: "Amount is not valid." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD." }, { status: 400 });
    }

    await updateTransactionFields(userId, transactionId, {
      kind: kind as ParsedTransaction["kind"],
      category,
      account,
      accountId,
      description,
      amountCents: Math.round(amountCents),
      currency: currency || "USD",
      occurredOn
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const userId = authenticatedUserId(request);
    const transactionId = await transactionIdFromContext(context);
    await deleteTransaction(userId, transactionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function authenticatedUserId(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
  return user.id;
}

async function transactionIdFromContext(context: RouteContext) {
  const { id } = await context.params;
  const transactionId = Number(id);
  if (!Number.isFinite(transactionId)) throw new Error("Transaction id is not valid.");
  return transactionId;
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
}
