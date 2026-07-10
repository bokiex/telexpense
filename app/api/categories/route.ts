import { NextRequest, NextResponse } from "next/server";
import { addSubcategory, deleteCategoryBudgets, deleteCategoryMetadata, upsertCategory } from "@/lib/repository";
import { requireEnv } from "@/lib/env";
import { validateTelegramInitData } from "@/lib/telegram";
import type { BudgetGroup } from "@/lib/repository";

export const runtime = "nodejs";

const groups = new Set(["Needs", "Wants", "Savings"]);

export async function POST(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const body = await request.json();
    const action = String(body.action || "upsert-category");
    const sourceKey = String(body.sourceKey || "").trim();
    const sourceName = String(body.sourceName || "").trim();
    const name = String(body.name || "").trim();
    const group = String(body.group || "").trim();
    const color = String(body.color || "").trim();
    const icon = String(body.icon || "").trim();

    if (!sourceKey) return NextResponse.json({ error: "Category source key is required." }, { status: 400 });
    if (!sourceName) return NextResponse.json({ error: "Category source name is required." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Category name is required." }, { status: 400 });
    if (!groups.has(group)) return NextResponse.json({ error: "Budget group is not valid." }, { status: 400 });
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return NextResponse.json({ error: "Color must be a hex value." }, { status: 400 });
    if (!icon) return NextResponse.json({ error: "Icon is required." }, { status: 400 });

    if (action === "add-subcategory") {
      const subcategoryName = String(body.subcategoryName || "").trim();
      if (!subcategoryName) return NextResponse.json({ error: "Sub-category name is required." }, { status: 400 });
      const id = await addSubcategory(userId, {
        sourceKey,
        sourceName,
        categoryName: name,
        group: group as BudgetGroup,
        color,
        icon,
        name: subcategoryName
      });
      return NextResponse.json({ ok: true, id });
    }

    const id = await upsertCategory(userId, {
      sourceKey,
      sourceName,
      name,
      group: group as BudgetGroup,
      color,
      icon
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const sourceKey = String(request.nextUrl.searchParams.get("sourceKey") || "").trim();
    const sourceName = String(request.nextUrl.searchParams.get("sourceName") || "").trim();
    const month = String(request.nextUrl.searchParams.get("month") || "").trim();

    if (!sourceKey) return NextResponse.json({ error: "Category source key is required." }, { status: 400 });
    if (!sourceName) return NextResponse.json({ error: "Category source name is required." }, { status: 400 });

    await deleteCategoryMetadata(userId, sourceKey, sourceName);
    if (/^\d{4}-\d{2}$/.test(month)) {
      await deleteCategoryBudgets(userId, sourceName, month);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}

function authenticatedUserId(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
  return user.id;
}
