import { NextRequest, NextResponse } from "next/server";
import { deleteTransfer, updateTransferFields } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { requireEnv } from "@/lib/env";
import { isValidDate } from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ transferGroupId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
    const { transferGroupId } = await context.params;
    const body = await request.json();
    const fromAccountId = Number(body.fromAccountId);
    const toAccountId = Number(body.toAccountId);
    const description = String(body.description || "").trim();
    const amountCents = Number(body.amountCents);
    const currency = String(body.currency || "SGD").trim().toUpperCase();
    const occurredOn = String(body.occurredOn || "").trim();

    if (!isValidTransferGroupId(transferGroupId)) return NextResponse.json({ error: "Transfer group is not valid." }, { status: 400 });
    if (!Number.isFinite(fromAccountId)) return NextResponse.json({ error: "From account is required." }, { status: 400 });
    if (!Number.isFinite(toAccountId)) return NextResponse.json({ error: "To account is required." }, { status: 400 });
    if (fromAccountId === toAccountId) return NextResponse.json({ error: "From and to accounts must be different." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Description is required." }, { status: 400 });
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Amount must be a positive integer number of cents." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });
    if (!isValidDate(occurredOn)) return NextResponse.json({ error: "Date must be a valid YYYY-MM-DD date." }, { status: 400 });

    await updateTransferFields(user.id, transferGroupId, {
      fromAccountId, toAccountId, description,
      amountCents, currency, occurredOn
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
    const { transferGroupId } = await context.params;
    if (!isValidTransferGroupId(transferGroupId)) {
      return NextResponse.json({ error: "Transfer group is not valid." }, { status: 400 });
    }
    await deleteTransfer(user.id, transferGroupId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}

function isValidTransferGroupId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
