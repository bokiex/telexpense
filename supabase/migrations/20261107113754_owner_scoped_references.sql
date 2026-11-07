-- Owner-scoped references. Existing inconsistent rows are deliberately not
-- rewritten: audit and VALIDATE these constraints separately after remediation.
-- PostgreSQL 15+ is required for column-list ON DELETE SET NULL.
create unique index if not exists accounts_id_telegram_user_id_idx on public.accounts (id, telegram_user_id);
create unique index if not exists categories_owner_reference_uidx on public.categories (id, telegram_user_id);
create unique index if not exists subcategories_owner_reference_uidx on public.subcategories (id, telegram_user_id);
create unique index if not exists subcategories_parent_reference_uidx on public.subcategories (id, category_id, telegram_user_id);
create unique index if not exists recurring_rules_owner_reference_uidx on public.recurring_rules (id, telegram_user_id);

-- Keep the old single-column FKs as well: they preserve delete behavior even
-- for historical cross-owner references that these NOT VALID FKs do not cover.
do $$
declare r record;
begin
  for r in select * from (values
    ('transactions','transactions_owner_account_fk','foreign key (account_id, telegram_user_id) references public.accounts (id, telegram_user_id) on delete set null (account_id)'),
    ('transactions','transactions_owner_category_fk','foreign key (category_id, telegram_user_id) references public.categories (id, telegram_user_id) on delete set null (category_id)'),
    ('transactions','transactions_owner_subcategory_fk','foreign key (subcategory_id, telegram_user_id) references public.subcategories (id, telegram_user_id) on delete set null (subcategory_id)'),
    ('transactions','transactions_parent_subcategory_fk','foreign key (subcategory_id, category_id, telegram_user_id) references public.subcategories (id, category_id, telegram_user_id) on delete set null (subcategory_id)'),
    ('transactions','transactions_owner_recurring_rule_fk','foreign key (recurring_rule_id, telegram_user_id) references public.recurring_rules (id, telegram_user_id) on delete set null (recurring_rule_id)'),
    ('portfolio_snapshots','portfolio_snapshots_owner_account_fk','foreign key (account_id, telegram_user_id) references public.accounts (id, telegram_user_id) on delete cascade'),
    ('recurring_rules','recurring_rules_owner_from_account_fk','foreign key (from_account_id, telegram_user_id) references public.accounts (id, telegram_user_id) on delete cascade'),
    ('recurring_rules','recurring_rules_owner_to_account_fk','foreign key (to_account_id, telegram_user_id) references public.accounts (id, telegram_user_id) on delete set null (to_account_id)'),
    ('recurring_rules','recurring_rules_owner_category_fk','foreign key (category_id, telegram_user_id) references public.categories (id, telegram_user_id) on delete set null (category_id)'),
    ('recurring_rules','recurring_rules_owner_subcategory_fk','foreign key (subcategory_id, telegram_user_id) references public.subcategories (id, telegram_user_id) on delete set null (subcategory_id)'),
    ('recurring_rules','recurring_rules_parent_subcategory_fk','foreign key (subcategory_id, category_id, telegram_user_id) references public.subcategories (id, category_id, telegram_user_id) on delete set null (subcategory_id)'),
    ('recurring_rule_runs','recurring_rule_runs_owner_rule_fk','foreign key (recurring_rule_id, telegram_user_id) references public.recurring_rules (id, telegram_user_id) on delete cascade'),
    ('subcategories','subcategories_owner_category_fk','foreign key (category_id, telegram_user_id) references public.categories (id, telegram_user_id) on delete cascade'),
    ('pending_transaction_captures','captures_owner_account_fk','foreign key (account_id, telegram_user_id) references public.accounts (id, telegram_user_id) on delete set null (account_id)'),
    ('pending_transaction_captures','captures_owner_category_fk','foreign key (category_id, telegram_user_id) references public.categories (id, telegram_user_id) on delete cascade'),
    ('pending_transaction_captures','captures_owner_subcategory_fk','foreign key (subcategory_id, telegram_user_id) references public.subcategories (id, telegram_user_id) on delete cascade'),
    ('pending_transaction_captures','captures_parent_subcategory_fk','foreign key (subcategory_id, category_id, telegram_user_id) references public.subcategories (id, category_id, telegram_user_id) on delete cascade'),
    ('budgets','budgets_owner_subcategory_fk','foreign key (subcategory_id, telegram_user_id) references public.subcategories (id, telegram_user_id) on delete cascade')
  ) as f(tbl, name, definition)
  loop
    if not exists (select 1 from pg_catalog.pg_constraint where conrelid = format('public.%I', r.tbl)::regclass and conname = r.name) then
      execute format('alter table public.%I add constraint %I %s not valid', r.tbl, r.name, r.definition);
    end if;
  end loop;
  for r in select * from (values
    ('transactions','transactions_subcategory_requires_category_check'),
    ('recurring_rules','recurring_rules_subcategory_requires_category_check'),
    ('pending_transaction_captures','captures_subcategory_requires_category_check')
  ) as c(tbl, name)
  loop
    if not exists (select 1 from pg_catalog.pg_constraint where conrelid = format('public.%I', r.tbl)::regclass and conname = r.name) then
      execute format('alter table public.%I add constraint %I check (subcategory_id is null or category_id is not null) not valid', r.tbl, r.name);
    end if;
  end loop;
