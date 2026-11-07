import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  let userId: number;
  try {
    userId = validateTelegramInitData(request.headers.get("x-telegram-init-data") || "", requireEnv("TELEGRAM_BOT_TOKEN")).user.id;
  } catch {
    return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
  }
  const raw = request.nextUrl.searchParams.get("id") || "";
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid subcategory." }, { status: 400 });
  }
  const { data, error } = await createSupabaseAdmin().rpc("delete_unused_subcategory", {
    p_user_id: userId, p_subcategory_id: id
  });
  if (error) return NextResponse.json({ error: "Could not delete subcategory." }, { status: 500 });
  if (data === "not_found") return NextResponse.json({ error: "Subcategory not found." }, { status: 404 });
  if (data === "in_use") return NextResponse.json({ error: "This subcategory is in use by transactions, recurring rules, budgets, or pending selections. Remove those references first." }, { status: 409 });
  if (data !== "deleted") return NextResponse.json({ error: "Could not delete subcategory." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
