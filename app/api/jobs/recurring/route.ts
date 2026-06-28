import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { currentMonth, materializeRecurringTransactions } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const expected = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const provided = Buffer.from(request.headers.get("authorization") || "");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await materializeRecurringTransactions(currentMonth(), 500, 5_000);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Recurring materialization failed" }, { status: 500 });
  }
}
