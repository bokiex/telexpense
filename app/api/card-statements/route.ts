import { NextRequest, NextResponse } from "next/server";
import { allocateSnapshotPayments, parseStatementSnapshot } from "@/lib/card-statements";
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
    .select("id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, created_at")
    .eq("telegram_user_id", userId).order("closing_date", { ascending: true }).order("id", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load statements." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ statements: [] });
  const { data: accounts, error: accountError } = await db.from("accounts").select("id, account_type").eq("telegram_user_id", userId);
  if (accountError) return NextResponse.json({ error: "Could not load statements." }, { status: 500 });
  // Fetch all grouped legs, not just the first PostgREST page. Both legs must
  // belong to this user and the source must be a bank account.
  const legs: { id: number; account_id: number; transfer_group_id: string; amount_cents: number; created_at: string }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error: paymentError } = await db.from("transactions")
      .select("id, account_id, transfer_group_id, amount_cents, created_at")
      .eq("telegram_user_id", userId).not("transfer_group_id", "is", null)
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (paymentError) return NextResponse.json({ error: "Could not load statements." }, { status: 500 });
    legs.push(...(page || []));
    if (!page || page.length < pageSize) break;
  }
  const banks = new Set((accounts || []).filter((a) => a.account_type === "bank").map((a) => a.id));
  const groups = new Map<string, typeof legs>();
  for (const leg of legs) groups.set(leg.transfer_group_id, [...(groups.get(leg.transfer_group_id) || []), leg]);
  const payments = [...groups.values()].flatMap((group) => {
    if (group.length !== 2) return [];
    const source = group.find((leg) => leg.amount_cents < 0 && banks.has(leg.account_id));
    const destination = group.find((leg) => leg.amount_cents > 0);
    if (!source || !destination || source.amount_cents !== -destination.amount_cents) return [];
    return [{ id: destination.id, accountId: destination.account_id, amountCents: destination.amount_cents, createdAt: destination.created_at }];
  });
  const snapshots = data.map((row) => ({ id: row.id, accountId: row.account_id, closingDate: row.closing_date,
    remainingAmountCents: row.remaining_amount_cents, createdAt: row.created_at }));
  const remaining = allocateSnapshotPayments(snapshots, payments);
  return NextResponse.json({ statements: data.map((row) => ({
    id: row.id, accountId: row.account_id, closingDate: row.closing_date, dueDate: row.due_date,
    originalAmountCents: row.original_amount_cents, remainingAmountCents: remaining[row.id]
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
