-- Run only against a disposable database with schema.sql already applied:
-- psql -X -v ON_ERROR_STOP=1 -f tests-sql/schema-reapply-legacy-violations.sql
-- All fixtures and schema changes are rolled back (sequence increments are not).
begin;
insert into public.users (telegram_user_id) values (950001), (950002);

-- Recreate pre-constraint data, then install the actual NOT VALID migrations.
alter table public.transactions drop constraint transactions_ungrouped_sign_check;
alter table public.transactions drop constraint transactions_owner_account_fk;
alter table public.transactions drop constraint transactions_subcategory_requires_category_check;
alter table public.budgets drop constraint budgets_month_format_check;
alter table public.budgets drop constraint budgets_nonnegative_amount_check;
alter table public.portfolio_snapshots drop constraint portfolio_snapshots_nonnegative_value_check;
alter table public.portfolio_snapshots drop constraint portfolio_snapshots_month_format_check;
alter table public.recurring_rules drop constraint recurring_rules_positive_amount_check;
alter table public.recurring_rule_runs drop constraint recurring_rule_runs_month_format_check;

insert into public.subcategories (telegram_user_id, category_id, name)
select 950001, id, 'Legacy Child' from public.categories where telegram_user_id = 950001 and source_key = 'food';
insert into public.transactions (telegram_user_id, kind, category, category_id, subcategory_id, account_id, description, amount_cents)
select 950001, 'expense', ' Food ', null, s.id, a.id, 'legacy invalid', 42
from public.subcategories s cross join public.accounts a
where s.telegram_user_id = 950001 and a.telegram_user_id = 950002 limit 1;
-- An old grouped leg without captured account type used to trigger backfill.
alter table public.transactions disable trigger capture_transfer_account_type;
insert into public.transactions (telegram_user_id, kind, category, subcategory_id, account_id, transfer_group_id, description, amount_cents)
select 950001, 'expense', ' Food ', s.id, a.id, '00000000-0000-0000-0000-000000095001', 'legacy grouped', -1
from public.subcategories s cross join public.accounts a
where s.telegram_user_id = 950001 and a.telegram_user_id = 950001 limit 1;
alter table public.transactions enable trigger capture_transfer_account_type;
insert into public.budgets (telegram_user_id, category, month, amount_cents)
values (950001, ' Food ', 'bad-month', -5);
insert into public.portfolio_snapshots (telegram_user_id, account_id, month, portfolio_value_cents)
select 950001, id, 'bad-month', -9 from public.accounts where telegram_user_id = 950001 limit 1;
insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, category, from_account_id)
select 950001, 'legacy invalid', 'subscription', 0, ' Food ', id from public.accounts where telegram_user_id = 950001 limit 1;
insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month)
select 950001, id, 'bad-month' from public.recurring_rules where telegram_user_id = 950001 and name = 'legacy invalid';

-- INSERT ... SELECT must not silently turn this into a vacuous reapply test if
-- user seed identities change or a prerequisite is missing.
do $$
begin
  if (select count(*) from public.subcategories where telegram_user_id = 950001 and name = 'Legacy Child') <> 1
     or (select count(*) from public.transactions where telegram_user_id = 950001 and description in ('legacy invalid', 'legacy grouped')) <> 2
     or (select count(*) from public.budgets where telegram_user_id = 950001 and month = 'bad-month') <> 1
     or (select count(*) from public.portfolio_snapshots where telegram_user_id = 950001 and month = 'bad-month') <> 1
     or (select count(*) from public.recurring_rules where telegram_user_id = 950001 and name = 'legacy invalid') <> 1
     or (select count(*) from public.recurring_rule_runs where telegram_user_id = 950001 and month = 'bad-month') <> 1 then
    raise exception 'legacy fixture setup incomplete';
  end if;
end $$;
\ir ../supabase/migrations/20261107113216_schema_domain_invariants.sql
\ir ../supabase/migrations/20261107113754_owner_scoped_references.sql

-- Capture full rows, including identity, timestamps, and noncanonical text.
create temporary table legacy_rows_before on commit drop as
select 'transactions' as tbl, to_jsonb(t) as row_data from public.transactions t where telegram_user_id = 950001
union all select 'accounts', to_jsonb(a) from public.accounts a where telegram_user_id = 950001
union all select 'categories', to_jsonb(c) from public.categories c where telegram_user_id = 950001
union all select 'subcategories', to_jsonb(s) from public.subcategories s where telegram_user_id = 950001
union all select 'budgets', to_jsonb(b) from public.budgets b where telegram_user_id = 950001
union all select 'portfolio_snapshots', to_jsonb(p) from public.portfolio_snapshots p where telegram_user_id = 950001
union all select 'recurring_rules', to_jsonb(r) from public.recurring_rules r where telegram_user_id = 950001
union all select 'recurring_rule_runs', to_jsonb(r) from public.recurring_rule_runs r where telegram_user_id = 950001;

\ir ../supabase/schema.sql

do $$
begin
  if exists (
    (select * from legacy_rows_before except all
      (select 'transactions', to_jsonb(t) from public.transactions t where telegram_user_id = 950001
       union all select 'accounts', to_jsonb(a) from public.accounts a where telegram_user_id = 950001
       union all select 'categories', to_jsonb(c) from public.categories c where telegram_user_id = 950001
       union all select 'subcategories', to_jsonb(s) from public.subcategories s where telegram_user_id = 950001
       union all select 'budgets', to_jsonb(b) from public.budgets b where telegram_user_id = 950001
       union all select 'portfolio_snapshots', to_jsonb(p) from public.portfolio_snapshots p where telegram_user_id = 950001
       union all select 'recurring_rules', to_jsonb(r) from public.recurring_rules r where telegram_user_id = 950001
       union all select 'recurring_rule_runs', to_jsonb(r) from public.recurring_rule_runs r where telegram_user_id = 950001))
    union all
    ((select 'transactions', to_jsonb(t) from public.transactions t where telegram_user_id = 950001
       union all select 'accounts', to_jsonb(a) from public.accounts a where telegram_user_id = 950001
       union all select 'categories', to_jsonb(c) from public.categories c where telegram_user_id = 950001
       union all select 'subcategories', to_jsonb(s) from public.subcategories s where telegram_user_id = 950001
       union all select 'budgets', to_jsonb(b) from public.budgets b where telegram_user_id = 950001
       union all select 'portfolio_snapshots', to_jsonb(p) from public.portfolio_snapshots p where telegram_user_id = 950001
       union all select 'recurring_rules', to_jsonb(r) from public.recurring_rules r where telegram_user_id = 950001
       union all select 'recurring_rule_runs', to_jsonb(r) from public.recurring_rule_runs r where telegram_user_id = 950001)
      except all select * from legacy_rows_before)
  ) then raise exception 'schema reapply changed preserved legacy rows'; end if;
  begin
    update public.budgets set category = category where telegram_user_id = 950001;
    raise exception 'NOT VALID check did not reject update';
  exception when check_violation then null;
  end;
  begin
    alter table public.transactions validate constraint transactions_owner_account_fk;
    raise exception 'owner constraint unexpectedly validated';
  exception when foreign_key_violation then null;
  end;
end $$;
rollback;
