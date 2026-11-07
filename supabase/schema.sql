create table if not exists public.users (
  telegram_user_id bigint primary key,
  first_name text,
  username text,
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  account_key text not null,
  name text not null,
  institution text,
  account_type text not null default 'bank' check (account_type in ('cash', 'bank', 'card', 'investment', 'loan', 'other')),
  opening_balance_cents integer not null default 0,
  color text not null default '#60a5fa',
  icon text not null default 'Wallet',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id, account_key)
);

create table if not exists public.transactions (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'investment', 'transfer')),
  category text,
  category_id bigint,
  subcategory_id bigint,
  account_id bigint references public.accounts(id) on delete set null,
  transfer_group_id uuid,
  savings_allocation boolean not null default false,
  recurring_rule_id bigint,
  description text not null,
  amount_cents integer not null,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_snapshots (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  account_id bigint not null references public.accounts(id) on delete cascade,
  month text not null,
  portfolio_value_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id, account_id, month)
);

create table if not exists public.recurring_rules (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  name text not null,
  rule_type text not null check (rule_type in ('subscription', 'account_transfer', 'investment_transfer', 'loan_payment')),
  amount_cents integer not null,
  category text,
  from_account_id bigint not null references public.accounts(id) on delete cascade,
  to_account_id bigint references public.accounts(id) on delete set null,
  day_of_month integer not null default 1 check (day_of_month between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_rule_runs (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  recurring_rule_id bigint not null references public.recurring_rules(id) on delete cascade,
  month text not null,
  transfer_group_id uuid,
  created_at timestamptz not null default now(),
  unique (telegram_user_id, recurring_rule_id, month)
);

create table if not exists public.budgets (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  category text not null,
  month text not null,
  amount_cents integer not null
);

create table if not exists public.categories (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  source_key text not null,
  source_name text not null,
  name text not null,
  budget_group text not null default 'Needs' check (budget_group in ('Needs', 'Wants', 'Savings')),
  color text not null default '#4ade80',
  icon text not null default 'Wallet',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id, source_key)
);

create table if not exists public.subcategories (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  category_id bigint not null references public.categories(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (telegram_user_id, category_id, name)
);

alter table public.recurring_rules
  add column if not exists category_id bigint references public.categories(id) on delete set null,
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete set null;

alter table public.budgets
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete cascade;

alter table public.transactions
  add column if not exists account_id bigint references public.accounts(id) on delete set null;

alter table public.transactions
  add column if not exists transfer_group_id uuid;

alter table public.transactions
  add column if not exists savings_allocation boolean not null default false;

alter table public.transactions
  alter column category drop not null;

alter table public.transactions
  drop constraint if exists transactions_category_required_unless_transfer;

alter table public.transactions
  add constraint transactions_category_required_unless_transfer
  check (category is not null or transfer_group_id is not null);

drop function if exists public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date);
drop function if exists public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean);

create function public.update_transfer_group(
  target_user_id bigint,
  target_transfer_group_id uuid,
  from_account_id bigint,
  to_account_id bigint,
  transfer_description text,
  transfer_amount_cents integer,
  transfer_occurred_on date,
  transfer_savings_allocation boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  destination_kind text;
begin
  if (select count(*) <> 2 from public.transactions where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id) then
    raise exception 'Transfer group is not available.';
  end if;
  select case when account_type = 'investment' then 'investment' else 'transfer' end
  into destination_kind
  from public.accounts
  where telegram_user_id = target_user_id and id = to_account_id;
  if destination_kind is null then raise exception 'Destination account is not available.'; end if;
  update public.transactions
  set kind = 'expense', category = null, category_id = null, subcategory_id = null,
       account_id = from_account_id, description = transfer_description,
       amount_cents = -transfer_amount_cents,
       occurred_on = transfer_occurred_on,
       savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents < 0;
  if not found then raise exception 'Transfer source leg is not available.'; end if;
  update public.transactions
  set kind = destination_kind, category = null, category_id = null, subcategory_id = null,
       account_id = to_account_id, description = transfer_description,
       amount_cents = transfer_amount_cents,
       occurred_on = transfer_occurred_on,
       savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents > 0;
  if not found then raise exception 'Transfer destination leg is not available.'; end if;
end;
$$;

revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) from public;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) from anon;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) from authenticated;
grant execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) to service_role;

create or replace function public.delete_transfer_group(
  target_user_id bigint,
  target_transfer_group_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    select count(*) <> 2
    from public.transactions
    where telegram_user_id = target_user_id
      and transfer_group_id = target_transfer_group_id
  ) then
    raise exception 'Transfer group is not available.';
  end if;

  delete from public.transactions
  where telegram_user_id = target_user_id
    and transfer_group_id = target_transfer_group_id;
end;
$$;

revoke execute on function public.delete_transfer_group(bigint, uuid) from public;
revoke execute on function public.delete_transfer_group(bigint, uuid) from anon;
revoke execute on function public.delete_transfer_group(bigint, uuid) from authenticated;
grant execute on function public.delete_transfer_group(bigint, uuid) to service_role;

alter table public.transactions
  add column if not exists recurring_rule_id bigint references public.recurring_rules(id) on delete set null;

alter table public.transactions
  add column if not exists category_id bigint references public.categories(id) on delete set null;

alter table public.transactions
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete set null;

-- One-time legacy repairs must not revisit rows preserved by either invariant
-- migration: PostgreSQL rechecks NOT VALID checks on UPDATE, and budget
-- reconstruction would delete/reinsert the historical rows. Later remediation
-- must be explicit and audited instead.
create temporary table schema_legacy_repairs on commit drop as
select 1 as enabled
where not exists (
  select 1 from pg_catalog.pg_constraint
  where connamespace = 'public'::regnamespace
    and (conname like '%\_owner\_%' escape '\'
      or conname like '%\_parent\_subcategory\_fk' escape '\'
      or conname like '%\_subcategory\_requires\_category\_check' escape '\'
      or conname in ('budgets_month_format_check', 'portfolio_snapshots_month_format_check',
        'recurring_rule_runs_month_format_check', 'budgets_nonnegative_amount_check',
        'portfolio_snapshots_nonnegative_value_check', 'recurring_rules_positive_amount_check',
        'transactions_ungrouped_sign_check'))
);

update public.transactions t
   set subcategory_id = null
 where subcategory_id is not null
   and exists (select 1 from schema_legacy_repairs)
   and not exists (
     select 1 from public.subcategories s where s.id = t.subcategory_id
   );

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any(c.conkey)
     where c.conrelid = 'public.transactions'::regclass
       and c.confrelid = 'public.subcategories'::regclass
       and c.contype = 'f'
       and a.attname = 'subcategory_id'
  ) then
    alter table public.transactions
      add constraint transactions_subcategory_id_fkey
      foreign key (subcategory_id) references public.subcategories(id) on delete set null;
  end if;
