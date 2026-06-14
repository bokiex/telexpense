from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.db import Database
from app.telegram import handle_text_message, validate_init_data


app = FastAPI(title="Telexpense Bot")
app.mount("/static", StaticFiles(directory="static"), name="static")


def get_db(settings: Settings = Depends(get_settings)) -> Database:
    return Database(settings.database_path)


@app.get("/")
def mini_app() -> FileResponse:
    return FileResponse("static/index.html")


@app.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Database = Depends(get_db),
) -> dict:
    update = await request.json()
    message = update.get("message")
    if not message or "text" not in message:
        return {"ok": True}
    await handle_text_message(
        db=db,
        bot_token=settings.telegram_bot_token,
        app_base_url=settings.app_base_url,
        warning_ratio=settings.budget_warning_ratio,
        message=message,
    )
    return {"ok": True}


@app.get("/api/summary")
def summary(
    month: str | None = None,
    x_telegram_init_data: str = Header(default=""),
    settings: Settings = Depends(get_settings),
    db: Database = Depends(get_db),
) -> dict:
    user_id = _authenticated_user_id(x_telegram_init_data, settings)
    selected_month = month or Database.current_month()
    categories = [
        {
            "category": row["category"],
            "spentCents": row["spent_cents"],
            "currency": row["currency"],
        }
        for row in db.monthly_spend_by_category(user_id, selected_month)
    ]
    budgets = [
        {
            "category": row["category"],
            "budgetCents": row["amount_cents"],
            "currency": row["currency"],
        }
        for row in db.budgets_for_month(user_id, selected_month)
    ]
    daily = [
        {"date": row["occurred_on"], "spentCents": row["spent_cents"]}
        for row in db.daily_totals(user_id, selected_month)
    ]
    recent = [
        {
            "id": row["id"],
            "kind": row["kind"],
            "category": row["category"],
            "account": row["account"],
            "description": row["description"],
            "amountCents": row["amount_cents"],
            "currency": row["currency"],
            "occurredOn": row["occurred_on"],
        }
        for row in db.recent_transactions(user_id)
    ]
    return {
        "month": selected_month,
        "categories": categories,
        "budgets": budgets,
        "daily": daily,
        "recent": recent,
    }


def _authenticated_user_id(init_data: str, settings: Settings) -> int:
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=500, detail="TELEGRAM_BOT_TOKEN is not configured")
    try:
        parsed = validate_init_data(init_data, settings.telegram_bot_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = parsed.get("user") or {}
    if "id" not in user:
        raise HTTPException(status_code=401, detail="Telegram user is missing")
    return int(user["id"])

