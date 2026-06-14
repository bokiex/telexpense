from decimal import Decimal

from app.budget import category_budget_status, warning_text
from app.db import Database


def test_budget_warning_after_threshold(tmp_path) -> None:
    db = Database(str(tmp_path / "test.sqlite3"))
    user_id = 123
    month = "2026-06"
    db.upsert_user(user_id, "Ada", "ada")
    db.set_budget(user_id, "food", month, Decimal("100"))
    db.add_transaction(user_id, "expense", "food", "debit card", "lunch", Decimal("-85"), "USD")

    status = category_budget_status(db, user_id, month, "food")

    assert status is not None
    assert status.ratio == 0.85
    assert warning_text(status, 0.8) == "Budget warning for food: $85.00 of $100.00 (85%)."