end $$;

create table if not exists public.pending_transaction_captures (
  token text primary key,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'income', 'investment')),
  description text not null,
  amount_cents integer not null,
  account_id bigint references public.accounts(id) on delete set null,
  category_id bigint references public.categories(id) on delete cascade,
  subcategory_id bigint references public.subcategories(id) on delete cascade,
  version integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.pending_transaction_captures
  add column if not exists kind text not null default 'expense';

alter table public.pending_transaction_captures
  add column if not exists account_id bigint references public.accounts(id) on delete set null;

alter table public.pending_transaction_captures
  add column if not exists version integer not null default 0;

alter table public.pending_transaction_captures
  drop constraint if exists pending_transaction_captures_kind_check;

alter table public.pending_transaction_captures
  add constraint pending_transaction_captures_kind_check
  check (kind in ('expense', 'income', 'investment'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.transactions'::regclass
      and c.confrelid = 'public.categories'::regclass
      and c.contype = 'f'
      and a.attname = 'category_id'
  ) then
    alter table public.transactions
      add constraint transactions_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
end $$;

do $$
begin
  alter table public.accounts drop constraint if exists accounts_account_type_check;
  alter table public.accounts
    add constraint accounts_account_type_check
      check (account_type in ('cash', 'bank', 'card', 'investment', 'loan', 'other'));
end $$;

alter table public.categories
  add column if not exists active boolean not null default true;

create index if not exists transactions_user_month_idx
  on public.transactions (telegram_user_id, occurred_on desc, id desc);

create index if not exists transactions_user_account_idx
  on public.transactions (telegram_user_id, account_id);

create index if not exists transactions_user_transfer_group_idx
  on public.transactions (telegram_user_id, transfer_group_id);

create index if not exists transactions_user_recurring_idx
  on public.transactions (telegram_user_id, recurring_rule_id);

create index if not exists budgets_user_month_idx
  on public.budgets (telegram_user_id, month);

create index if not exists accounts_user_idx
  on public.accounts (telegram_user_id, account_key);

create index if not exists categories_user_idx
  on public.categories (telegram_user_id, source_key);

create index if not exists subcategories_user_category_idx
  on public.subcategories (telegram_user_id, category_id);

create index if not exists portfolio_snapshots_user_month_idx
  on public.portfolio_snapshots (telegram_user_id, month);

create index if not exists recurring_rules_user_idx
  on public.recurring_rules (telegram_user_id, active);

create index if not exists recurring_rules_active_traversal_idx
  on public.recurring_rules (telegram_user_id, id) where active;

create index if not exists recurring_rule_runs_user_month_idx
  on public.recurring_rule_runs (telegram_user_id, month);

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.categories enable row level security;
alter table public.subcategories enable row level security;
alter table public.pending_transaction_captures enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.recurring_rule_runs enable row level security;

drop function if exists public.consume_pending_transaction_capture(bigint, text, bigint);
drop function if exists public.consume_pending_transaction_capture(bigint, text, bigint, bigint, bigint);

create or replace function public.consume_pending_transaction_capture(
  p_telegram_user_id bigint,
  p_token text,
  p_account_id bigint,
  p_expected_category_id bigint,
  p_expected_subcategory_id bigint,
  p_expected_version integer
)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  capture public.pending_transaction_captures%rowtype;
  category_source_name text;
  account_name text;
  transaction_id bigint;
begin
  select * into capture
    from public.pending_transaction_captures
   where telegram_user_id = p_telegram_user_id and token = p_token and expires_at > now()
   for update;
  if not found then return null; end if;
   if capture.category_id is distinct from p_expected_category_id
      or capture.subcategory_id is distinct from p_expected_subcategory_id
      or capture.account_id is distinct from p_account_id
      or capture.version is distinct from p_expected_version then
    return null;
  end if;

   select c.source_name into category_source_name
     from public.categories c
    where c.id = capture.category_id and c.telegram_user_id = p_telegram_user_id
      and c.active
      and (capture.subcategory_id is null or exists (
        select 1 from public.subcategories s
         where s.id = capture.subcategory_id
           and s.category_id = c.id
           and s.telegram_user_id = p_telegram_user_id
      ));
  select a.name into account_name
    from public.accounts a
   where a.id = p_account_id and a.telegram_user_id = p_telegram_user_id and a.active;
  if category_source_name is null or account_name is null then
    raise exception 'Pending transaction selection is not available';
  end if;

  delete from public.pending_transaction_captures
   where telegram_user_id = p_telegram_user_id and token = p_token;
   insert into public.transactions (
     telegram_user_id, kind, category, category_id, subcategory_id, account_id,
     description, amount_cents
   ) values (
     p_telegram_user_id, capture.kind, category_source_name, capture.category_id,
     capture.subcategory_id, p_account_id, capture.description,
    capture.amount_cents
  ) returning id into transaction_id;
  return transaction_id;
end;
$$;
revoke all on function public.consume_pending_transaction_capture(bigint, text, bigint, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.consume_pending_transaction_capture(bigint, text, bigint, bigint, bigint, integer) to service_role;

create or replace function public.normalize_identity(value text)
returns text language sql immutable strict parallel safe
set search_path = public
as $$ select lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) $$;

create temporary table account_merge_by_key on commit drop as
select id, min(id) over (
  partition by telegram_user_id, public.normalize_identity(account_key)
) keeper
from public.accounts
where exists (select 1 from schema_legacy_repairs);

do $$
begin
  if exists (
    select 1
    from account_merge_by_key m
    join public.accounts duplicate on duplicate.id = m.id
    join public.accounts keeper on keeper.id = m.keeper
    where m.id <> m.keeper
      and (
        duplicate.name is distinct from keeper.name
        or duplicate.institution is distinct from keeper.institution
        or duplicate.account_type is distinct from keeper.account_type
        or duplicate.opening_balance_cents is distinct from keeper.opening_balance_cents
        or duplicate.color is distinct from keeper.color
        or duplicate.icon is distinct from keeper.icon
        or duplicate.active is distinct from keeper.active
      )
  ) then
    raise exception 'Cannot canonicalize accounts with conflicting financial state or metadata';
  end if;

  if exists (
    select 1
    from account_merge_by_key m
    join public.portfolio_snapshots duplicate on duplicate.account_id = m.id
    join public.portfolio_snapshots keeper
      on keeper.telegram_user_id = duplicate.telegram_user_id
      and keeper.account_id = m.keeper
      and keeper.month = duplicate.month
    where m.id <> m.keeper
      and (
        duplicate.portfolio_value_cents is distinct from keeper.portfolio_value_cents
      )
  ) then
    raise exception 'Cannot canonicalize accounts with conflicting portfolio snapshots';
  end if;
end $$;

delete from public.portfolio_snapshots s
using account_merge_by_key m
where s.account_id = m.id and m.id <> m.keeper
  and exists (
    select 1 from public.portfolio_snapshots kept
    where kept.telegram_user_id = s.telegram_user_id
      and kept.account_id = m.keeper
      and kept.month = s.month
  );

update public.portfolio_snapshots s set account_id = m.keeper
from account_merge_by_key m where s.account_id = m.id and m.id <> m.keeper;
update public.transactions t set account_id = m.keeper
from account_merge_by_key m where t.account_id = m.id and m.id <> m.keeper;
update public.recurring_rules r set from_account_id = m.keeper
from account_merge_by_key m where r.from_account_id = m.id and m.id <> m.keeper;
update public.recurring_rules r set to_account_id = m.keeper
from account_merge_by_key m where r.to_account_id = m.id and m.id <> m.keeper;
delete from public.accounts a using account_merge_by_key m
where a.id = m.id and m.id <> m.keeper;

update public.accounts
set account_key = public.normalize_identity(account_key), updated_at = now()
where exists (select 1 from schema_legacy_repairs);

create unique index if not exists accounts_user_canonical_key_uidx
  on public.accounts (telegram_user_id, public.normalize_identity(account_key));

insert into public.categories (telegram_user_id, source_key, source_name, name, budget_group, color, icon)
select distinct source.telegram_user_id, public.normalize_identity(source.category),
  public.normalize_identity(source.category), initcap(public.normalize_identity(source.category)),
  case when public.normalize_identity(source.category) in ('income', 'investment', 'investments', 'salary')
    then 'Savings' else 'Needs' end, '#4ade80', 'Wallet'
from (
  select telegram_user_id, category from public.transactions
  union select telegram_user_id, category from public.budgets
  union select telegram_user_id, category from public.recurring_rules
) source
where btrim(source.category) <> ''
  and exists (select 1 from schema_legacy_repairs)
  and not exists (
    select 1
    from public.categories existing
    where existing.telegram_user_id = source.telegram_user_id
      and (
        public.normalize_identity(existing.source_key) = public.normalize_identity(source.category)
        or public.normalize_identity(existing.source_name) = public.normalize_identity(source.category)
      )
  )
on conflict do nothing;

update public.transactions t set category_id = c.id
from public.categories c
where t.category_id is null
  and exists (select 1 from schema_legacy_repairs)
  and c.telegram_user_id = t.telegram_user_id
  and public.normalize_identity(c.source_name) = public.normalize_identity(t.category);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'account'
  ) and exists (select 1 from schema_legacy_repairs) then
    execute $sql$
      insert into public.accounts (telegram_user_id, account_key, name, account_type, color, icon)
      select distinct telegram_user_id, public.normalize_identity(account),
        initcap(public.normalize_identity(account)), 'bank', '#60a5fa', 'Wallet'
      from public.transactions where account_id is null and btrim(account) <> ''
      on conflict do nothing
    $sql$;
    execute $sql$
      update public.transactions t set account_id = a.id from public.accounts a
      where t.account_id is null and a.telegram_user_id = t.telegram_user_id
        and public.normalize_identity(a.account_key) = public.normalize_identity(t.account)
    $sql$;
  end if;
