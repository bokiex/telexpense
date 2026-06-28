# Telexpense Bot

Telegram bot and Mini App for capturing transactions, tracking budgets, and viewing spending dashboards.

The deployable version is a single Next.js app:

- `/` serves the Telegram Mini App dashboard.
- `/api/telegram/webhook` receives Telegram bot updates.
- `/api/summary` returns dashboard data after validating `Telegram.WebApp.initData`.
- `/api/transactions/history` returns cursor-paginated transaction history.
- `/api/jobs/recurring` materializes recurring transactions from a Vercel cron.
- Supabase Postgres stores users, transactions, and budgets.

## Can One Vercel Project Host Both?

Yes. Use one Vercel project for the full Next.js app. Vercel hosts the Mini App frontend as normal pages and the bot server as serverless Route Handlers under `/api`. Telegram only needs two URLs on the same domain:

- Mini App URL: `https://your-app.vercel.app/`
- Webhook URL: `https://your-app.vercel.app/api/telegram/webhook`

This works well because Telegram Mini Apps require HTTPS in production, and Vercel gives every deployment an HTTPS domain.

## Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. For a fresh project, run [supabase/schema.sql](supabase/schema.sql). For an
   existing deployment, apply the versioned files in
   [supabase/migrations](supabase/migrations) in timestamp order and keep the
   migration history recorded.
4. Copy your Project URL, publishable key, and server-side secret key.

Server-side routes use `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`. Do not expose this key in frontend code.

## Environment Variables

Copy `.env.example` to `.env.local` for local development:

```bash
cp .env.example .env.local
```

Required values:

```bash
TELEGRAM_BOT_TOKEN=123456:replace-me
APP_BASE_URL=https://your-app.vercel.app
BUDGET_WARNING_RATIO=0.8
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
SUPABASE_SECRET_KEY=sb_secret_replace_me
CRON_SECRET=replace-with-a-long-random-secret
```

`CRON_SECRET` protects `/api/jobs/recurring`. Vercel sends it as
`Authorization: Bearer $CRON_SECRET` when invoking the daily schedule in
`vercel.json`.

## Run Locally

```bash
npm ci
npm run dev
```

The local Mini App runs at `http://localhost:3000`, but Telegram production Mini Apps need HTTPS. Use your Vercel deployment URL, or a tunnel during development.

## Telegram Setup

Create your bot with BotFather, then set the webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$APP_BASE_URL/api/telegram/webhook"
```

Configure the Mini App or menu button in BotFather to point to:

```text
$APP_BASE_URL/
```

Check the active webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

`result.url` must be your deployed Vercel webhook URL. If it is empty, Telegram is not sending messages to your app.

Before setting the webhook, confirm the deployment is alive:

```bash
curl "$APP_BASE_URL/api/health"
```

Expected response:

```json
{"ok":true}
```

If the bot receives messages but does not reply, check the Vercel function logs for `/api/telegram/webhook`. The webhook logs Telegram `sendMessage` failures and Supabase errors.

## Message Formats

```text
food, debit card, lunch, $4.20
transport, debit card, train, $2.00
income, salary, debit card, paycheck, $5000
/budget food 300
/budget transport 120 2026-06
```

Default transaction kind is `expense`; otherwise put the kind first, before the
category. Add any other categories and accounts in the Mini App before using
them in bot messages.

Transaction categories and accounts must already exist and be active. Names,
keys, and subcategory names are matched case-insensitively after whitespace
normalization; unknown or ambiguous values are rejected with available choices
instead of silently creating an account.

## Dashboard Behavior

- Summary reads are read-only. The daily recurring job creates due transactions
  idempotently, in bounded batches, for the current UTC month.
- Transaction history uses a stable `(occurredOn, id)` cursor. Request
  `/api/transactions/history?limit=50`; pass the returned
  `nextCursor.beforeDate` and `nextCursor.beforeId` on the next request. Limits
  are clamped to 1–100 and requests require `X-Telegram-Init-Data`.
- Account balances are opening balance plus all account transactions. Assets
  are positive; loan and card liabilities are stored as negative values, while
  debt-only fields display their absolute amount.
- Net worth is grouped by currency and uses the latest portfolio valuation for
  investment accounts when one is available.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The previous Python/FastAPI prototype remains in `app/*.py` for reference, but the Vercel deployment path is the Next.js implementation.
