from dataclasses import dataclass

from app.db import Database


@dataclass(frozen=True)
class BudgetStatus:
    category: str
    spent_cents: int
    budget_cents: int
    ratio: float


def category_budget_status(db: Database, telegram_user_id: int, month: str, category: str) -> BudgetStatus | None:
    budgets = {row["category"]: row for row in db.budgets_for_month(telegram_user_id, month)}
    budget = budgets.get(category.lower())
    if not budget:
        return None

    spend = {row["category"]: row for row in db.monthly_spend_by_category(telegram_user_id, month)}
    spent_cents = int(spend.get(category.lower(), {"spent_cents": 0})["spent_cents"])
    budget_cents = int(budget["amount_cents"])
    return BudgetStatus(
        category=category.lower(),
        spent_cents=spent_cents,
        budget_cents=budget_cents,
        ratio=spent_cents / budget_cents if budget_cents else 0,
    )


def warning_text(status: BudgetStatus | None, threshold: float) -> str | None:
    if not status or status.ratio < threshold:
        return None

    spent = status.spent_cents / 100
    budget = status.budget_cents / 100
    pct = round(status.ratio * 100)
    if status.ratio >= 1:
        return f"Budget exceeded for {status.category}: ${spent:.2f} of ${budget:.2f} ({pct}%)."
    return f"Budget warning for {status.category}: ${spent:.2f} of ${budget:.2f} ({pct}%)."