end $$;

insert into public.categories (telegram_user_id, source_key, source_name, name, budget_group, color, icon)
select u.telegram_user_id, seed.key, seed.key, seed.name, seed.budget_group, seed.color, seed.icon
from public.users u cross join (values
  ('food', 'Food', 'Needs', '#fb923c', 'ShoppingCart'),
  ('transport', 'Transport', 'Needs', '#a78bfa', 'Car'),
  ('salary', 'Salary', 'Savings', '#4ade80', 'Briefcase')
) seed(key, name, budget_group, color, icon)
where not exists (select 1 from public.categories c where c.telegram_user_id = u.telegram_user_id)
on conflict do nothing;

insert into public.accounts (telegram_user_id, account_key, name, account_type, color, icon)
select u.telegram_user_id, 'debit card', 'Debit Card', 'bank', '#60a5fa', 'Wallet'
from public.users u
where not exists (select 1 from public.accounts a where a.telegram_user_id = u.telegram_user_id)
on conflict do nothing;

create or replace function public.seed_user_transaction_identities()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  insert into public.categories (telegram_user_id, source_key, source_name, name, budget_group, color, icon)
  values
    (new.telegram_user_id, 'food', 'food', 'Food', 'Needs', '#fb923c', 'ShoppingCart'),
    (new.telegram_user_id, 'transport', 'transport', 'Transport', 'Needs', '#a78bfa', 'Car'),
    (new.telegram_user_id, 'salary', 'salary', 'Salary', 'Savings', '#4ade80', 'Briefcase')
  on conflict do nothing;
  insert into public.accounts (telegram_user_id, account_key, name, account_type, color, icon)
  values (new.telegram_user_id, 'debit card', 'Debit Card', 'bank', '#60a5fa', 'Wallet')
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists seed_user_transaction_identities on public.users;
create trigger seed_user_transaction_identities after insert on public.users
for each row execute function public.seed_user_transaction_identities();

create or replace function public.normalize_identity(value text)
returns text language sql immutable strict parallel safe
set search_path = public
as $$ select lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) $$;

alter table public.accounts drop constraint if exists accounts_liability_opening_balance_check;
update public.accounts
set opening_balance_cents = case
      when account_type in ('loan', 'card') then -abs(opening_balance_cents)
      else abs(opening_balance_cents)
    end,
    updated_at = now()
where exists (select 1 from schema_legacy_repairs);
alter table public.accounts add constraint accounts_liability_opening_balance_check
  check (
    (account_type in ('loan', 'card') and opening_balance_cents <= 0)
    or (account_type not in ('loan', 'card') and opening_balance_cents >= 0)
  );

alter table public.categories drop constraint if exists categories_telegram_user_id_source_key_key;
alter table public.subcategories drop constraint if exists subcategories_telegram_user_id_category_id_name_key;
alter table public.budgets drop constraint if exists budgets_telegram_user_id_category_month_key;

do $$
begin
  if exists (
    select 1
    from public.categories a
    join public.categories b
      on b.telegram_user_id = a.telegram_user_id
     and b.id > a.id
     and (
       public.normalize_identity(b.source_key) = public.normalize_identity(a.source_key)
       or public.normalize_identity(b.source_name) = public.normalize_identity(a.source_name)
     )
    where exists (select 1 from schema_legacy_repairs)
      and (public.normalize_identity(b.source_key) <> public.normalize_identity(a.source_key)
       or public.normalize_identity(b.source_name) <> public.normalize_identity(a.source_name)
       or b.name is distinct from a.name
       or b.budget_group is distinct from a.budget_group
       or b.color is distinct from a.color
       or b.icon is distinct from a.icon
       or b.active is distinct from a.active)
  ) then
    raise exception 'Cannot merge canonical duplicate categories with conflicting identity or metadata';
  end if;
