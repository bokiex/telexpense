# Architecture

## Surfaces

- Telegram bot webhook: fast capture and budget feedback at `/api/telegram/webhook`.
- Telegram Mini App: mobile dashboard at `/`.
- Supabase Postgres: master list for expenses, income, investments, transfers, and budgets.
- Vercel: one Next.js project hosting both the Mini App frontend and serverless bot/API routes.
- Vercel cron: invokes `/api/jobs/recurring` daily with `CRON_SECRET`.

## Data Flow

1. User sends a transaction message to the bot.
2. `/api/telegram/webhook` receives Telegram updates.
3. `lib/parser` converts comma-separated text or concise `amount subcategory`
   text into a normalized transaction.
4. Comma-separated input uses `lib/identity` to resolve normalized category and
   account names and aliases to active, user-owned records. Concise input uses
   `lib/transactionCapture` to resolve the subcategory, its parent category,
   and the active account.
5. Unknown or ambiguous concise identities are resolved with inline keyboard
   choices. The 15-minute selection state is stored in
   `pending_transaction_captures`, keyed by a compact callback token and scoped
   to the Telegram user so it survives serverless invocations.
6. `lib/repository` stores the transaction in Supabase as integer cents and
   links canonical category, subcategory, and account IDs.
7. `lib/budget` checks current monthly category spend against parent-category
   budgets.
8. Bot replies with a breadcrumb save confirmation, Edit and Undo actions, and
   an optional warning.
9. Mini App calls `/api/summary` with `X-Telegram-Init-Data`.
10. Backend validates Telegram init data and returns only that user's dashboard
   data. Summary reads do not materialize recurring transactions.

The recurring job calls an idempotent Postgres function in bounded batches for
the current UTC month. A unique rule/month run claim prevents duplicate
materialization across retries or concurrent invocations.

Full transaction history is exposed separately at
`/api/transactions/history`, scoped to the requested month and ordered by date
and ID with a two-part cursor. Summary and history payloads retain
`subcategoryId`, which the dashboard uses for editing and category/subcategory
breadcrumbs. Grouped transfer rows have a null category and expose their shared
`transferGroupId`, `transferFromAccountId`, and `transferToAccountId`. The
dashboard creates them through `POST /api/transfers` and edits both legs
through `PATCH /api/transfers/{transferGroupId}`. Deletion uses the same grouped
endpoint and a user-scoped Postgres function so either both legs are removed or
neither is; generic transaction create, edit, and delete routes reject
transfers. Expense and income transactions still require a category. Summary
responses include a `Server-Timing` duration for the summary operation.

Monthly budgets are managed through `POST /api/budgets` and
`DELETE /api/budgets`, with an optional `subcategoryId` for child-subcategory
targets. Needs, Wants, and Savings theme targets are stored as synthetic
category budget rows prefixed with `__budget_group__:` and no `subcategoryId`.
Summary responses include category spend, subcategory spend, and budgets with
nullable `subcategoryId`. The dashboard groups ordinary rows under their parent
categories and keeps synthetic theme rows out of the category list.
Parent-category budgets override child budgets; when no parent budget exists,
child budgets roll up to the effective category total. The dashboard's monthly
total counts a theme budget for a group when one exists, otherwise it uses that
group's effective category total. Summary budget health keeps ordinary spend
separate from Savings allocation: `ordinarySpentCents` covers non-transfer
expense activity outside Savings, `savingsAllocatedCents` covers investment
transactions and expenses in Savings categories, and `progressCents` plus
`progressByGroup` drive budget remaining, budget-used percentage, daily safe
amount, and the dashboard donut. Daily spend and projected spend remain based
on ordinary spend only.

Category management is integrated into the Budget tab rather than a separate
Mini App section. The same budget rows expose add, edit, delete, and
subcategory actions, while the bottom navigation keeps only Home, History,
Accounts, and Budget. Its centered plus button opens the action for the current
section: add transaction on Home or History, add account on Accounts, and add
category on Budget.

Mutation routes validate safe integer cents and financial sign conventions,
uppercase three-letter currencies, real calendar dates, and valid calendar
months. Portfolio snapshots and recurring rules verify that referenced
accounts belong to the authenticated Telegram user; recurring transfer
endpoints also reject identical source and destination accounts. Budget
mutations also verify that a supplied subcategory belongs to the selected
user-owned parent category.

Account balances combine opening balances with all linked transactions. Asset
balances are positive and loan/card liabilities are negative. Dashboard net
worth is grouped by currency and substitutes the latest portfolio valuation for
an investment account's transaction-derived balance when available. Transfer
legs are excluded from category spending summaries by their shared transfer
group identity.

The Mini App intentionally formats displayed amounts without currency symbols
or currency controls. Currency codes remain in API payloads, validation, and
stored rows so existing persisted data and non-dashboard integrations stay
compatible.

## Telegram Mini App Notes

Telegram's Mini App docs describe multiple launch paths, including main app/profile button, inline keyboard button, keyboard button, and menu button. This project supports menu or inline button launch by returning an inline `web_app` button in bot replies. BotFather should also be used to configure the main Mini App or menu button for a one-tap dashboard.

Dashboard mutations and transaction-history pagination use the shared
`PendingButton` and `usePendingAction` primitives. They disable only the
initiating control while its request is pending, preserve its layout, and
expose the state through `aria-busy` and a polite status announcement.

Subcategory names added from the Budget tab preserve the user's typed casing
for display. Matching still normalizes whitespace and case when resolving bot
input or preventing duplicate subcategories.

The Mini App must run on HTTPS outside Telegram's test environment. In
production, never disable `initData` validation because it is the boundary that
maps a dashboard API call to a Telegram user. Validation requires a positive
integer Telegram user ID and rejects authentication timestamps older than 24
hours or in the future.

## Supabase Security

The frontend does not query Supabase directly for private finance data. It calls Next.js API routes with Telegram `initData`; the route validates Telegram's HMAC signature, then uses the server-side Supabase secret/service-role key to query only that Telegram user's rows.

Row Level Security is enabled in [supabase/schema.sql](../supabase/schema.sql), with no anon policies required for this server-mediated flow.

Fresh installations use `supabase/schema.sql`. Existing deployments apply the
timestamped files in `supabase/migrations`; the schema file remains the
re-runnable fresh-install equivalent. Canonicalization migrations abort on
conflicting duplicate financial data or metadata so an operator can reconcile
the rows instead of accepting a lossy merge.
