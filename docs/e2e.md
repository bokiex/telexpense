# Local browser E2E

`npm run test:e2e` starts a disposable local Supabase stack and the actual Next.js app, runs Playwright headlessly at a mobile viewport, and removes the stack and its database afterwards. It uses the fresh-install `supabase/schema.sql` snapshot in a transaction (not the upgrade migrations, which require an existing older installation), then seeds one synthetic user. Each invocation gets a fresh project and database. Tests create the rest of their data through the UI. The machine's current date is used, so the transaction is entered and checked in the current month.

## Prerequisites

- Node.js and `npm ci`; Docker Engine running locally using a Unix socket, with no `DOCKER_HOST` or `DOCKER_CONTEXT` override.
- `npx playwright install --with-deps chromium` (on CI install OS packages as required by Playwright).
- Network access to Docker registries on the first run and to `https://telegram.org/js/telegram-web-app.js` during the test.
- Ports 54320–54329 and 3107 free. Do not run concurrent instances. Use a worktree without `.env`, `.env.local`, `.env.development` or `.env.development.local`: no real credentials should be used.

For a visible browser use `npm run test:e2e -- --headed`; for step debugging use `npm run test:e2e -- --debug`. The CLI and browser dependency versions are pinned by the lockfile, making the same command usable in CI. No linked or remote Supabase project is used: the script creates a random temporary CLI project, checks its Docker labels and local API URL before applying SQL, and only stops that project. If interrupted by a hard kill, inspect and remove only the named disposable `telexpensee2e…` stack manually. The harness fails rather than resetting an existing database. It does not read configuration from the application Supabase project.

A fresh random test bot token signs a synthetic user's Telegram initialization data. The browser passes it in Telegram's real `tgWebAppData` launch fragment; the real Telegram script, validator, routes, repository and Postgres are exercised. The suite checks expired and malformed data rejection, a classified transaction's create/edit/delete lifecycle, and a grouped transfer between two newly created accounts with both balances and the grouped history entry verified after reload. It is not a Telegram client test. Screenshots, videos, traces and retained Playwright output are disabled because initialization data is a short-lived bearer credential. Do not enable artifacts or publish debug output without checking for credentials. Failure output identifies the journey; inspect interactive execution locally when needed.

## Separate real Telegram smoke test

Using a dedicated test account and non-production data: open the deployed bot's Mini App, verify it launches and authenticates within Telegram, create/edit/delete a transaction, check the result after reopening, and verify bot messages and buttons. Check on the intended mobile clients. This covers genuine Telegram identity, delivery and WebView integration that the synthetic browser suite cannot establish.
