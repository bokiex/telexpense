-- Executed only against the disposable E2E database. The runner substitutes
-- the migration at each marker and wraps this fixture in a rollback.
-- Simulate an older installation with historical rows violating the new checks.
alter table public.budgets drop constraint budgets_month_format_check, drop constraint budgets_nonnegative_amount_check;
alter table public.portfolio_snapshots drop constraint portfolio_snapshots_month_format_check, drop constraint portfolio_snapshots_nonnegative_value_check;
alter table public.recurring_rule_runs drop constraint recurring_rule_runs_month_format_check;
alter table public.recurring_rules drop constraint recurring_rules_positive_amount_check;
alter table public.transactions drop constraint transactions_ungrouped_sign_check;
insert into public.users (telegram_user_id) values (-900001);
insert into public.accounts (telegram_user_id, account_key, name) values (-900001, 'test', 'Test');
insert into public.budgets (telegram_user_id, category, month, amount_cents) values (-900001, 'legacy', '2024-13', -1);
insert into public.portfolio_snapshots (telegram_user_id, account_id, month, portfolio_value_cents)
select -900001, id, '2024-00', -1 from public.accounts where telegram_user_id = -900001 and account_key = 'test';
insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id)
select -900001, 'legacy', 'subscription', 0, id from public.accounts where telegram_user_id = -900001 and account_key = 'test';
insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month)
select -900001, id, 'bad' from public.recurring_rules where telegram_user_id = -900001;
insert into public.transactions (telegram_user_id, kind, category, description, amount_cents)
values (-900001, 'income', 'legacy', 'legacy', -1);

-- MIGRATION --
-- MIGRATION --

create function pg_temp.expect_check(statement text, expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin
    execute statement;
  exception when check_violation then
    get stacked diagnostics actual = constraint_name;
    if actual <> expected then raise exception 'Expected %, got %', expected, actual; end if;
    return;
  end;
  raise exception 'Expected check violation % for %', expected, statement;
end $$;

do $$
begin
  if (select count(*) from public.budgets where telegram_user_id = -900001 and month = '2024-13' and amount_cents = -1) <> 1
    or (select count(*) from public.transactions where telegram_user_id = -900001 and amount_cents = -1) <> 1
    or (select count(*) from public.recurring_rule_runs where telegram_user_id = -900001 and month = 'bad') <> 1
  then raise exception 'Historical rows were changed'; end if;
  if (select count(*) from pg_constraint where conname in ('budgets_month_format_check', 'portfolio_snapshots_month_format_check', 'recurring_rule_runs_month_format_check', 'budgets_nonnegative_amount_check', 'portfolio_snapshots_nonnegative_value_check', 'recurring_rules_positive_amount_check', 'transactions_ungrouped_sign_check') and not convalidated) <> 7
  then raise exception 'Expected seven unvalidated constraints'; end if;
end $$;

-- Rerunning the migration must not reset a constraint validated by an operator.
update public.recurring_rule_runs set month = '2024-01' where telegram_user_id = -900001;
alter table public.recurring_rule_runs validate constraint recurring_rule_runs_month_format_check;
-- MIGRATION --
do $$ begin
  if not (select convalidated from pg_constraint where conrelid = 'public.recurring_rule_runs'::regclass and conname = 'recurring_rule_runs_month_format_check') then
    raise exception 'Rerun removed constraint validation';
  end if;
end $$;

select pg_temp.expect_check($q$insert into public.budgets (telegram_user_id, category, month, amount_cents) values (-900001, 'x', '2024-13', 0)$q$, 'budgets_month_format_check');
select pg_temp.expect_check($q$insert into public.budgets (telegram_user_id, category, month, amount_cents) values (-900001, 'x', '2024-1', 0)$q$, 'budgets_month_format_check');
select pg_temp.expect_check($q$insert into public.budgets (telegram_user_id, category, month, amount_cents) values (-900001, 'x', '2024-01', -1)$q$, 'budgets_nonnegative_amount_check');
select pg_temp.expect_check($q$insert into public.portfolio_snapshots (telegram_user_id, account_id, month, portfolio_value_cents) select -900001, id, '2024-00', 0 from public.accounts where telegram_user_id = -900001$q$, 'portfolio_snapshots_month_format_check');
select pg_temp.expect_check($q$insert into public.portfolio_snapshots (telegram_user_id, account_id, month, portfolio_value_cents) select -900001, id, '2024-01', -1 from public.accounts where telegram_user_id = -900001$q$, 'portfolio_snapshots_nonnegative_value_check');
select pg_temp.expect_check($q$insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month) select -900001, id, '2024-13' from public.recurring_rules where telegram_user_id = -900001$q$, 'recurring_rule_runs_month_format_check');
select pg_temp.expect_check($q$insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id) select -900001, 'x', 'subscription', -1, id from public.accounts where telegram_user_id = -900001$q$, 'recurring_rules_positive_amount_check');
select pg_temp.expect_check($q$update public.budgets set category = 'updated' where telegram_user_id = -900001$q$, 'budgets_month_format_check');
select pg_temp.expect_check($q$insert into public.transactions (telegram_user_id, kind, category, description, amount_cents) values (-900001, 'expense', 'x', 'x', 1)$q$, 'transactions_ungrouped_sign_check');
select pg_temp.expect_check($q$insert into public.transactions (telegram_user_id, kind, category, description, amount_cents) values (-900001, 'income', 'x', 'x', -1)$q$, 'transactions_ungrouped_sign_check');
select pg_temp.expect_check($q$insert into public.transactions (telegram_user_id, kind, category, description, amount_cents) values (-900001, 'investment', 'x', 'x', 1)$q$, 'transactions_ungrouped_sign_check');
select pg_temp.expect_check($q$insert into public.transactions (telegram_user_id, kind, category, description, amount_cents) values (-900001, 'transfer', 'x', 'x', 1)$q$, 'transactions_ungrouped_sign_check');

insert into public.budgets (telegram_user_id, category, month, amount_cents) values (-900001, 'valid', '0000-01', 0), (-900001, 'valid', '2024-12', 1);
insert into public.portfolio_snapshots (telegram_user_id, account_id, month, portfolio_value_cents) select -900001, id, '2024-12', 0 from public.accounts where telegram_user_id = -900001 and account_key = 'test';
insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id) select -900001, 'valid', 'subscription', 1, id from public.accounts where telegram_user_id = -900001 and account_key = 'test';
insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month) select -900001, id, '2024-12' from public.recurring_rules where telegram_user_id = -900001 and name = 'valid';
insert into public.transactions (telegram_user_id, kind, category, transfer_group_id, description, amount_cents) values
  (-900001, 'expense', 'x', null, 'x', -1), (-900001, 'income', 'x', null, 'x', 1),
  (-900001, 'investment', 'x', null, 'x', -1), (-900001, 'expense', 'x', null, 'x', 0),
  (-900001, 'expense', null, '00000000-0000-0000-0000-000000000001', 'x', -1),
  (-900001, 'investment', 'x', '00000000-0000-0000-0000-000000000001', 'x', 1),
  (-900001, 'transfer', null, '00000000-0000-0000-0000-000000000002', 'x', -1),
  (-900001, 'transfer', null, '00000000-0000-0000-0000-000000000002', 'x', 1);
