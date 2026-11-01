import { NextRequest, NextResponse } from "next/server";
import { reconcileStatementPayments, parseStatementSnapshot, type CardPayment, type PaymentBaseline } from "@/lib/card-statements";
import { requireEnv } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

function authenticate(request: NextRequest) {
  return validateTelegramInitData(request.headers.get("x-telegram-init-data") || "", requireEnv("TELEGRAM_BOT_TOKEN")).user.id;
}

type StatementRow = {
  id: number; account_id: number; closing_date: string; due_date: string;
  original_amount_cents: number; remaining_amount_cents: number; payment_baseline: PaymentBaseline[] | null;
};

// Snapshot status is deliberately independent of the dashboard's reporting month.
export async function GET(request: NextRequest) {
  let userId: number;
  try { userId = authenticate(request); } catch { return NextResponse.json({ error: "Unauthorized." }, { status: 401 }); }
  const { data, error } = await createSupabaseAdmin().rpc("read_card_statement_inputs", { target_user_id: userId });
  if (error || !data) return NextResponse.json({ error: "Could not load statements." }, { status: 500 });
  const rows: StatementRow[] = data.statements;
  // Existing installations did not record this information; guessing would
  // silently treat edited or deleted historical payments as snapshot history.
  const legacy = rows.filter((row) => row.payment_baseline === null);
  const affected = new Set(legacy.map((row) => row.account_id));
  const usable = rows.filter((row) => !affected.has(row.account_id));
  const snapshots = usable.map((row) => ({ id: row.id, accountId: row.account_id, closingDate: row.closing_date,
    originalAmountCents: row.original_amount_cents, remainingAmountCents: row.remaining_amount_cents, baseline: row.payment_baseline ?? [] }));
  const { remainingById } = reconcileStatementPayments(snapshots, data.payments as CardPayment[]);
  return NextResponse.json({ statements: usable.map((row) => ({
    id: row.id, accountId: row.account_id, closingDate: row.closing_date, dueDate: row.due_date,
    originalAmountCents: row.original_amount_cents, remainingAmountCents: remainingById[row.id]
  })), ...(legacy.length ? { legacyAccounts: [...affected].map((accountId) => ({ accountId,
    closingDates: legacy.filter((row) => row.account_id === accountId).map((row) => row.closing_date) })) } : {}) });
}

export async function POST(request: NextRequest) {
  let userId: number;
  try { userId = authenticate(request); } catch { return NextResponse.json({ error: "Unauthorized." }, { status: 401 }); }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const input = parseStatementSnapshot(body);
  if (!input) return NextResponse.json({ error: "Invalid statement snapshot." }, { status: 400 });
  const replaceLegacy = typeof body === "object" && body !== null && "replaceLegacy" in body && body.replaceLegacy === true;
  const { data, error } = await createSupabaseAdmin().rpc(replaceLegacy ? "rebaseline_legacy_card_statement" : "create_card_statement_snapshot", {
    target_user_id: userId, target_account_id: input.accountId, target_closing_date: input.closingDate,
    target_due_date: input.dueDate, target_original_cents: input.originalAmountCents, target_remaining_cents: input.remainingAmountCents
  });
  if (error?.code === "23505") return NextResponse.json({ error: "A statement already exists for this closing date." }, { status: 409 });
  if (error) return NextResponse.json({ error: "Could not save statement." }, { status: 500 });
  if (data === null) return NextResponse.json({ error: replaceLegacy ? "Legacy statement not found." : "Card not found." }, { status: 404 });
  return NextResponse.json({ ok: true, id: data }, { status: 201 });
}