end $$;

create temporary table category_merge_by_key on commit drop as
select id, min(id) over (
  partition by telegram_user_id, public.normalize_identity(source_key)
) keeper
from public.categories
where exists (select 1 from schema_legacy_repairs);

update public.transactions t
set category_id = m.keeper
from category_merge_by_key m
where t.category_id = m.id and m.id <> m.keeper;

update public.subcategories s
set category_id = m.keeper
from category_merge_by_key m
where s.category_id = m.id and m.id <> m.keeper;

delete from public.categories c
using category_merge_by_key m
where c.id = m.id and m.id <> m.keeper;

create temporary table category_merge_by_name on commit drop as
select id, min(id) over (
  partition by telegram_user_id, public.normalize_identity(source_name)
) keeper
from public.categories
where exists (select 1 from schema_legacy_repairs);

update public.transactions t
set category_id = m.keeper
from category_merge_by_name m
where t.category_id = m.id and m.id <> m.keeper;

update public.subcategories s
set category_id = m.keeper
from category_merge_by_name m
where s.category_id = m.id and m.id <> m.keeper;

delete from public.categories c
using category_merge_by_name m
where c.id = m.id and m.id <> m.keeper;

update public.categories
set source_name = public.normalize_identity(source_name),
    source_key = public.normalize_identity(source_key),
    updated_at = now()
where exists (select 1 from schema_legacy_repairs);
update public.transactions set category = public.normalize_identity(category) where exists (select 1 from schema_legacy_repairs);
update public.budgets set category = public.normalize_identity(category) where exists (select 1 from schema_legacy_repairs);
update public.recurring_rules set category = public.normalize_identity(category) where exists (select 1 from schema_legacy_repairs);
update public.subcategories set name = btrim(regexp_replace(name, '\s+', ' ', 'g')) where exists (select 1 from schema_legacy_repairs);

delete from public.subcategories a
using public.subcategories b
where a.id > b.id
  and exists (select 1 from schema_legacy_repairs)
  and a.telegram_user_id = b.telegram_user_id
  and a.category_id = b.category_id
  and public.normalize_identity(a.name) = public.normalize_identity(b.name);

with combined as (
  select telegram_user_id, public.normalize_identity(category) category, subcategory_id, month,
         sum(amount_cents)::integer amount_cents
  from public.budgets
  where exists (select 1 from schema_legacy_repairs)
  group by telegram_user_id, public.normalize_identity(category), subcategory_id, month
), removed as (
  delete from public.budgets where exists (select 1 from schema_legacy_repairs) returning *
)
insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents)
select telegram_user_id, category, subcategory_id, month, amount_cents from combined;

update public.transactions t
set category_id = c.id
from public.categories c
where c.telegram_user_id = t.telegram_user_id
  and exists (select 1 from schema_legacy_repairs)
  and public.normalize_identity(c.source_name) = public.normalize_identity(t.category);

create unique index if not exists categories_user_canonical_name_uidx
  on public.categories (telegram_user_id, public.normalize_identity(source_name));
create unique index if not exists categories_user_canonical_key_uidx
  on public.categories (telegram_user_id, public.normalize_identity(source_key));
create unique index if not exists subcategories_user_canonical_name_uidx
  on public.subcategories (telegram_user_id, category_id, public.normalize_identity(name));
create index if not exists transactions_user_category_date_idx
  on public.transactions (telegram_user_id, category_id, occurred_on desc, id desc);

create index if not exists transactions_user_subcategory_date_idx
  on public.transactions (telegram_user_id, subcategory_id, occurred_on desc, id desc);

create index if not exists pending_transaction_captures_user_expiry_idx
  on public.pending_transaction_captures (telegram_user_id, expires_at);

alter table public.categories
  add constraint categories_telegram_user_id_source_key_key
  unique (telegram_user_id, source_key);
alter table public.subcategories
  add constraint subcategories_telegram_user_id_category_id_name_key
  unique (telegram_user_id, category_id, name);

alter table public.budgets
  drop constraint if exists budgets_telegram_user_id_category_month_key;

create unique index if not exists budgets_user_category_month_uidx
  on public.budgets (telegram_user_id, category, month)
  where subcategory_id is null;

create unique index if not exists budgets_user_subcategory_month_uidx
  on public.budgets (telegram_user_id, subcategory_id, month)
  where subcategory_id is not null;

create index if not exists budgets_user_subcategory_idx
  on public.budgets (telegram_user_id, subcategory_id)
  where subcategory_id is not null;

