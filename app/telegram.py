from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import hashlib
import hmac
import json
from urllib.parse import parse_qsl

import httpx

from app.budget import category_budget_status, warning_text
from app.db import Database
from app.parser import parse_transaction_message


def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400) -> dict:
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ValueError("Missing Telegram hash")

    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, received_hash):
        raise ValueError("Invalid Telegram init data")

    auth_date = int(pairs.get("auth_date", "0"))
    if datetime.utcnow().timestamp() - auth_date > max_age_seconds:
        raise ValueError("Telegram init data is expired")

    if "user" in pairs:
        pairs["user"] = json.loads(pairs["user"])
    return pairs


async def send_message(bot_token: str, chat_id: int, text: str, reply_markup: dict | None = None) -> None:
    if not bot_token:
        return
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json=payload)


async def handle_text_message(
    db: Database,
    bot_token: str,
    app_base_url: str,
    warning_ratio: float,
    message: dict,
) -> str:
    chat_id = int(message["chat"]["id"])
    from_user = message.get("from") or {}
    telegram_user_id = int(from_user["id"])
    text = (message.get("text") or "").strip()

    db.upsert_user(telegram_user_id, from_user.get("first_name"), from_user.get("username"))

    if text.startswith("/start"):
        reply = "Send expenses like: food, debit card, lunch, $4.20"
        await send_message(bot_token, chat_id, reply, _dashboard_keyboard(app_base_url))
        return reply

    if text.startswith("/budget"):
        reply = _handle_budget_command(db, telegram_user_id, text)
        await send_message(bot_token, chat_id, reply, _dashboard_keyboard(app_base_url))
        return reply

    try:
        parsed = parse_transaction_message(text)
    except ValueError as exc:
        reply = f"{exc}\nExample: food, debit card, lunch, $4.20"
        await send_message(bot_token, chat_id, reply, _dashboard_keyboard(app_base_url))
        return reply

    db.add_transaction(
        telegram_user_id=telegram_user_id,
        kind=parsed.kind,
        category=parsed.category,
        account=parsed.account,
        description=parsed.description,
        amount=parsed.amount,
        currency=parsed.currency,
    )
    month = Database.current_month()
    status = category_budget_status(db, telegram_user_id, month, parsed.category)
    warning = warning_text(status, warning_ratio)
    amount = abs(parsed.amount)
    reply = f"Saved {parsed.category}: ${amount:.2f} on {parsed.account}."
    if warning:
        reply = f"{reply}\n{warning}"
    await send_message(bot_token, chat_id, reply, _dashboard_keyboard(app_base_url))
    return reply


def _handle_budget_command(db: Database, telegram_user_id: int, text: str) -> str:
    # /budget food 300 or /budget food $300 2026-06
    parts = text.split()
    if len(parts) < 3:
        return "Use: /budget category amount [YYYY-MM]"
    category = parts[1].lower()
    amount = Decimal(parts[2].replace("$", "").replace(",", ""))
    month = parts[3] if len(parts) >= 4 else Database.current_month()
    db.set_budget(telegram_user_id, category, month, amount)
    return f"Budget set for {category}: ${amount:.2f} in {month}."


def _dashboard_keyboard(app_base_url: str) -> dict:
    return {
        "inline_keyboard": [
            [{"text": "Open dashboard", "web_app": {"url": f"{app_base_url.rstrip('/')}/"}}]
        ]
    }

