from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
import sqlite3
from typing import Iterator


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_user_id INTEGER PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id),
  kind TEXT NOT NULL CHECK(kind IN ('expense', 'income', 'investment', 'transfer')),
  category TEXT NOT NULL,
  account TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id),
  category TEXT NOT NULL,
  month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  UNIQUE(telegram_user_id, category, month)
);
"""


class Database:
    def __init__(self, path: str) -> None:
        self.path = path
        self.init()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init(self) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.executescript(SCHEMA)

    def upsert_user(self, telegram_user_id: int, first_name: str | None, username: str | None) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO users (telegram_user_id, first_name, username)
                VALUES (?, ?, ?)
                ON CONFLICT(telegram_user_id) DO UPDATE SET
                  first_name = excluded.first_name,
                  username = excluded.username
                """,
                (telegram_user_id, first_name, username),
            )

    def add_transaction(
        self,
        telegram_user_id: int,
        kind: str,
        category: str,
        account: str,
        description: str,
        amount: Decimal,
        currency: str,
        occurred_on: date | None = None,
    ) -> int:
        cents = int((amount * 100).to_integral_value())
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO transactions
                  (telegram_user_id, kind, category, account, description, amount_cents, currency, occurred_on)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    telegram_user_id,
                    kind,
                    category,
                    account,
                    description,
                    cents,
                    currency,
                    (occurred_on or date.today()).isoformat(),
                ),
            )
            return int(cursor.lastrowid)

    def set_budget(self, telegram_user_id: int, category: str, month: str, amount: Decimal, currency: str = "USD") -> None:
        cents = int((amount * 100).to_integral_value())
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO budgets (telegram_user_id, category, month, amount_cents, currency)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(telegram_user_id, category, month) DO UPDATE SET
                  amount_cents = excluded.amount_cents,
                  currency = excluded.currency
                """,
                (telegram_user_id, category.lower(), month, cents, currency),
            )

    def monthly_spend_by_category(self, telegram_user_id: int, month: str) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return list(
                conn.execute(
                    """
                    SELECT category, currency, ABS(SUM(amount_cents)) AS spent_cents
                    FROM transactions
                    WHERE telegram_user_id = ?
                      AND kind = 'expense'
                      AND amount_cents < 0
                      AND substr(occurred_on, 1, 7) = ?
                    GROUP BY category, currency
                    ORDER BY spent_cents DESC
                    """,
                    (telegram_user_id, month),
                )
            )

    def budgets_for_month(self, telegram_user_id: int, month: str) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return list(
                conn.execute(
                    "SELECT * FROM budgets WHERE telegram_user_id = ? AND month = ? ORDER BY category",
                    (telegram_user_id, month),
                )
            )

    def recent_transactions(self, telegram_user_id: int, limit: int = 20) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return list(
                conn.execute(
                    """
                    SELECT *
                    FROM transactions
                    WHERE telegram_user_id = ?
                    ORDER BY occurred_on DESC, id DESC
                    LIMIT ?
                    """,
                    (telegram_user_id, limit),
                )
            )

    def daily_totals(self, telegram_user_id: int, month: str) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return list(
                conn.execute(
                    """
                    SELECT occurred_on, ABS(SUM(amount_cents)) AS spent_cents
                    FROM transactions
                    WHERE telegram_user_id = ?
                      AND kind = 'expense'
                      AND substr(occurred_on, 1, 7) = ?
                    GROUP BY occurred_on
                    ORDER BY occurred_on
                    """,
                    (telegram_user_id, month),
                )
            )

    @staticmethod
    def current_month() -> str:
        return datetime.utcnow().strftime("%Y-%m")

