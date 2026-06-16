import { NextRequest, NextResponse } from "next/server";
import { getSummary, currentMonth } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
    const month = request.nextUrl.searchParams.get("month") || currentMonth();
    const summary = await getSummary(user.id, month);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 401 });
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || "Unknown error");
  return "Unknown error";
}
