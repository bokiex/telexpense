-- Run with psql -X -v ON_ERROR_STOP=1 against a disposable, migrated database.
-- Simulate pre-constraint rows; installing NOT VALID FKs must not rewrite them.
begin;
insert into public.users (telegram_user_id) values (950001), (950002);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value values
  (950001, 950001, 'bank', 'Bank', 'bank'),
  (950002, 950001, 'cash', 'Cash', 'cash'),
  (950003, 950002, 'bank', 'Bank', 'bank'),
  (950004, 950002, 'cash', 'Cash', 'cash');
alter table public.recurring_rules drop constraint recurring_rules_owner_from_account_fk;
alter table public.recurring_rules drop constraint recurring_rules_owner_to_account_fk;
insert into public.recurring_rules (id, telegram_user_id, name, rule_type, amount_cents, from_account_id, to_account_id, day_of_month)
overriding system value values
  (950001, 950001, 'bad source', 'account_transfer', 100, 950003, 950002, 1),
  (950002, 950001, 'bad destination', 'account_transfer', 100, 950001, 950003, 1),
  (950003, 950001, 'valid same owner', 'account_transfer', 100, 950001, 950002, 1),
  (950004, 950002, 'valid other owner', 'account_transfer', 100, 950003, 950004, 1);
\ir ../supabase/migrations/20261107113754_owner_scoped_references.sql

do $$
declare n bigint; u bigint;
begin
  -- A full batch must mean more work may remain, even with bad rules first.
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions('2024-01', 1);
  if (u, n) <> (1, 1) then raise exception 'global first batch: %, %', u, n; end if;
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions('2024-01', 1);
  if (u, n) <> (1, 1) then raise exception 'global second batch: %, %', u, n; end if;
  select rules_materialized into n from public.materialize_recurring_transactions('2024-01', 1);
  if n <> 0 then raise exception 'global retry: %', n; end if;

  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions_for_user(950001, '2024-02', 1);
  if (u, n) <> (1, 1) then raise exception 'scoped batch: %, %', u, n; end if;
  select rules_materialized into n from public.materialize_recurring_transactions_for_user(950001, '2024-02', 1);
  if n <> 0 then raise exception 'scoped retry: %', n; end if;
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions('2024-02', 1);
  if (u, n) <> (1, 1) then raise exception 'global after scoped: %, %', u, n; end if;

  if (select count(*) from public.recurring_rules where id in (950001, 950002)) <> 2
     or exists (select 1 from public.recurring_rule_runs where recurring_rule_id in (950001, 950002))
     or exists (select 1 from public.transactions where recurring_rule_id in (950001, 950002)) then
    raise exception 'invalid legacy rules were changed or materialized';
  end if;
  if (select count(*) from public.recurring_rule_runs where recurring_rule_id in (950003, 950004) and month in ('2024-01', '2024-02')) <> 4
     or (select count(*) from public.transactions where recurring_rule_id in (950003, 950004) and occurred_on in ('2024-01-01', '2024-02-01')) <> 8 then
    raise exception 'valid rules did not materialize exactly once per month';
  end if;
end $$;
rollback;
