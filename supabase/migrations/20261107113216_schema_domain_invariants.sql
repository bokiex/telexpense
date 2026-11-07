-- NOT VALID preserves historical rows without silently rewriting financial data.
-- PostgreSQL still checks every new or updated row. Audit and repair legacy rows
-- before separately validating these constraints. Do not drop/recreate them on
-- reruns: that would discard any validation performed by an operator.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass and conname = 'budgets_month_format_check') then
    alter table public.budgets add constraint budgets_month_format_check
      check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.portfolio_snapshots'::regclass and conname = 'portfolio_snapshots_month_format_check') then
    alter table public.portfolio_snapshots add constraint portfolio_snapshots_month_format_check
      check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.recurring_rule_runs'::regclass and conname = 'recurring_rule_runs_month_format_check') then
    alter table public.recurring_rule_runs add constraint recurring_rule_runs_month_format_check
      check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass and conname = 'budgets_nonnegative_amount_check') then
    alter table public.budgets add constraint budgets_nonnegative_amount_check
      check (amount_cents >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.portfolio_snapshots'::regclass and conname = 'portfolio_snapshots_nonnegative_value_check') then
    alter table public.portfolio_snapshots add constraint portfolio_snapshots_nonnegative_value_check
      check (portfolio_value_cents >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.recurring_rules'::regclass and conname = 'recurring_rules_positive_amount_check') then
    alter table public.recurring_rules add constraint recurring_rules_positive_amount_check
      check (amount_cents > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transactions'::regclass and conname = 'transactions_ungrouped_sign_check') then
    -- Bot parsing currently permits zero. Grouped legs can have different kinds
    -- and either sign (including positive investment destination legs).
    alter table public.transactions add constraint transactions_ungrouped_sign_check
      check (transfer_group_id is not null or
        (kind = 'expense' and amount_cents <= 0) or
        (kind = 'income' and amount_cents >= 0) or
        (kind = 'investment' and amount_cents <= 0)) not valid;
  end if;
end $$;
