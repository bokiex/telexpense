from decimal import Decimal

import pytest

from app.parser import parse_transaction_message


def test_parse_default_expense_message() -> None:
    parsed = parse_transaction_message("food, debit card, description, $4.20")

    assert parsed.category == "food"
    assert parsed.account == "debit card"
    assert parsed.description == "description"
    assert parsed.amount == Decimal("-4.20")
    assert parsed.kind == "expense"


def test_parse_investment_message() -> None:
    parsed = parse_transaction_message("investment, brokerage, VOO buy, 200 usd")

    assert parsed.category == "brokerage"
    assert parsed.account == "voo buy"
    assert parsed.amount == Decimal("-200.00")
    assert parsed.kind == "investment"


def test_requires_amount() -> None:
    with pytest.raises(ValueError):
        parse_transaction_message("food, debit card, lunch")

