from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re


MONEY_RE = re.compile(r"(?P<sign>-)?(?:[$€£]\s*)?(?P<amount>\d+(?:,\d{3})*(?:\.\d{1,2})?|\d+)(?:\s*(?P<currency>[A-Za-z]{3}))?")
KIND_WORDS = {"expense", "income", "investment", "transfer"}
ACCOUNT_HINTS = {"cash", "debit card", "credit card", "bank", "checking", "savings", "brokerage"}


@dataclass(frozen=True)
class ParsedTransaction:
    category: str
    account: str
    description: str
    amount: Decimal
    currency: str = "USD"
    kind: str = "expense"


def parse_transaction_message(text: str) -> ParsedTransaction:
    parts = [part.strip() for part in text.split(",") if part.strip()]
    if len(parts) < 3:
        raise ValueError("Use: category, account, description, $amount")

    amount_part = parts[-1]
    amount, currency = _parse_money(amount_part)
    body = parts[:-1]

    kind = "expense"
    if body[0].lower() in KIND_WORDS:
        kind = body.pop(0).lower()

    if len(body) < 2:
        raise ValueError("Use: category, account, description, $amount")

    category = body[0].lower()
    account = body[1].lower()
    description = ", ".join(body[2:]).strip() or category

    if kind == "income":
        amount = abs(amount)
    elif kind in {"expense", "investment"}:
        amount = -abs(amount)

    return ParsedTransaction(
        category=category,
        account=account,
        description=description,
        amount=amount,
        currency=currency,
        kind=kind,
    )


def _parse_money(text: str) -> tuple[Decimal, str]:
    match = MONEY_RE.search(text.strip())
    if not match:
        raise ValueError("Could not find an amount like $4.20")

    try:
        amount = Decimal(match.group("amount").replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError("Amount is not valid") from exc

    if match.group("sign"):
        amount = -amount
    return amount.quantize(Decimal("0.01")), (match.group("currency") or "USD").upper()

