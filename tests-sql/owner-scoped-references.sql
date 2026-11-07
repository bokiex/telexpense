-- Disposable database with schema.sql applied; run with psql -v ON_ERROR_STOP=1.
-- Every fixture and schema change below is rolled back.
begin;
create function pg_temp.expect_violation(statement text) returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception 'unexpectedly accepted: %', statement;
  exception when foreign_key_violation or check_violation then null;
  end;
end $$;

insert into public.users (telegram_user_id) values (940001), (940002);
insert into public.accounts (telegram_user_id, account_key, name) values
  (940001, 'ownership-a', 'A'), (940002, 'ownership-b', 'B');
insert into public.categories (telegram_user_id, source_key, source_name, name) values
  (940001, 'ownership-a', 'ownership-a', 'A'),
  (940001, 'ownership-other', 'ownership-other', 'Other'),
  (940002, 'ownership-b', 'ownership-b', 'B');
insert into public.subcategories (telegram_user_id, category_id, name)
select telegram_user_id, id, 'Child' from public.categories
where source_key in ('ownership-a', 'ownership-other', 'ownership-b') and telegram_user_id in (940001, 940002);

do $$
declare
  a bigint; b bigint; ca bigint; cb bigint; co bigint; sa bigint; sb bigint; so bigint; rule_a bigint; rule_b bigint;
