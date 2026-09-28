export type ParsedTransaction = {
  kind: "expense" | "income" | "investment" | "transfer";
  category: string;
  account: string;
  description: string;
  amountCents: number;
};

export type ConciseTransaction = {
  kind: "expense" | "income" | "investment";
  description: string;
  accountHint: string | null;
  amountCents: number;
};

import { normalizeIdentity } from "@/lib/identity";

const kindWords = new Set(["expense", "income", "investment", "transfer"]);
const moneyPattern = /^(?<sign>-)?(?<amount>\d+(?:,\d{3})*(?:\.\d{1,2})?|\d+)$/;

export function parseTransactionMessage(text: string): ParsedTransaction {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) throw new Error("Use: category, account, description, amount");

  const { amountCents: rawAmountCents } = parseMoney(parts.at(-1) || "");
  const body = parts.slice(0, -1);
  let kind: ParsedTransaction["kind"] = "expense";

  if (kindWords.has(body[0]?.toLowerCase())) {
    kind = body.shift()?.toLowerCase() as ParsedTransaction["kind"];
  }

  if (kind === "transfer") {
    throw new Error("Transfers must be created in the dashboard.");
  }

  if (body.length < 2) throw new Error("Use: category, account, description, amount");

  let amountCents = rawAmountCents;
  if (kind === "income") amountCents = Math.abs(amountCents);
  if (kind === "expense" || kind === "investment") amountCents = -Math.abs(amountCents);

  return {
    kind,
    category: normalizeIdentity(body[0]),
    account: normalizeIdentity(body[1]),
    description: body.slice(2).join(", ").trim() || body[0].toLowerCase(),
    amountCents
  };
}

export function parseConciseTransactionMessage(
  text: string,
  kind: ConciseTransaction["kind"] = "expense"
): ConciseTransaction {
  const match = /^\s*(?<money>\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+(?<description>.+?)\s*$/.exec(text);
  if (!match?.groups?.money || !match.groups.description) {
    throw new Error("Use a concise amount and subcategory, such as: 4.20 eat out");
  }
  const { amountCents } = parseMoney(match.groups.money);
  const descriptionWithAccount = match.groups.description.trim();
  const accountMatch = /\s+@(?<account>[^@].*?)\s*$/.exec(descriptionWithAccount);
  const description = accountMatch
    ? descriptionWithAccount.slice(0, accountMatch.index).trim()
    : descriptionWithAccount;
  if (!description) {
    throw new Error("Add a subcategory before the optional @account.");
  }

  return {
    kind,
    description,
    accountHint: accountMatch?.groups?.account.trim() || null,
    amountCents: kind === "income" ? Math.abs(amountCents) : -Math.abs(amountCents)
  };
}

export function parseConciseCommandMessage(text: string): ConciseTransaction | null {
  const match = /^\/(?<command>income|invest)(?:@\w+)?(?:\s+(?<body>.+))?\s*$/i.exec(text);
  if (!match?.groups?.command) return null;

  const kind = match.groups.command.toLowerCase() === "income" ? "income" : "investment";
  return parseConciseTransactionMessage(match.groups.body || "", kind);
}

export function isConciseTransactionMessage(text: string) {
  return /^\s*\d+(?:,\d{3})*(?:\.\d{1,2})?\s+\S/.test(text);
}

function parseMoney(text: string) {
  const match = moneyPattern.exec(text);
  if (!match?.groups?.amount) throw new Error("Could not find an amount like 4.20");
  const amount = Number(match.groups.amount.replaceAll(",", ""));
  if (!Number.isFinite(amount)) throw new Error("Amount is not valid");

  const signed = match.groups.sign ? -amount : amount;
  return {
    amountCents: Math.round(signed * 100)
  };
}
