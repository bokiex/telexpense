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
3. `lib/parser` converts comma-separated text into a normalized transaction.
4. `lib/identity` resolves normalized category/account names and aliases to
   active, user-owned records; unknown or ambiguous identities are rejected.
5. `lib/repository` stores the transaction in Supabase as integer cents and
   links canonical category and account IDs.
6. `lib/budget` checks current monthly category spend against budgets.
7. Bot replies with a save confirmation and optional warning.
8. Mini App calls `/api/summary` with `X-Telegram-Init-Data`.
9. Backend validates Telegram init data and returns only that user's dashboard
   data. Summary reads do not materialize recurring transactions.

The recurring job calls an idempotent Postgres function in bounded batches for
the current UTC month. A unique rule/month run claim prevents duplicate
materialization across retries or concurrent invocations.

Full transaction history is exposed separately at
`/api/transactions/history`, scoped to the requested month and ordered by date
and ID with a two-part cursor. Summary responses include a `Server-Timing`
duration for the summary operation.

Account balances combine opening balances with all linked transactions. Asset
balances are positive and loan/card liabilities are negative. Dashboard net
worth is grouped by currency and substitutes the latest portfolio valuation for
an investment account's transaction-derived balance when available.

## Telegram Mini App Notes

Telegram's Mini App docs describe multiple launch paths, including main app/profile button, inline keyboard button, keyboard button, and menu button. This project supports menu or inline button launch by returning an inline `web_app` button in bot replies. BotFather should also be used to configure the main Mini App or menu button for a one-tap dashboard.

The Mini App must run on HTTPS outside Telegram's test environment. In production, never disable `initData` validation because it is the boundary that maps a dashboard API call to a Telegram user.

## Supabase Security

The frontend does not query Supabase directly for private finance data. It calls Next.js API routes with Telegram `initData`; the route validates Telegram's HMAC signature, then uses the server-side Supabase secret/service-role key to query only that Telegram user's rows.

Row Level Security is enabled in [supabase/schema.sql](../supabase/schema.sql), with no anon policies required for this server-mediated flow.

Fresh installations use `supabase/schema.sql`. Existing deployments apply the
timestamped files in `supabase/migrations`; the schema file remains the
re-runnable fresh-install equivalent. Canonicalization migrations abort on
conflicting duplicate financial data or metadata so an operator can reconcile
the rows instead of accepting a lossy merge.
