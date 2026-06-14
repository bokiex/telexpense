export type ParsedTransaction = {
  kind: "expense" | "income" | "investment" | "transfer";
  category: string;
  account: string;
  description: string;
  amountCents: number;
  currency: string;
};

const kindWords = new Set(["expense", "income", "investment", "transfer"]);
const moneyPattern = /(?<sign>-)?(?:[$€£]\s*)?(?<amount>\d+(?:,\d{3})*(?:\.\d{1,2})?|\d+)(?:\s*(?<currency>[A-Za-z]{3}))?/;

export function parseTransactionMessage(text: string): ParsedTransaction {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) throw new Error("Use: category, account, description, $amount");

  const { amountCents: rawAmountCents, currency } = parseMoney(parts.at(-1) || "");
  const body = parts.slice(0, -1);
  let kind: ParsedTransaction["kind"] = "expense";

  if (kindWords.has(body[0]?.toLowerCase())) {
    kind = body.shift()?.toLowerCase() as ParsedTransaction["kind"];
  }

  if (body.length < 2) throw new Error("Use: category, account, description, $amount");

  let amountCents = rawAmountCents;
  if (kind === "income") amountCents = Math.abs(amountCents);
  if (kind === "expense" || kind === "investment") amountCents = -Math.abs(amountCents);

  return {
    kind,
    category: body[0].toLowerCase(),
    account: body[1].toLowerCase(),
    description: body.slice(2).join(", ").trim() || body[0].toLowerCase(),
    amountCents,
    currency
  };
}

function parseMoney(text: string) {
  const match = moneyPattern.exec(text);
  if (!match?.groups?.amount) throw new Error("Could not find an amount like $4.20");
  const amount = Number(match.groups.amount.replaceAll(",", ""));
  if (!Number.isFinite(amount)) throw new Error("Amount is not valid");

  const signed = match.groups.sign ? -amount : amount;
  return {
    amountCents: Math.round(signed * 100),
    currency: (match.groups.currency || "USD").toUpperCase()
  };
}

