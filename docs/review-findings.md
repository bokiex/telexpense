# Review findings

Status: open

This tracker records the full-repository review completed on 2026-09-17. Findings
cover the deployed Next.js application, not the legacy Python prototype.

| ID | Priority | Status | Finding |
| --- | --- | --- | --- |
| 1 | Critical | In progress | Authenticate Telegram webhook requests with Telegram's secret-token header. |
| 2 | High | In progress | Reject ungrouped `transfer` messages received through the bot parser flow. |
| 3 | High | In progress | Keep recurring subscriptions out of transfer groups, and repair existing affected rows. |
| 4 | High | Open | Exclude grouped investment-transfer destination legs from Savings allocation. |
| 5 | High | Open | Enforce account and transaction currency consistency, and reject cross-currency transfers. |
| 6 | Medium | Open | Render a grouped transfer as one history entry and keep pagination coherent. |
| 7 | Medium | Open | Display credit-card debt as a positive debt amount, like loan debt. |
| 8 | Medium | Open | Make budget creation safe under concurrent first saves. |
| 9 | Medium | Open | Exclude grouped transfer legs from Telegram budget-warning totals. |
| 10 | Medium | Open | Give bottom sheets correct modal-dialog semantics and focus behavior. |

## Finding details

### 1. Authenticate Telegram webhook requests

`app/api/telegram/webhook/route.ts` accepts arbitrary JSON and trusts user IDs in
the body. A forged callback can act as another Telegram user and delete that
user's transaction. Register the webhook with a Telegram secret token, store the
same value server-side, and reject missing or mismatched
`X-Telegram-Bot-Api-Secret-Token` headers before reading the body.

### 2. Reject ungrouped bot transfers

`parseTransactionMessage` accepts `transfer`, but the webhook writes its result
through ordinary transaction persistence. This creates a single transaction with
no matching leg. Reject this input until the bot has an explicit grouped-transfer
interaction.

### 3. Keep subscriptions out of transfer groups

`materialize_recurring_transactions` assigns a transfer group to subscriptions,
despite inserting only one subscription row. The dashboard identifies that row as
a transfer, and grouped deletion rejects it because it has no second leg.
Assign a group only to two-leg recurring rules. Add a versioned migration to clear
the group from already materialized subscription rows.

## Review evidence

The review inspected route handlers, `lib/repository.ts`, Supabase schema and
migrations, Dashboard interactions, and domain tests. The local test command was
not runnable because dependencies were not installed and `tsx` was unavailable.