end $$;

-- Existing scalar category FKs SET NULL only category_id. Clear both identities
-- before those RI actions, including on historically mismatched ownership.
-- Like any RI SET NULL, these updates recheck unrelated NOT VALID CHECKs; a
-- legacy-invalid row can block deletion until it is remediated. Do not bypass
-- checks or silently rewrite unrelated financial fields to make deletion pass.
create or replace function public.clear_category_child_references()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.transactions set category_id = null, subcategory_id = null where category_id = old.id;
  update public.recurring_rules set category_id = null, subcategory_id = null where category_id = old.id;
  return old;
end $$;
drop trigger if exists clear_category_child_references on public.categories;
create trigger clear_category_child_references before delete on public.categories
  for each row execute function public.clear_category_child_references();

-- A cascading account deletion can delete a rule before another account FK
-- clears transactions.account_id. Clear rule references first so that the
-- account SET NULL action cannot observe a temporarily missing rule.
create or replace function public.clear_deleted_rule_references()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.transactions set recurring_rule_id = null where recurring_rule_id = old.id;
  return old;
end $$;
drop trigger if exists clear_deleted_rule_references on public.recurring_rules;
create trigger clear_deleted_rule_references before delete on public.recurring_rules
  for each row execute function public.clear_deleted_rule_references();

-- Budget category is text, so ordinary FKs cannot express its relationship to
-- the subcategory's parent. Make those parent identities immutable, even when
-- no budget currently exists: checking for budgets in an UPDATE trigger races
-- concurrent inserts (and is not safe with a repeatable-read snapshot).
-- Cosmetic category names and normalized-equivalent source text can still change.
-- Delete/recreate is required for a real identity change or reparenting.
create or replace function public.check_subcategory_budget_reparent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.category_id is distinct from old.category_id
     or new.telegram_user_id is distinct from old.telegram_user_id then
    raise foreign_key_violation using message = 'subcategory parent and owner are immutable';
  end if;
  return new;
end $$;
drop trigger if exists check_subcategory_budget_reparent on public.subcategories;
create trigger check_subcategory_budget_reparent before update of category_id, telegram_user_id on public.subcategories
  for each row execute function public.check_subcategory_budget_reparent();

create or replace function public.check_category_budget_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.telegram_user_id is distinct from old.telegram_user_id
     or public.normalize_identity(new.source_key) is distinct from public.normalize_identity(old.source_key)
     or public.normalize_identity(new.source_name) is distinct from public.normalize_identity(old.source_name) then
    raise foreign_key_violation using message = 'category source identity and owner are immutable';
  end if;
  return new;
end $$;
drop trigger if exists check_category_budget_identity on public.categories;
create trigger check_category_budget_identity before update of source_key, source_name, telegram_user_id on public.categories
  for each row execute function public.check_category_budget_identity();

-- No explicit parent row locks: immutable identities make the snapshot safe,
-- and the owner FK on subcategory_id protects concurrent deletes. Taking locks
-- here would invert the category -> subcategory order of cascading deletes.
create or replace function public.check_budget_subcategory_parent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.subcategory_id is null then return new; end if;
  if left(public.normalize_identity(new.category), length('__budget_group__:')) = '__budget_group__:' then
    raise foreign_key_violation using message = 'theme budgets cannot have a subcategory';
  end if;
  if not exists (
    select 1 from public.subcategories s
    join public.categories c on c.id = s.category_id
    where s.id = new.subcategory_id
      and s.telegram_user_id = new.telegram_user_id
      and c.telegram_user_id = new.telegram_user_id
      and (public.normalize_identity(new.category) = public.normalize_identity(c.source_name)
           or public.normalize_identity(new.category) = public.normalize_identity(c.source_key))
  ) then
    raise foreign_key_violation using message = 'budget subcategory does not belong to its owner and category';
  end if;
  return new;
end $$;
drop trigger if exists check_budget_subcategory_parent on public.budgets;
create trigger check_budget_subcategory_parent before insert or update of category, subcategory_id, telegram_user_id on public.budgets
  for each row execute function public.check_budget_subcategory_parent();
