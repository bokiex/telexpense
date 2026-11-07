# Local browser E2E

`npm run test:e2e` starts a disposable local Supabase stack and the actual Next.js app, runs Playwright headlessly at a mobile viewport, and removes the stack and its database afterwards. It applies the fresh-install `supabase/schema.sql` snapshot in a transaction, exercises selected migrations inside rolled-back fixtures, then seeds separate synthetic users for the browser journey and API isolation checks. Each invocation gets a fresh project and database. Tests create the rest of their data through the UI. The machine's current date is used, so the transaction is entered and checked in the current month. The recurring journey uses UTC and schedules day 1, which is due throughout every month, without replacing the application clock or scheduling logic.

## Database fixtures

The E2E command also runs database tests against the verified disposable container, before seeding browser users. After applying `schema.sql` twice, it runs `tests-ts/fixtures/schema-domain-invariants.sql` with its migration substituted inside a transaction that is rolled back. It then runs these fixtures **serially**, stopping on the first failure:

1. `tests-sql/budget-schema-repair.sql` simulates older and partially upgraded budget schemas, checks upserts, ownership and foreign-key repair, and reruns the migration.
2. `tests-sql/owner-scoped-references.sql` checks ownership and parent relationships, deletion behavior, and installation over historical violations, including migration reruns.
3. `tests-sql/card-payment-classification.sql` and `card-payment-classification-backfill.sql` check transfer classification, recurring materialization and upgrade backfill.
4. `tests-sql/card-statement-baselines.sql` and `card-statement-capture-order.sql` check card baselines and the capture-order upgrade.
5. `tests-sql/recurring-legacy-ownership.sql` checks global and scoped materialization in the presence of historical cross-owner account references.
6. `tests-sql/schema-reapply-legacy-violations.sql` checks that reapplying the schema preserves historical constraint violations while enforcing constraints on new changes.
7. `tests-sql/card-statement-concurrency.sh` checks concurrent payment edits and statement captures/rebaselines.
8. `tests-sql/owner-budget-concurrency.sh` checks budget insertion against concurrent category identity changes and deletion.
9. `tests-sql/recurring-materialization-concurrency.sh` checks competing global and user-scoped materialization, locking, batching and isolation levels.

The eight SQL files manage their own `BEGIN`/`ROLLBACK`; the runner expands their relative schema and migration includes before streaming them to `psql -X` with `ON_ERROR_STOP`. The concurrency tests necessarily commit setup and use independent PostgreSQL sessions; each cleans up its synthetic users, and the entire database is removed even on failure. They must not run in parallel or against a shared, real, or non-disposable database. Rollbacks do not rewind sequences, but these synthetic IDs and sequence gaps do not affect the browser assertions. The harness reports the failing fixture name without printing SQL output, which may contain data; debug only on a private disposable instance.

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

A fresh random test bot token signs a synthetic user's Telegram initialization data. The browser passes it in Telegram's real `tgWebAppData` launch fragment; the real Telegram script, validator, routes, repository and Postgres are exercised. The suite checks invalid-signature, malformed and expired authentication rejection, cross-user transaction visibility and mutation isolation through the real API, a classified transaction's create/edit/delete lifecycle across reloads, category budget progress from a classified expense before and after reload, a grouped transfer between two newly created accounts with both balances and the grouped history entry verified after reload, and a monthly rule’s due materialization and idempotency across repeated authenticated summary requests and reloads. It is not a Telegram client test. Screenshots, videos, traces and retained Playwright output are disabled because initialization data is a short-lived bearer credential. Do not enable artifacts or publish debug output without checking for credentials. Failure output identifies the journey; inspect interactive execution locally when needed.

## Separate real Telegram smoke test

Use a dedicated test bot, test Telegram account and isolated non-production database with synthetic financial data. Do not paste initData, tokens, screenshots of credentials, or real financial details into reports. On each intended iOS and Android Telegram client:

- [ ] Open the bot and launch the Mini App using its configured button; verify the intended HTTPS deployment opens and authenticates as the test user.
- [ ] Check layout, scrolling, keyboard and dialogs in the Telegram WebView; close and reopen the Mini App.
- [ ] Create, edit and delete a synthetic transaction; reopen and verify persistence and deletion.
- [ ] Send a supported transaction message to the bot and verify the delivered response and any selection buttons, then confirm the result in the Mini App.
- [ ] Verify the bot's dashboard button opens the intended deployment and any relevant notification is delivered.

This checks real Telegram-issued identity, launch, client/WebView behavior and bot delivery. The synthetic browser suite exercises the real application and validator but proves none of those Telegram boundaries; the manual checklist does not replace automated journeys.