create or replace function public.set_budget(
  p_telegram_user_id bigint,
  p_category text,
  p_month text,
  p_amount_cents integer,
  p_subcategory_id bigint default null
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  if p_subcategory_id is null then
    insert into public.budgets (
      telegram_user_id, category, month, amount_cents, subcategory_id
    )
    values (
      p_telegram_user_id, p_category, p_month, p_amount_cents, null
    )
    on conflict (telegram_user_id, category, month) where subcategory_id is null
    do update set amount_cents = excluded.amount_cents;
  else
    insert into public.budgets (
      telegram_user_id, category, month, amount_cents, subcategory_id
    )
    values (
      p_telegram_user_id, p_category, p_month, p_amount_cents, p_subcategory_id
    )
    on conflict (telegram_user_id, subcategory_id, month) where subcategory_id is not null
    do update set amount_cents = excluded.amount_cents;
  end if;
end;
$$;

create or replace function public.materialize_recurring_transactions(
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language plpgsql volatile security invoker set search_path = public
as $$
declare
  locked_user_id bigint;
  locked_rule_id bigint;
  last_user_id bigint;
  last_rule_id bigint;
  counted_user_id bigint;
  claimed_users bigint;
  claimed_count bigint;
begin
  -- Each command after a blocking row lock must see a new snapshot. Higher
  -- isolation levels retain a transaction snapshot and can hide a committed run.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'recurring materialization requires READ COMMITTED isolation'
      using errcode = '25001';
  end if;
  users_processed := 0;
  rules_materialized := 0;
  while rules_materialized < batch_size loop
  -- Lock in a common order across global and scoped workers. Never skip a
  -- locked eligible rule: a short batch is interpreted by callers as done.
  select r.telegram_user_id, r.id
  into locked_user_id, locked_rule_id
  from public.recurring_rules r
    -- NOT VALID owner FKs can leave legacy cross-owner account references.
    where (last_rule_id is null or (r.telegram_user_id, r.id) > (last_user_id, last_rule_id))
      and r.active
      and exists (
        select 1 from public.accounts a
        where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
      )
      and (r.to_account_id is null or exists (
        select 1 from public.accounts a
        where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
      ))
      and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and batch_size between 1 and 500
       and (
        target_month || '-' ||
        lpad(least(r.day_of_month, extract(day from (
          (target_month || '-01')::date + interval '1 month - 1 day'
        )))::integer::text, 2, '0')
      )::date <= current_date
       and (r.rule_type = 'subscription' or r.to_account_id is not null)
       and (r.rule_type = 'account_transfer' or exists (
         select 1
         from public.categories c
         left join public.subcategories s on s.id = r.subcategory_id
           and s.telegram_user_id = r.telegram_user_id
           and s.category_id = c.id
         where c.id = r.category_id
           and c.telegram_user_id = r.telegram_user_id
           and (r.subcategory_id is null or s.id is not null)
       ))
      and not exists (
        select 1 from public.recurring_rule_runs existing
        where existing.telegram_user_id = r.telegram_user_id
          and existing.recurring_rule_id = r.id
          and existing.month = target_month
      )
    order by r.telegram_user_id, r.id
  limit 1
  for no key update of r;
  exit when not found;
  last_user_id := locked_user_id;
  last_rule_id := locked_rule_id;

  -- Re-evaluate the rule and its run in a fresh statement snapshot after the
  -- wait. This observes committed edits/claims and retries rolled-back claims.
  with candidates as (
    select r.*,
           (
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 1, 8) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 9, 4) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 13, 4) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 17, 4) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 21, 12)
           )::uuid as run_group_id
    from public.recurring_rules r
    where r.telegram_user_id = locked_user_id and r.id = locked_rule_id
      and r.active
      and exists (
        select 1 from public.accounts a
        where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
      )
      and (r.to_account_id is null or exists (
        select 1 from public.accounts a
        where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
      ))
      and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and batch_size between 1 and 500
       and (
        target_month || '-' ||
        lpad(least(r.day_of_month, extract(day from (
          (target_month || '-01')::date + interval '1 month - 1 day'
        )))::integer::text, 2, '0')
      )::date <= current_date
       and (r.rule_type = 'subscription' or r.to_account_id is not null)
       and (r.rule_type = 'account_transfer' or exists (
         select 1
         from public.categories c
         left join public.subcategories s on s.id = r.subcategory_id
           and s.telegram_user_id = r.telegram_user_id
           and s.category_id = c.id
         where c.id = r.category_id
           and c.telegram_user_id = r.telegram_user_id
           and (r.subcategory_id is null or s.id is not null)
       ))
      and not exists (
        select 1 from public.recurring_rule_runs existing
        where existing.telegram_user_id = r.telegram_user_id
          and existing.recurring_rule_id = r.id
          and existing.month = target_month
      )
    order by r.telegram_user_id, r.id
    limit batch_size
  ),
  claimed as (
    insert into public.recurring_rule_runs (
      telegram_user_id, recurring_rule_id, month, transfer_group_id
    )
     select telegram_user_id, id, target_month,
            case when rule_type = 'subscription' then null else run_group_id end
     from candidates
    on conflict (telegram_user_id, recurring_rule_id, month) do nothing
    returning telegram_user_id, recurring_rule_id, transfer_group_id
  ),
  claimed_rules as (
     select r.*, c.transfer_group_id, category.source_name as resolved_category,
            case when r.subcategory_id is null then null else subcategory.id end as resolved_subcategory_id
     from claimed c
     join public.recurring_rules r
       on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id
     left join public.categories category
       on category.id = r.category_id and category.telegram_user_id = r.telegram_user_id
     left join public.subcategories subcategory
       on subcategory.id = r.subcategory_id
       and subcategory.telegram_user_id = r.telegram_user_id
       and subcategory.category_id = r.category_id
  ),
  inserted_transactions as (
     insert into public.transactions (
       telegram_user_id, kind, category, category_id, subcategory_id, account_id,
       transfer_group_id, recurring_rule_id, description, amount_cents, occurred_on
    )
    select r.telegram_user_id,
           case
             when leg.destination then
               case when r.rule_type = 'investment_transfer' then 'investment' else 'transfer' end
             when r.rule_type = 'investment_transfer' then 'transfer'
             when r.rule_type in ('subscription', 'loan_payment') then 'expense'
             else 'transfer'
           end,
            case when r.rule_type = 'account_transfer' then null else r.resolved_category end,
            case when r.rule_type = 'account_transfer' then null else r.category_id end,
            case when r.rule_type = 'account_transfer' then null else r.resolved_subcategory_id end,
           case when leg.destination then r.to_account_id else r.from_account_id end,
           case when r.rule_type = 'subscription' then null else r.transfer_group_id end,
           r.id,
           r.name,
            case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
           (
             target_month || '-' ||
             lpad(least(r.day_of_month, extract(day from (
               (target_month || '-01')::date + interval '1 month - 1 day'
             )))::integer::text, 2, '0')
           )::date
    from claimed_rules r
    cross join lateral (values (false), (true)) as leg(destination)
    where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
    returning recurring_rule_id
  )
  select count(distinct telegram_user_id)::bigint, count(*)::bigint
  into claimed_users, claimed_count from claimed;
  if claimed_count > 0 then
    rules_materialized := rules_materialized + claimed_count;
    if counted_user_id is distinct from locked_user_id then
      users_processed := users_processed + claimed_users;
      counted_user_id := locked_user_id;
    end if;
  end if;
  end loop;
  return next;
end;
$$;

