import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { listTransactions } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { isValidDate, isValidMonth } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 50;
    const month = request.nextUrl.searchParams.get("month") || "";
    const beforeDate = request.nextUrl.searchParams.get("beforeDate");
    const beforeId = Number(request.nextUrl.searchParams.get("beforeId"));
    if (
      !isValidMonth(month)
      || Boolean(beforeDate) !== request.nextUrl.searchParams.has("beforeId")
      || (beforeDate && !isValidDate(beforeDate))
      || (request.nextUrl.searchParams.has("beforeId") && (!Number.isSafeInteger(beforeId) || beforeId <= 0))
    ) {
      return NextResponse.json({ error: "Invalid history query." }, { status: 400 });
    }
    const result = await listTransactions(user.id, {
      month,
      limit,
      beforeDate: beforeDate || null,
      beforeId: beforeDate ? beforeId : null
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}
