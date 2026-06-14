# Telexpense Bot

Telegram bot and Mini App for capturing transactions, tracking budgets, and viewing spending dashboards.

The deployable version is a single Next.js app:

- `/` serves the Telegram Mini App dashboard.
- `/api/telegram/webhook` receives Telegram bot updates.
- `/api/summary` returns dashboard data after validating `Telegram.WebApp.initData`.
- Supabase Postgres stores users, transactions, and budgets.

## Can One Vercel Project Host Both?

Yes. Use one Vercel project for the full Next.js app. Vercel hosts the Mini App frontend as normal pages and the bot server as serverless Route Handlers under `/api`. Telegram only needs two URLs on the same domain:

- Mini App URL: `https://your-app.vercel.app/`
- Webhook URL: `https://your-app.vercel.app/api/telegram/webhook`

This works well because Telegram Mini Apps require HTTPS in production, and Vercel gives every deployment an HTTPS domain.

## Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run [supabase/schema.sql](supabase/schema.sql).
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
```

## Run Locally

```bash
npm install
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

## Message Formats

```text
food, debit card, lunch, $4.20
investment, brokerage, VOO buy, $200
income, bank, salary, $5000
/budget food 300
/budget transport 120 2026-06
```

Default transaction kind is `expense`.

## Verification

```bash
npm run typecheck
npm run build
```

The previous Python/FastAPI prototype remains in `app/*.py` for reference, but the Vercel deployment path is the Next.js implementation.