create or replace function public.materialize_recurring_transactions_for_user(
  target_telegram_user_id bigint,
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language plpgsql volatile security invoker set search_path = public
as $$
declare
  locked_user_id bigint;
  locked_rule_id bigint;
  last_user_id bigint;
  last_rule_id bigint;
  counted_user_id bigint;
  claimed_users bigint;
  claimed_count bigint;
begin
  -- Each command after a blocking row lock must see a new snapshot. Higher
  -- isolation levels retain a transaction snapshot and can hide a committed run.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'recurring materialization requires READ COMMITTED isolation'
      using errcode = '25001';
  end if;
  users_processed := 0;
  rules_materialized := 0;
  while rules_materialized < batch_size loop
  -- Lock in a common order across global and scoped workers. Never skip a
  -- locked eligible rule: a short batch is interpreted by callers as done.
  select r.telegram_user_id, r.id
  into locked_user_id, locked_rule_id
  from public.recurring_rules r
  where (last_rule_id is null or r.id > last_rule_id)
    and r.telegram_user_id = target_telegram_user_id
    and r.active
    and exists (
      select 1 from public.accounts a
      where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
    )
    and (r.to_account_id is null or exists (
      select 1 from public.accounts a
      where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
    ))
    and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    and batch_size between 1 and 500
    and (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date <= current_date
    and (r.rule_type = 'subscription' or r.to_account_id is not null)
    and (r.rule_type = 'account_transfer' or exists (
      select 1
      from public.categories c
      left join public.subcategories s on s.id = r.subcategory_id
        and s.telegram_user_id = r.telegram_user_id
        and s.category_id = c.id
      where c.id = r.category_id
        and c.telegram_user_id = r.telegram_user_id
        and (r.subcategory_id is null or s.id is not null)
    ))
    and not exists (
      select 1 from public.recurring_rule_runs x
      where x.telegram_user_id = r.telegram_user_id
        and x.recurring_rule_id = r.id
        and x.month = target_month
    )
  order by r.id
  limit 1
  for no key update of r;
  exit when not found;
  last_user_id := locked_user_id;
  last_rule_id := locked_rule_id;

  -- Re-evaluate the rule and its run in a fresh statement snapshot after the
  -- wait. This observes committed edits/claims and retries rolled-back claims.
  with candidates as (
  select r.*,
         (substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 1, 8) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 9, 4) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 13, 4) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 17, 4) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 21, 12))::uuid as run_group_id
  from public.recurring_rules r
  where r.telegram_user_id = locked_user_id and r.id = locked_rule_id
      and r.telegram_user_id = target_telegram_user_id
    and r.active
    and exists (
      select 1 from public.accounts a
      where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
    )
    and (r.to_account_id is null or exists (
      select 1 from public.accounts a
      where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
    ))
    and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    and batch_size between 1 and 500
    and (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date <= current_date
    and (r.rule_type = 'subscription' or r.to_account_id is not null)
    and (r.rule_type = 'account_transfer' or exists (
      select 1
      from public.categories c
      left join public.subcategories s on s.id = r.subcategory_id
        and s.telegram_user_id = r.telegram_user_id
        and s.category_id = c.id
      where c.id = r.category_id
        and c.telegram_user_id = r.telegram_user_id
        and (r.subcategory_id is null or s.id is not null)
    ))
    and not exists (
      select 1 from public.recurring_rule_runs x
      where x.telegram_user_id = r.telegram_user_id
        and x.recurring_rule_id = r.id
        and x.month = target_month
    )
  order by r.id
  limit batch_size
), claimed as (
  insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month, transfer_group_id)
  select telegram_user_id, id, target_month,
         case when rule_type = 'subscription' then null else run_group_id end
  from candidates
  on conflict (telegram_user_id, recurring_rule_id, month) do nothing
  returning telegram_user_id, recurring_rule_id, transfer_group_id
), claimed_rules as (
  select r.*, c.transfer_group_id, category.source_name as resolved_category,
         case when r.subcategory_id is null then null else subcategory.id end as resolved_subcategory_id
  from claimed c
  join public.recurring_rules r on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id
  left join public.categories category on category.id = r.category_id and category.telegram_user_id = r.telegram_user_id
  left join public.subcategories subcategory on subcategory.id = r.subcategory_id
    and subcategory.telegram_user_id = r.telegram_user_id
    and subcategory.category_id = r.category_id
), inserted_transactions as (
  insert into public.transactions (
    telegram_user_id, kind, category, category_id, subcategory_id, account_id,
    transfer_group_id, recurring_rule_id, description, amount_cents, occurred_on
  )
  select r.telegram_user_id,
         case when leg.destination and r.rule_type = 'investment_transfer' then 'investment'
              when leg.destination then 'transfer'
              when r.rule_type in ('subscription', 'loan_payment') then 'expense'
              else 'transfer' end,
         case when r.rule_type = 'account_transfer' then null else r.resolved_category end,
         case when r.rule_type = 'account_transfer' then null else r.category_id end,
         case when r.rule_type = 'account_transfer' then null else r.resolved_subcategory_id end,
         case when leg.destination then r.to_account_id else r.from_account_id end,
         case when r.rule_type = 'subscription' then null else r.transfer_group_id end,
         r.id, r.name,
         case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
         (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date
  from claimed_rules r
  cross join lateral (values (false), (true)) as leg(destination)
  where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
  returning recurring_rule_id
)
select count(distinct telegram_user_id)::bigint, count(*)::bigint
  into claimed_users, claimed_count from claimed;
  if claimed_count > 0 then
    rules_materialized := rules_materialized + claimed_count;
    if counted_user_id is distinct from locked_user_id then
      users_processed := users_processed + claimed_users;
      counted_user_id := locked_user_id;
    end if;
  end if;
  end loop;
  return next;
end;
$$;

revoke execute on function public.materialize_recurring_transactions(text, integer) from public;
revoke execute on function public.materialize_recurring_transactions(text, integer) from anon;
revoke execute on function public.materialize_recurring_transactions(text, integer) from authenticated;
grant execute on function public.materialize_recurring_transactions(text, integer) to service_role;
revoke execute on function public.materialize_recurring_transactions_for_user(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.materialize_recurring_transactions_for_user(bigint, text, integer) to service_role;

create or replace function public.account_transaction_balances(target_user_id bigint)
returns table(account_id bigint, balance_cents bigint)
language sql stable security invoker set search_path = public
as $$
  select t.account_id, coalesce(sum(t.amount_cents), 0)::bigint
  from public.transactions t
  where t.telegram_user_id = target_user_id and t.account_id is not null
  group by t.account_id
$$;

create or replace function public.investment_contribution_totals(
  target_user_id bigint,
  account_cutoffs jsonb
)
returns table(account_id bigint, total_cents bigint, month_cents bigint)
language sql stable security invoker set search_path = public
as $$
  with cutoffs as (
    select key::bigint as account_id, value::text as cutoff_month
    from jsonb_each_text(account_cutoffs)
    where key ~ '^[0-9]+$'
      and value ~ '^\d{4}-(0[1-9]|1[0-2])$'
  )
  select
    t.account_id,
    coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
    coalesce(sum(t.amount_cents) filter (
      where t.occurred_on >= (c.cutoff_month || '-01')::date
    ), 0)::bigint as month_cents
  from cutoffs c
  join public.transactions t
    on t.account_id = c.account_id
   and t.telegram_user_id = target_user_id
   and t.kind in ('investment', 'transfer')
   and t.amount_cents > 0
   and t.occurred_on < ((c.cutoff_month || '-01')::date + interval '1 month')
  group by t.account_id
$$;

revoke execute on function public.investment_contribution_totals(bigint, jsonb) from public;
revoke execute on function public.investment_contribution_totals(bigint, jsonb) from anon;
revoke execute on function public.investment_contribution_totals(bigint, jsonb) from authenticated;
grant execute on function public.investment_contribution_totals(bigint, jsonb) to service_role;

-- The app uses a server-side Supabase secret/service-role key after validating Telegram initData.
-- No anon policies are required for the Mini App API flow.

-- The composite foreign key prevents a privileged application write from attaching
-- one user's statement to another user's account.
create unique index if not exists accounts_id_telegram_user_id_idx on public.accounts (id, telegram_user_id);

create table if not exists public.card_statement_snapshots (
  id bigint generated always as identity primary key,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  account_id bigint not null,
  closing_date date not null,
  due_date date not null,
  original_amount_cents integer not null check (original_amount_cents >= 0),
  remaining_amount_cents integer not null check (remaining_amount_cents >= 0 and remaining_amount_cents <= original_amount_cents),
  created_at timestamptz not null default now(),
  foreign key (account_id, telegram_user_id) references public.accounts(id, telegram_user_id) on delete cascade,
  unique (account_id, closing_date)
);
alter table public.card_statement_snapshots enable row level security;

-- NULL denotes a legacy snapshot whose historical payment amounts are unknown.
alter table public.card_statement_snapshots
  add column if not exists payment_baseline jsonb;

-- Exactly two owned, balanced legs into a card. Recognize current bank sources
-- and captured groups whose source identity is unchanged, even after reclassification.
-- Older baselines lack source identity; it cannot safely be inferred from an edited group.
create or replace function public.card_statement_payments(target_user_id bigint)
returns table (group_id uuid, account_id bigint, amount_cents bigint)
language sql stable security invoker set search_path = ''
as $$
  with groups as (
    select t.transfer_group_id as group_id,
      max(t.account_id) filter (where a.account_type = 'card' and t.amount_cents > 0) as account_id,
      max(t.account_id) filter (where a.id is not null and t.amount_cents < 0) as source_account_id,
      sum(t.amount_cents) filter (where a.account_type = 'card' and t.amount_cents > 0) as amount_cents,
      bool_or(a.account_type = 'bank' and t.amount_cents < 0) as bank_source
    from public.transactions t
    left join public.accounts a on a.id = t.account_id and a.telegram_user_id = t.telegram_user_id
    where t.telegram_user_id = target_user_id and t.transfer_group_id is not null
    group by t.transfer_group_id
    having count(*) = 2 and sum(t.amount_cents) = 0
      and count(*) filter (where a.id is not null and t.amount_cents < 0) = 1
      and count(*) filter (where a.account_type = 'card' and t.amount_cents > 0) = 1
  )
  select g.group_id, g.account_id, g.amount_cents
  from groups g
  where g.bank_source or exists (
    select 1 from public.card_statement_snapshots s
    where s.telegram_user_id = target_user_id and s.account_id = g.account_id
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object('groupId', g.group_id::text, 'sourceAccountId', g.source_account_id))
  );
$$;

-- Payments are validated by card_statement_payments; the negative leg is unique.
create or replace function public.card_statement_payment_baseline(target_user_id bigint, target_account_id bigint)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('groupId', p.group_id, 'amountCents', p.amount_cents,
    'sourceAccountId', t.account_id) order by p.group_id), '[]'::jsonb)
  from public.card_statement_payments(target_user_id) p
  join public.transactions t on t.telegram_user_id = target_user_id and t.transfer_group_id = p.group_id and t.amount_cents < 0
  where p.account_id = target_account_id;