begin
  select id into strict a from public.accounts where telegram_user_id = 940001 and account_key = 'ownership-a';
  select id into strict b from public.accounts where telegram_user_id = 940002 and account_key = 'ownership-b';
  select id into strict ca from public.categories where telegram_user_id = 940001 and source_key = 'ownership-a';
  select id into strict co from public.categories where telegram_user_id = 940001 and source_key = 'ownership-other';
  select id into strict cb from public.categories where telegram_user_id = 940002 and source_key = 'ownership-b';
  select id into strict sa from public.subcategories where category_id = ca and name = 'Child';
  select id into strict so from public.subcategories where category_id = co and name = 'Child';
  select id into strict sb from public.subcategories where category_id = cb and name = 'Child';
  insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id, to_account_id, category, category_id, subcategory_id)
    values (940001, 'test', 'subscription', 100, a, null, 'ownership-a', ca, sa) returning id into rule_a;
  insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id)
    values (940002, 'test', 'subscription', 100, b) returning id into rule_b;
  insert into public.transactions (telegram_user_id, kind, category, category_id, subcategory_id, account_id, recurring_rule_id, description, amount_cents)
    values (940001, 'expense', 'ownership-a', ca, sa, a, rule_a, 'valid', -100),
           (940001, 'expense', 'legacy text only', null, null, null, null, 'legacy', -100);
  insert into public.portfolio_snapshots (telegram_user_id, account_id, month, portfolio_value_cents) values (940001, a, '2026-01', 100);
  insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month) values (940001, rule_a, '2026-01');
  insert into public.pending_transaction_captures (token, telegram_user_id, description, amount_cents, account_id, category_id, subcategory_id, expires_at)
    values ('ownership-test', 940001, 'valid', -100, a, ca, sa, now() + interval '1 day');
  insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents) values
    (940001, 'ownership-a', sa, '2026-01', 100), (940001, '__budget_group__:needs', null, '2026-01', 100),
    (940001, 'legacy text', null, '2026-01', 100);

  perform pg_temp.expect_violation(format('insert into public.transactions (telegram_user_id,kind,category,account_id,description,amount_cents) values (940001,''expense'',''x'',%s,''x'',-1)', b));
  perform pg_temp.expect_violation(format('insert into public.transactions (telegram_user_id,kind,category,category_id,description,amount_cents) values (940001,''expense'',''x'',%s,''x'',-1)', cb));
  perform pg_temp.expect_violation(format('insert into public.transactions (telegram_user_id,kind,category,category_id,subcategory_id,description,amount_cents) values (940001,''expense'',''x'',%s,%s,''x'',-1)', ca, so));
  perform pg_temp.expect_violation(format('insert into public.transactions (telegram_user_id,kind,category,subcategory_id,description,amount_cents) values (940001,''expense'',''x'',%s,''x'',-1)', sa));
  perform pg_temp.expect_violation(format('insert into public.transactions (telegram_user_id,kind,category,recurring_rule_id,description,amount_cents) values (940001,''expense'',''x'',%s,''x'',-1)', rule_b));
  perform pg_temp.expect_violation(format('insert into public.portfolio_snapshots (telegram_user_id,account_id,month,portfolio_value_cents) values (940001,%s,''2026-02'',1)', b));
  perform pg_temp.expect_violation(format('insert into public.recurring_rules (telegram_user_id,name,rule_type,amount_cents,from_account_id) values (940001,''x'',''subscription'',1,%s)', b));
  perform pg_temp.expect_violation(format('update public.recurring_rules set to_account_id = %s where id = %s', b, rule_a));
  perform pg_temp.expect_violation(format('update public.recurring_rules set subcategory_id = %s where id = %s', so, rule_a));
  perform pg_temp.expect_violation(format('insert into public.recurring_rule_runs (telegram_user_id,recurring_rule_id,month) values (940001,%s,''2026-02'')', rule_b));
  perform pg_temp.expect_violation(format('insert into public.subcategories (telegram_user_id,category_id,name) values (940001,%s,''bad'')', cb));
  perform pg_temp.expect_violation(format('update public.pending_transaction_captures set account_id = %s where token = ''ownership-test''', b));
  perform pg_temp.expect_violation(format('update public.pending_transaction_captures set subcategory_id = %s where token = ''ownership-test''', sb));
  perform pg_temp.expect_violation(format('update public.pending_transaction_captures set subcategory_id = %s where token = ''ownership-test''', so));
  perform pg_temp.expect_violation(format('update public.pending_transaction_captures set category_id = null where token = ''ownership-test'''));
  perform pg_temp.expect_violation(format('insert into public.budgets (telegram_user_id,category,subcategory_id,month,amount_cents) values (940001,''ownership-a'',%s,''2026-02'',1)', sb));
  perform pg_temp.expect_violation(format('insert into public.budgets (telegram_user_id,category,subcategory_id,month,amount_cents) values (940001,''ownership-other'',%s,''2026-02'',1)', sa));
  perform pg_temp.expect_violation(format('insert into public.budgets (telegram_user_id,category,subcategory_id,month,amount_cents) values (940001,''__budget_group__:needs'',%s,''2026-02'',1)', sa));
  perform pg_temp.expect_violation(format('update public.subcategories set category_id = %s where id = %s', co, sa));
  perform pg_temp.expect_violation(format('update public.categories set source_key = ''changed'', source_name = ''changed'' where id = %s', ca));
  -- Parent identity changes are forbidden even with no budgets. This is what
  -- makes an old repeatable-read snapshot safe against concurrent insertion.
  perform pg_temp.expect_violation(format('update public.subcategories set category_id = %s where id = %s', ca, so));
  perform pg_temp.expect_violation(format('update public.categories set source_key = ''changed'' where id = %s', co));
  update public.categories set source_name = ' OWNERSHIP-A ', name = 'Cosmetic change' where id = ca;
  update public.subcategories set name = 'Cosmetic change' where id = sa;
  update public.budgets set amount_cents = 101 where subcategory_id = sa;

  -- SET NULL keeps the owner; CASCADE removes dependent snapshots/runs.
  delete from public.accounts where id = a;
  if not exists (select 1 from public.transactions where telegram_user_id = 940001 and description = 'valid' and account_id is null)
     or exists (select 1 from public.portfolio_snapshots where account_id = a)
     or exists (select 1 from public.recurring_rule_runs where recurring_rule_id = rule_a) then
    raise exception 'account/rule deletion behavior changed';
  end if;
  delete from public.categories where id = ca;
  if not exists (select 1 from public.transactions where telegram_user_id = 940001 and description = 'valid' and category_id is null and subcategory_id is null)
     or exists (select 1 from public.budgets where subcategory_id = sa)
     or exists (select 1 from public.pending_transaction_captures where token = 'ownership-test') then
    raise exception 'category deletion behavior changed';
  end if;

  -- Exercise child deletion separately, and category deletion while a rule
  -- survives (the account above deleted the first rule).
  insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id, category, category_id, subcategory_id)
    select 940001, 'surviving rule', 'subscription', 100, id, 'ownership-other', co, so
    from public.accounts where telegram_user_id = 940001 limit 1;
  -- The original account has been deleted; create a replacement if necessary.
  if not found then
    insert into public.accounts (telegram_user_id, account_key, name) values (940001, 'replacement', 'Replacement') returning id into a;
    insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id, category, category_id, subcategory_id)
      values (940001, 'surviving rule', 'subscription', 100, a, 'ownership-other', co, so);
  end if;
  insert into public.transactions (telegram_user_id,kind,category,category_id,subcategory_id,description,amount_cents)
    values (940001,'expense','ownership-other',co,so,'child delete',-1);
  insert into public.budgets (telegram_user_id,category,subcategory_id,month,amount_cents)
    values (940001,'ownership-other',so,'2026-02',1);
  delete from public.subcategories where id = so;
  if exists (select 1 from public.budgets where subcategory_id = so)
     or not exists (select 1 from public.transactions where description = 'child delete' and category_id = co and subcategory_id is null)
     or not exists (select 1 from public.recurring_rules where name = 'surviving rule' and category_id = co and subcategory_id is null) then
    raise exception 'subcategory deletion behavior changed';
  end if;
  delete from public.categories where id = co;
  if not exists (select 1 from public.recurring_rules where name = 'surviving rule' and category_id is null and subcategory_id is null) then
    raise exception 'category deletion did not preserve recurring rule';
  end if;
  delete from public.users where telegram_user_id = 940001;
  if exists (select 1 from public.transactions where telegram_user_id = 940001)
     or exists (select 1 from public.recurring_rules where telegram_user_id = 940001) then
    raise exception 'user cascade did not remove dependent rows';
  end if;
  insert into public.users (telegram_user_id) values (940001);
