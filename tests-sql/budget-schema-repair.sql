-- Run only against a disposable, empty database after schema.sql:
-- psql -v ON_ERROR_STOP=1 -f tests-sql/budget-schema-repair.sql
-- The transaction simulates the observed old schema, then a partial upgrade.
begin;
alter table public.budgets drop column subcategory_id cascade;
alter table public.budgets add constraint budgets_telegram_user_id_category_month_key
  unique (telegram_user_id, category, month);

insert into public.users (telegram_user_id) values (930001), (930002);
-- Do not rely on user-creation triggers or default seed categories.
insert into public.categories (telegram_user_id, source_key, source_name, name)
values (930001, 'repair-test', 'repair-test', 'Repair test');
insert into public.budgets (telegram_user_id, category, month, amount_cents)
values (930001, 'repair-test', '2026-01', 1000), (930002, 'repair-test', '2026-01', 9000);
insert into public.subcategories (telegram_user_id, category_id, name)
select 930001, id, 'Repair test' from public.categories
where telegram_user_id = 930001 and source_key = 'repair-test';

\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql

do $$
declare child_id bigint;
begin
  select id into strict child_id from public.subcategories where telegram_user_id = 930001 and name = 'Repair test';
  if not exists (select 1 from public.budgets where telegram_user_id = 930001 and category = 'repair-test' and month = '2026-01' and amount_cents = 1000 and subcategory_id is null) then
    raise exception 'legacy budget was not preserved';
  end if;
  perform public.set_budget(930001, 'repair-test', '2026-01', 2000, null);
  perform public.set_budget(930001, 'repair-test', '2026-01', 3000, child_id);
  perform public.set_budget(930001, 'repair-test', '2026-01', 4000, child_id);
  if (select count(*) from public.budgets where telegram_user_id = 930001 and category = 'repair-test' and month = '2026-01') <> 2
    or not exists (select 1 from public.budgets where telegram_user_id = 930001 and subcategory_id is null and amount_cents = 2000)
    or not exists (select 1 from public.budgets where telegram_user_id = 930001 and subcategory_id = child_id and amount_cents = 4000)
    or not exists (select 1 from public.budgets where telegram_user_id = 930002 and amount_cents = 9000) then
    raise exception 'budget upserts or user isolation failed';
  end if;
end $$;

-- Simulate an already-added column whose FK was never installed.
alter table public.budgets drop constraint budgets_subcategory_id_fkey;
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql

-- A same-named FK with the wrong delete action must be repaired, not cause a
-- duplicate-name error or prevent cascading deletion.
alter table public.budgets drop constraint budgets_subcategory_id_fkey;
alter table public.budgets add constraint budgets_subcategory_id_fkey
  foreign key (subcategory_id) references public.subcategories(id) on delete restrict;
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql

do $$
declare child_id bigint;
begin
  insert into public.subcategories (telegram_user_id, category_id, name)
  select 930001, id, 'Cascade check' from public.categories
  where telegram_user_id = 930001 and source_key = 'repair-test'
  returning id into strict child_id;
  perform public.set_budget(930001, 'repair-test', '2026-02', 500, child_id);
  delete from public.subcategories where id = child_id;
  if exists (select 1 from public.budgets where subcategory_id = child_id) then
    raise exception 'repaired FK did not cascade';
  end if;
end $$;

-- An existing cascade does not make other FKs on the exact relationship safe:
-- every incompatible action must be removed, regardless of constraint name.
-- Keep an unrelated FK as well, including one whose name needs SQL quoting.
alter table public.budgets add constraint repair_restrict
  foreign key (subcategory_id) references public.subcategories(id) on delete restrict;
alter table public.budgets add constraint "repair no action"
  foreign key (subcategory_id) references public.subcategories(id) on delete no action;
alter table public.budgets add constraint "repair set null"
  foreign key (subcategory_id) references public.subcategories(id) on delete set null;
alter table public.budgets add constraint "unrelated FK"
  foreign key (telegram_user_id) references public.users(telegram_user_id) on delete restrict;
alter table public.budgets add constraint repair_owner_fk
  foreign key (subcategory_id, telegram_user_id)
  references public.subcategories(id, telegram_user_id) on delete restrict;
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql

do $$
declare child_id bigint;
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass
    and conname in ('repair_restrict', 'repair no action', 'repair set null'))
    or not exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_subcategory_id_fkey' and confdeltype = 'c')
    or not exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass
      and conname = 'unrelated FK' and confrelid = 'public.users'::regclass and confdeltype = 'r')
    or not exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass
      and conname = 'repair_owner_fk' and confrelid = 'public.subcategories'::regclass
      and cardinality(conkey) = 2 and confdeltype = 'r') then
    raise exception 'incompatible FKs were not removed or a compatible/unrelated FK was lost';
  end if;
  -- The unrelated composite RESTRICT is intentionally preserved, but would
  -- independently block the cascade being tested below.
  alter table public.budgets drop constraint repair_owner_fk;
  insert into public.subcategories (telegram_user_id, category_id, name)
  select 930001, id, 'Multiple FK cascade' from public.categories
  where telegram_user_id = 930001 and source_key = 'repair-test'
  returning id into strict child_id;
  perform public.set_budget(930001, 'repair-test', '2026-03', 500, child_id);
  delete from public.subcategories where id = child_id;
  if exists (select 1 from public.budgets where subcategory_id = child_id or
    (telegram_user_id = 930001 and month = '2026-03')) then
    raise exception 'multiple FKs prevented cascading deletion';
  end if;
end $$;

-- A same-named constraint on a different relationship must not be removed.
alter table public.budgets drop constraint budgets_subcategory_id_fkey;
alter table public.budgets add constraint budgets_subcategory_id_fkey
  foreign key (telegram_user_id) references public.users(telegram_user_id);
-- No compatible FK exists here; a differently named incompatible FK must
-- still be removed before a safely named cascade is installed.
alter table public.budgets add constraint custom_subcategory_fk
  foreign key (subcategory_id) references public.subcategories(id) on delete restrict;
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql
\ir ../supabase/migrations/20261107113215_repair_budget_subcategory_schema.sql

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_subcategory_id_fkey'
      and confrelid = 'public.users'::regclass
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_subcategory_id_fkey_1'
      and confrelid = 'public.subcategories'::regclass and confdeltype = 'c'
  ) or exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass and conname = 'custom_subcategory_fk'
  ) then
    raise exception 'same-named unrelated constraint was not preserved or FK was not repaired';
  end if;
  delete from public.subcategories where telegram_user_id = 930001 and name = 'Repair test';
  if exists (select 1 from public.budgets where telegram_user_id = 930001 and subcategory_id is not null)
    or not exists (select 1 from public.budgets where telegram_user_id = 930001 and subcategory_id is null and amount_cents = 2000) then
    raise exception 'subcategory FK cascade or parent preservation failed';
  end if;
end $$;
rollback;