$$;

-- One statement-level MVCC snapshot captures both the insertion and all groups.
create or replace function public.create_card_statement_snapshot(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = ''
as $$
  insert into public.card_statement_snapshots
    (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
  select target_user_id, a.id, target_closing_date, target_due_date, target_original_cents, target_remaining_cents,
    public.card_statement_payment_baseline(target_user_id, a.id)
  from public.accounts a
  where a.telegram_user_id = target_user_id and a.id = target_account_id and a.account_type = 'card'
  returning id;
$$;

-- Explicitly re-enter a legacy snapshot using an authoritative current amount.
-- Never overwrite a snapshot whose baseline is already known.
create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = ''
as $$
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = public.card_statement_payment_baseline(target_user_id, s.account_id)
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id;
$$;

-- A single database statement gives status a consistent view of statements and
-- grouped transfers, even while another request edits or deletes a payment.
create or replace function public.read_card_statement_inputs(target_user_id bigint)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.closing_date, s.id)
      from public.card_statement_snapshots s
      join public.accounts a on a.id = s.account_id and a.telegram_user_id = s.telegram_user_id
      where s.telegram_user_id = target_user_id and a.account_type = 'card'), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('groupId', p.group_id, 'accountId', p.account_id, 'amountCents', p.amount_cents))
      from public.card_statement_payments(target_user_id) p), '[]'::jsonb)
  );
$$;

revoke all on function public.card_statement_payments(bigint) from public, anon, authenticated;
revoke all on function public.card_statement_payment_baseline(bigint, bigint) from public, anon, authenticated;
revoke all on function public.create_card_statement_snapshot(bigint, bigint, date, date, integer, integer) from public, anon, authenticated;
revoke all on function public.read_card_statement_inputs(bigint) from public, anon, authenticated;
revoke all on function public.rebaseline_legacy_card_statement(bigint, bigint, date, date, integer, integer) from public, anon, authenticated;
grant execute on function public.card_statement_payments(bigint) to service_role;
grant execute on function public.card_statement_payment_baseline(bigint, bigint) to service_role;
grant execute on function public.create_card_statement_snapshot(bigint, bigint, date, date, integer, integer) to service_role;
grant execute on function public.read_card_statement_inputs(bigint) to service_role;
grant execute on function public.rebaseline_legacy_card_statement(bigint, bigint, date, date, integer, integer) to service_role;

-- Preserve the account roles at the time a transfer is made, rather than
-- inferring payment status from mutable account metadata or statement history.
alter table public.transactions add column if not exists transfer_account_type text;

-- Captured baselines establish the destination card role even if the card was
-- reclassified. A captured source identity also establishes the bank role;
-- source-less old baselines cannot establish a non-bank source was a payment.
update public.transactions t
set transfer_account_type = case
  when t.amount_cents > 0 and exists (
    select 1 from public.card_statement_snapshots s
    where s.telegram_user_id = t.telegram_user_id and s.account_id = t.account_id
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object('groupId', t.transfer_group_id::text))
  ) then 'card'
  when t.amount_cents < 0 and exists (
    select 1 from public.transactions destination
    join public.card_statement_snapshots s
      on s.telegram_user_id = t.telegram_user_id and s.account_id = destination.account_id
    where destination.telegram_user_id = t.telegram_user_id
      and destination.transfer_group_id = t.transfer_group_id and destination.amount_cents > 0
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object(
        'groupId', t.transfer_group_id::text, 'sourceAccountId', t.account_id))
  ) then 'bank'
  else a.account_type end
from public.accounts a
where t.transfer_group_id is not null and t.transfer_account_type is null
  and exists (select 1 from schema_legacy_repairs)
  and a.id = t.account_id and a.telegram_user_id = t.telegram_user_id;

-- The trigger covers both ordinary grouped inserts and both recurring
-- materializers. Account metadata changes never rewrite historical roles.
create or replace function public.capture_transfer_account_type()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.transfer_group_id is null then
    new.transfer_account_type := null;
  elsif tg_op = 'INSERT' or old.account_id is distinct from new.account_id
      or old.transfer_group_id is distinct from new.transfer_group_id
      or old.telegram_user_id is distinct from new.telegram_user_id then
    select a.account_type into new.transfer_account_type from public.accounts a
    where a.id = new.account_id and a.telegram_user_id = new.telegram_user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists capture_transfer_account_type on public.transactions;
