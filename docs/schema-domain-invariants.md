# Domain constraint rollout

`20261107113216_schema_domain_invariants.sql` adds `NOT VALID` checks: existing
rows are retained without a table scan or financial data rewrite, but inserts
and **all updates**, including FK-driven updates, must satisfy the checks.
Audit and resolve violations with the data owner before validating them. In
particular, a legacy recurring rule with a non-positive amount can still be
materialized by the existing functions, but cannot be updated until repaired.
This migration does not alter materialization.

The following read-only audit reports counts, not financial payloads. Run it
against the intended database before deployment and plan any repairs separately:

```sql
select 'budgets month' as invariant, count(*) from public.budgets where month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
union all select 'portfolio month', count(*) from public.portfolio_snapshots where month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
union all select 'recurring runs month', count(*) from public.recurring_rule_runs where month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
union all select 'budget amount', count(*) from public.budgets where amount_cents < 0
union all select 'portfolio value', count(*) from public.portfolio_snapshots where portfolio_value_cents < 0
union all select 'recurring amount', count(*) from public.recurring_rules where amount_cents <= 0
union all select 'ungrouped transaction sign/kind', count(*) from public.transactions
  where transfer_group_id is null and not (
    (kind = 'expense' and amount_cents <= 0) or (kind = 'income' and amount_cents >= 0)
    or (kind = 'investment' and amount_cents <= 0));
```

Once each count is zero, validate the corresponding constraint during a
suitable maintenance window; validation scans the table and takes a lock.

```sql
alter table public.budgets validate constraint budgets_month_format_check;
alter table public.portfolio_snapshots validate constraint portfolio_snapshots_month_format_check;
alter table public.recurring_rule_runs validate constraint recurring_rule_runs_month_format_check;
alter table public.budgets validate constraint budgets_nonnegative_amount_check;
alter table public.portfolio_snapshots validate constraint portfolio_snapshots_nonnegative_value_check;
alter table public.recurring_rules validate constraint recurring_rules_positive_amount_check;
alter table public.transactions validate constraint transactions_ungrouped_sign_check;
```

The month pattern intentionally matches the current application validator,
including `0000`; PostgreSQL date casts used by recurring materialization do
not support year zero. Align the application and date handling before tightening
that boundary. Zero-valued ordinary transactions remain allowed because the
Telegram parsers currently accept them. Grouped transactions allow either sign
and kind because transfers and recurring investment/loan transfers have
multiple representations. The checks do not establish two balanced legs or
protect against zero-valued grouped legs; those are cross-row and legacy-data
concerns, not safe row checks here. Account deletion can leave transfer account
references null, so no new non-null account check is imposed.

The SQL regression fixture runs in a rolled-back transaction on the disposable
local database created by `npm run test:e2e`; the ordinary `npm test` checks
schema/migration alignment but does not execute PostgreSQL.
