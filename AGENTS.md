# Telexpense agent guide

## What is deployed

This repository contains two implementations. The active product is the Next.js
15/React 19 application deployed as one Vercel project:

- `app/page.tsx` renders the Telegram Mini App dashboard through
  `components/Dashboard.tsx`.
- `app/api/telegram/webhook/route.ts` is the Telegram bot webhook.
- The other `app/api/**/route.ts` handlers are the dashboard's JSON API.
- `lib/parser.ts` and `lib/budget.ts` contain domain rules; `lib/repository.ts`
  owns Supabase access and summary calculations.
- `supabase/schema.sql` is the Postgres schema applied through the Supabase SQL
  editor. It includes additive statements for older deployed schemas.

The Python files under `app/*.py`, the `static/` dashboard, and `tests/*.py` are
the previous FastAPI/SQLite prototype. Keep them as reference unless a task
explicitly targets the legacy implementation. They are not part of the Vercel
runtime, and a Python test passing does not validate the TypeScript equivalent.
The legacy webhook path is `/telegram/webhook`; the active path is
`/api/telegram/webhook`.

## Local setup

Use Node.js with the committed `package-lock.json`:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The dashboard is available at `http://localhost:3000`, but a real Telegram Mini
App needs an HTTPS URL (a Vercel deployment or tunnel) and valid Telegram
`initData`.

Only set up Python when working on the reference implementation:

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
```

The Python prototype reads `.env` and `DATABASE_PATH` (default
`./telexpense.sqlite3`); the Next.js application reads `.env.local` and never
uses `DATABASE_PATH`.

## Environment and deployment

Variables expected by the active application:

- `TELEGRAM_BOT_TOKEN`: signs/validates Mini App requests and sends bot API
  calls. Server-only.
- `APP_BASE_URL`: public HTTPS origin used in dashboard buttons and webhook
  setup. `dashboardKeyboard` falls back to `VERCEL_PROJECT_PRODUCTION_URL`.
- `BUDGET_WARNING_RATIO`: optional webhook warning threshold; defaults to
  `0.8`.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL. Despite the public prefix,
  it is currently consumed by server-side repository code.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: documented/project setup value; the
  current dashboard does not query Supabase directly.
- `SUPABASE_SECRET_KEY`: privileged server key. Older projects may instead use
  `SUPABASE_SERVICE_ROLE_KEY`.
- `CRON_SECRET`: bearer secret Vercel uses to authorize the recurring
  materialization job.

Never expose either Supabase privileged key in client components or responses.
After applying `supabase/schema.sql` and deploying, point BotFather's Mini App
at `$APP_BASE_URL/` and Telegram's webhook at
`$APP_BASE_URL/api/telegram/webhook`. `/api/health` is the deployment smoke
check.

## Data and API conventions

- Monetary values are integer cents throughout the TypeScript API and
  database. Expenses and ordinary investment transactions are negative;
  income is positive. Investment-transfer destination rows may be positive.
  Transfers write two rows sharing `transfer_group_id`.
- User isolation is by `telegram_user_id`. Every dashboard API must validate
  the `X-Telegram-Init-Data` header with `validateTelegramInitData`, then scope
  every repository query/mutation to the resulting user ID.
- The browser calls the Next.js API only. Server routes use the Supabase admin
  client; RLS is enabled with no anonymous policies because the privileged key
  bypasses RLS. Correct repository scoping is therefore a security boundary.
- Normalize categories/account keys to lowercase, currencies to uppercase
  three-letter codes, dates to `YYYY-MM-DD`, and months to `YYYY-MM`.
- Preserve the `@/` import alias, strict TypeScript, and `runtime = "nodejs"` on
  handlers that use Node APIs such as `crypto`.
- `lib/repository.ts` contains compatibility retries for partially upgraded
  Supabase schemas. Do not remove them without confirming all deployed
  databases have the new account columns.
- Keep `supabase/schema.sql` safe to re-run when evolving the schema, and update
  repository types/queries and dashboard API payloads together.
- Evolve deployed data with versioned files created by `supabase migration new`;
  keep `schema.sql` aligned for fresh installs. Summary GET handlers must remain
  read-only: recurring materialization belongs in an explicit write/job path.
- Account balance signs are invariant: assets are positive, loan/card
  liabilities are negative, and debt-only UI converts liabilities to absolute
  positive display values.

## Security sharp edges

- Telegram Mini App `initData` is accepted for at most 24 hours and is the
  authentication boundary. Do not add development bypasses or accept a user ID
  from request JSON/query parameters.
- The active webhook currently does not verify Telegram's optional
  `X-Telegram-Bot-Api-Secret-Token`; it is a public endpoint that trusts update
  shape. Do not add privileged webhook actions based only on caller-supplied
  identity. Adding secret-token verification requires coordinating Telegram
  webhook registration and Vercel configuration.
- All API handlers run with the Supabase privileged key. A missing
  `.eq("telegram_user_id", userId)` can expose or mutate another user's
  financial data even though RLS is enabled.
- Do not log bot tokens, Supabase keys, raw `initData`, or financial payloads.
  Keep secret-bearing `.env*` files, SQLite files, `.next/`, and `node_modules/`
  untracked; keep the sanitized `.env.example` template tracked.
- `APP_BASE_URL` controls a Telegram `web_app` link. Production values must be
  the intended HTTPS origin; preview URLs should not silently replace the
  production bot target.

## Validation

For changes to the active application:

```bash
npm test
npm run typecheck
npm run build
```

Run `pytest` as well when touching the Python reference code. `npm run lint`
currently delegates to deprecated `next lint` and opens an interactive setup
prompt because the repository has no ESLint configuration; it is not a usable
non-interactive gate until lint configuration is committed. For
documentation-only changes, review the diff, check Markdown formatting, and
verify the alias is a tracked symlink:

```bash
git diff --check
test -L CLAUDE.md
test "$(readlink CLAUDE.md)" = AGENTS.md
git ls-files -s AGENTS.md CLAUDE.md
```

Keep `CLAUDE.md` as a relative symlink to this file so agent guidance cannot
diverge.