create trigger capture_transfer_account_type before insert or update on public.transactions
for each row execute function public.capture_transfer_account_type();

-- Reclassify both roles only when an edit changes either account identity.
-- Amount, date and description edits preserve the original classification.
create or replace function public.update_transfer_group(
  target_user_id bigint, target_transfer_group_id uuid, from_account_id bigint,
  to_account_id bigint, transfer_description text, transfer_amount_cents integer,
  transfer_occurred_on date, transfer_savings_allocation boolean
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  destination_kind text;
  source_type text;
  destination_type text;
  old_source bigint;
  old_destination bigint;
begin
  perform 1 from public.transactions where telegram_user_id = target_user_id
    and transfer_group_id = target_transfer_group_id order by id for update;
  if (select count(*) <> 2 from public.transactions where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id) then
    raise exception 'Transfer group is not available.';
  end if;
  select max(account_id) filter (where amount_cents < 0), max(account_id) filter (where amount_cents > 0)
    into old_source, old_destination from public.transactions
    where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id;
  select account_type into source_type from public.accounts where telegram_user_id = target_user_id and id = from_account_id;
  select account_type into destination_type from public.accounts where telegram_user_id = target_user_id and id = to_account_id;
  if source_type is null then raise exception 'Source account is not available.'; end if;
  if destination_type is null then raise exception 'Destination account is not available.'; end if;
  destination_kind := case when destination_type = 'investment' then 'investment' else 'transfer' end;
  update public.transactions
  set kind = 'expense', category = null, category_id = null, subcategory_id = null,
      account_id = from_account_id, description = transfer_description, amount_cents = -transfer_amount_cents,
      occurred_on = transfer_occurred_on, savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents < 0;
  if not found then raise exception 'Transfer source leg is not available.'; end if;
  update public.transactions
  set kind = destination_kind, category = null, category_id = null, subcategory_id = null,
      account_id = to_account_id, description = transfer_description, amount_cents = transfer_amount_cents,
      occurred_on = transfer_occurred_on, savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents > 0;
  if not found then raise exception 'Transfer destination leg is not available.'; end if;
  if old_source is distinct from from_account_id or old_destination is distinct from to_account_id then
    update public.transactions set transfer_account_type = case when amount_cents < 0 then source_type else destination_type end
    where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id;
  end if;
end;
$$;

create or replace function public.card_statement_payments(target_user_id bigint)
returns table (group_id uuid, account_id bigint, amount_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select t.transfer_group_id, max(t.account_id) filter (where t.amount_cents > 0),
    sum(t.amount_cents) filter (where t.amount_cents > 0)
  from public.transactions t
  left join public.accounts a on a.id = t.account_id and a.telegram_user_id = t.telegram_user_id
  where t.telegram_user_id = target_user_id and t.transfer_group_id is not null
  group by t.transfer_group_id
  having count(*) = 2 and sum(t.amount_cents) = 0
    and count(*) filter (where a.id is not null) = 2
    and count(*) filter (where t.amount_cents < 0 and t.transfer_account_type = 'bank') = 1
    and count(*) filter (where t.amount_cents > 0 and t.transfer_account_type = 'card' and a.account_type = 'card') = 1;
$$;

-- Existing insert IDs approximate capture order. Legacy rebaselines performed
-- before this migration have no recorded order and cannot be reconstructed.
create sequence if not exists public.card_statement_capture_order_seq;
grant usage, select on sequence public.card_statement_capture_order_seq to service_role;
alter table public.card_statement_snapshots add column if not exists capture_order bigint;
do $$
declare snapshot_id bigint;
begin
  for snapshot_id in select id from public.card_statement_snapshots where capture_order is null order by id loop
    update public.card_statement_snapshots set capture_order = nextval('public.card_statement_capture_order_seq') where id = snapshot_id;
  end loop;
end $$;
alter table public.card_statement_snapshots alter column capture_order set default nextval('public.card_statement_capture_order_seq');
alter table public.card_statement_snapshots alter column capture_order set not null;

-- A legacy re-entry is a new observation, not an observation at its old ID.
create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = '' as $$
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = public.card_statement_payment_baseline(target_user_id, s.account_id),
      capture_order = nextval('public.card_statement_capture_order_seq')
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id;
$$;

-- All capture entry points must take the same transaction lock before reading
-- the baseline or assigning an order. Hash collisions only serialize extra cards.
-- READ COMMITTED is required: a VOLATILE PL/pgSQL function's separate SQL
-- commands obtain fresh command snapshots, including after a lock wait. A
-- repeatable-read transaction would retain its older transaction snapshot.
create or replace function public.create_card_statement_snapshot(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language plpgsql volatile security invoker set search_path = '' as $$
declare result_id bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Card statement capture requires READ COMMITTED isolation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('card-statement:' || target_user_id::text || ':' || target_account_id::text, 0));
  insert into public.card_statement_snapshots
    (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
  select target_user_id, a.id, target_closing_date, target_due_date, target_original_cents, target_remaining_cents,
    public.card_statement_payment_baseline(target_user_id, a.id)
  from public.accounts a
  where a.telegram_user_id = target_user_id and a.id = target_account_id and a.account_type = 'card'
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language plpgsql volatile security invoker set search_path = '' as $$
declare result_id bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Card statement capture requires READ COMMITTED isolation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('card-statement:' || target_user_id::text || ':' || target_account_id::text, 0));
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = public.card_statement_payment_baseline(target_user_id, s.account_id),
      capture_order = nextval('public.card_statement_capture_order_seq')
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id into result_id;
  return result_id;
end;
$$;

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

-- Lock the parent before checking references. Foreign key checks on concurrent
-- inserts/updates take a key-share lock, so they cannot race this deletion.
create or replace function public.delete_unused_subcategory(p_user_id bigint, p_subcategory_id bigint)
returns text language plpgsql set search_path = public as $$
begin
  perform 1 from public.subcategories
    where id = p_subcategory_id and telegram_user_id = p_user_id for update;
  if not found then return 'not_found'; end if;

  if exists (select 1 from public.transactions where subcategory_id = p_subcategory_id)
    or exists (select 1 from public.recurring_rules where subcategory_id = p_subcategory_id)
    or exists (select 1 from public.budgets where subcategory_id = p_subcategory_id)
    or exists (select 1 from public.pending_transaction_captures where subcategory_id = p_subcategory_id)
  then return 'in_use'; end if;

  delete from public.subcategories where id = p_subcategory_id and telegram_user_id = p_user_id;
  return 'deleted';
end;
$$;
revoke all on function public.delete_unused_subcategory(bigint, bigint) from public, anon, authenticated;
grant execute on function public.delete_unused_subcategory(bigint, bigint) to service_role;
