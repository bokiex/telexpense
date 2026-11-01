# Local browser E2E

`npm run test:e2e` starts a disposable local Supabase stack and the actual Next.js app, runs Playwright headlessly at a mobile viewport, and removes the stack and its database afterwards. It uses the fresh-install `supabase/schema.sql` snapshot in a transaction (not the upgrade migrations, which require an existing older installation), then seeds one synthetic user. Each invocation gets a fresh project and database. Tests create the rest of their data through the UI. The machine's current date is used, so the transaction is entered and checked in the current month.

## Prerequisites

- Node.js and `npm ci`; Docker Engine running locally using a Unix socket, with no `DOCKER_HOST` or `DOCKER_CONTEXT` override.
- `npx playwright install --with-deps chromium` (on CI install OS packages as required by Playwright).
- Network access to Docker registries on the first run and to `https://telegram.org/js/telegram-web-app.js` during the test.
- Ports 54320–54329 and 3107 free. Do not run concurrent instances. Use a worktree without `.env`, `.env.local`, `.env.development` or `.env.development.local`: no real credentials should be used.

For a visible browser use `npm run test:e2e -- --headed`; for step debugging use `npm run test:e2e -- --debug`. Use a private machine and synthetic data only. The CLI and browser dependency versions are pinned by the lockfile. No linked or remote Supabase project is used: the script creates a random temporary CLI project, checks its Docker labels and local API URL before applying SQL, and only stops that project. If interrupted by a hard kill, inspect and remove only the named disposable `telexpensee2e…` stack manually. The harness fails rather than resetting an existing database. It does not read configuration from the application Supabase project.

## CI and validation

`.github/workflows/ci.yml` runs the existing gates and a separate browser job on an Ubuntu runner with local Docker. Its equivalent commands in a clean checkout are:

```sh
npm ci
npm test
npm run typecheck
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

The browser job needs a working local Docker daemon, sufficient space for Supabase images, free ports and network access as above. It requires no GitHub secrets or production environment variables. Shared machines must serialize E2E runs (for example `flock /tmp/telexpense-e2e.lock npm run test:e2e`). CI must not upload Playwright output, browser state, screenshots, traces, videos, server logs or database dumps. The safe reporter prints the journey name and source location, not assertion errors or request details; setup failures report a limited message. For diagnosis, reproduce locally with the headed/debug commands and inspect the indicated journey. Treat terminal output, browser developer tools, URLs and any manually captured material as potentially containing bearer credentials; never publish them without careful review. Do not override the reporter or enable artifacts in CI. Timeouts or a hard-killed runner can prevent cleanup; on a persistent runner inspect the named disposable stack before removing it.

A fresh random test bot token signs a synthetic user's Telegram initialization data. The browser passes it in Telegram's real `tgWebAppData` launch fragment; the real Telegram script, validator, routes, repository and Postgres are exercised. The suite checks expired and malformed data rejection and a classified transaction's create/edit/delete lifecycle across reloads. It is not a Telegram client test. Screenshots, videos, traces and retained Playwright output are disabled because initialization data is a short-lived bearer credential. Do not enable artifacts or publish debug output without checking for credentials. Failure output identifies the journey; inspect interactive execution locally when needed.

## Separate real Telegram smoke test

Use a dedicated test bot, test Telegram account and isolated non-production database with synthetic financial data. Do not paste initData, tokens, screenshots of credentials, or real financial details into reports. On each intended iOS and Android Telegram client:

- [ ] Open the bot and launch the Mini App using its configured button; verify the intended HTTPS deployment opens and authenticates as the test user.
- [ ] Check layout, scrolling, keyboard and dialogs in the Telegram WebView; close and reopen the Mini App.
- [ ] Create, edit and delete a synthetic transaction; reopen and verify persistence and deletion.
- [ ] Send a supported transaction message to the bot and verify the delivered response and any selection buttons, then confirm the result in the Mini App.
- [ ] Verify the bot's dashboard button opens the intended deployment and any relevant notification is delivered.

This checks real Telegram-issued identity, launch, client/WebView behavior and bot delivery. The synthetic browser suite exercises the real application and validator but proves none of those Telegram boundaries; the manual checklist does not replace automated journeys.