end $$;

-- Document the unavoidable NOT VALID CHECK interaction: both the explicit
-- cleanup and built-in SET NULL actions are UPDATEs and recheck all CHECKs.
insert into public.categories (telegram_user_id, source_key, source_name, name)
values (940002, 'legacy-check', 'legacy-check', 'Legacy');
insert into public.transactions (telegram_user_id, kind, category, category_id, description, amount_cents)
select 940002, 'expense', 'legacy-check', id, 'legacy-check-invalid', -1
from public.categories where telegram_user_id = 940002 and source_key = 'legacy-check';
alter table public.transactions add constraint owner_test_legacy_check
  check (description <> 'legacy-check-invalid') not valid;
select pg_temp.expect_violation($sql$delete from public.categories where telegram_user_id = 940002 and source_key = 'legacy-check'$sql$);
do $$ begin
  if not exists (select 1 from public.transactions where description = 'legacy-check-invalid' and category_id is not null)
     or not exists (select 1 from public.categories where telegram_user_id = 940002 and source_key = 'legacy-check') then
    raise exception 'failed deletion did not roll back';
  end if;
end $$;
alter table public.transactions drop constraint owner_test_legacy_check;
delete from public.categories where telegram_user_id = 940002 and source_key = 'legacy-check';

-- Install over a historical cross-owner row without rewriting it. NOT VALID
-- still rejects new bad references; validation surfaces the old inconsistency.
alter table public.transactions drop constraint transactions_owner_account_fk;
insert into public.transactions (telegram_user_id,kind,category,account_id,description,amount_cents)
select 940001,'expense','legacy',id,'historical mismatch',-1 from public.accounts where telegram_user_id = 940002 and account_key = 'ownership-b';
\ir ../supabase/migrations/20261107113754_owner_scoped_references.sql
\ir ../supabase/migrations/20261107113754_owner_scoped_references.sql

do $$
begin
  if not exists (select 1 from public.transactions where description = 'historical mismatch' and account_id is not null) then
    raise exception 'migration rewrote a historical row';
  end if;
  perform pg_temp.expect_violation('alter table public.transactions validate constraint transactions_owner_account_fk');
  perform pg_temp.expect_violation('insert into public.transactions (telegram_user_id,kind,category,account_id,description,amount_cents) select 940001,''expense'',''x'',id,''new mismatch'',-1 from public.accounts where telegram_user_id=940002 and account_key=''ownership-b''');
  delete from public.accounts where telegram_user_id=940002 and account_key='ownership-b';
  if not exists (select 1 from public.transactions where description = 'historical mismatch' and telegram_user_id = 940001 and account_id is null) then
    raise exception 'historical mismatched reference did not retain old SET NULL behavior';
  end if;
end $$;
rollback;
