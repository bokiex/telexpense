import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { listTransactions } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));
    const beforeDate = request.nextUrl.searchParams.get("beforeDate");
    const beforeId = Number(request.nextUrl.searchParams.get("beforeId"));
    const result = await listTransactions(user.id, {
      limit,
      beforeDate: beforeDate || null,
      beforeId: Number.isFinite(beforeId) ? beforeId : null
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}
