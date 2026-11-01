import { NextRequest, NextResponse } from "next/server";
import { parseStatementSnapshot } from "@/lib/card-statements";
import { requireEnv } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

function authenticate(request: NextRequest) {
  return validateTelegramInitData(request.headers.get("x-telegram-init-data") || "", requireEnv("TELEGRAM_BOT_TOKEN")).user.id;
}

// Snapshot status is deliberately independent of the dashboard's reporting month.
export async function GET(request: NextRequest) {
  let userId: number;
  try { userId = authenticate(request); } catch { return NextResponse.json({ error: "Unauthorized." }, { status: 401 }); }
  const db = createSupabaseAdmin();
  const { data, error } = await db.from("card_statement_snapshots")
    .select("id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents")
    .eq("telegram_user_id", userId).order("closing_date", { ascending: true }).order("id", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load statements." }, { status: 500 });
  return NextResponse.json({ statements: (data || []).map((row) => ({
    id: row.id, accountId: row.account_id, closingDate: row.closing_date, dueDate: row.due_date,
    originalAmountCents: row.original_amount_cents, remainingAmountCents: row.remaining_amount_cents
  })) });
}

export async function POST(request: NextRequest) {
  let userId: number;
  try { userId = authenticate(request); } catch { return NextResponse.json({ error: "Unauthorized." }, { status: 401 }); }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const input = parseStatementSnapshot(body);
  if (!input) return NextResponse.json({ error: "Invalid statement snapshot." }, { status: 400 });
  const db = createSupabaseAdmin();
  const { data: account, error: accountError } = await db.from("accounts").select("id")
    .eq("telegram_user_id", userId).eq("id", input.accountId).eq("account_type", "card").maybeSingle();
  if (accountError) return NextResponse.json({ error: "Could not check account." }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const { data, error } = await db.from("card_statement_snapshots").insert({
    telegram_user_id: userId, account_id: input.accountId, closing_date: input.closingDate,
    due_date: input.dueDate, original_amount_cents: input.originalAmountCents, remaining_amount_cents: input.remainingAmountCents
  }).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ error: "A statement already exists for this closing date." }, { status: 409 });
  if (error) return NextResponse.json({ error: "Could not save statement." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
