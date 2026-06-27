-- Canonical identity is trimmed, whitespace-collapsed lowercase text.
create or replace function public.normalize_identity(value text)
returns text
language sql
immutable
strict
parallel safe
as $$ select lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) $$;

-- Liabilities always carry a negative opening balance.
update public.accounts
set opening_balance_cents = -abs(opening_balance_cents),
    updated_at = now()
where account_type in ('loan', 'card')
  and opening_balance_cents > 0;

alter table public.accounts drop constraint if exists accounts_liability_opening_balance_check;
alter table public.accounts
  add constraint accounts_liability_opening_balance_check
  check (account_type not in ('loan', 'card') or opening_balance_cents <= 0) not valid;
alter table public.accounts validate constraint accounts_liability_opening_balance_check;

-- Normalize category-bearing tables before enforcing uniqueness.
alter table public.categories drop constraint if exists categories_telegram_user_id_source_key_key;
alter table public.subcategories drop constraint if exists subcategories_telegram_user_id_category_id_name_key;
alter table public.budgets drop constraint if exists budgets_telegram_user_id_category_month_key;

create temporary table category_merge_by_key on commit drop as
select id, min(id) over (
  partition by telegram_user_id, public.normalize_identity(source_key)
) keeper
from public.categories;

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
from public.categories;

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
    updated_at = now();
update public.transactions set category = public.normalize_identity(category);
update public.budgets set category = public.normalize_identity(category);
update public.recurring_rules set category = public.normalize_identity(category);
update public.subcategories set name = btrim(regexp_replace(name, '\s+', ' ', 'g'));

delete from public.subcategories a
using public.subcategories b
where a.id > b.id
  and a.telegram_user_id = b.telegram_user_id
  and a.category_id = b.category_id
  and public.normalize_identity(a.name) = public.normalize_identity(b.name);

delete from public.categories a
using public.categories b
where a.id > b.id
  and a.telegram_user_id = b.telegram_user_id
  and public.normalize_identity(a.source_name) = public.normalize_identity(b.source_name);

-- Existing duplicate budgets are conservatively combined.
with combined as (
  select telegram_user_id, public.normalize_identity(category) category, month,
         sum(amount_cents)::integer amount_cents, min(currency) currency
  from public.budgets
  group by telegram_user_id, public.normalize_identity(category), month
), removed as (
  delete from public.budgets returning *
)
insert into public.budgets (telegram_user_id, category, month, amount_cents, currency)
select telegram_user_id, category, month, amount_cents, currency from combined;

alter table public.transactions add column if not exists category_id bigint references public.categories(id) on delete set null;

update public.transactions t
set category_id = c.id
from public.categories c
where c.telegram_user_id = t.telegram_user_id
  and public.normalize_identity(c.source_name) = public.normalize_identity(t.category);

create unique index if not exists categories_user_canonical_name_uidx
  on public.categories (telegram_user_id, public.normalize_identity(source_name));
create unique index if not exists categories_user_canonical_key_uidx
  on public.categories (telegram_user_id, public.normalize_identity(source_key));
create unique index if not exists subcategories_user_canonical_name_uidx
  on public.subcategories (telegram_user_id, category_id, public.normalize_identity(name));
create index if not exists transactions_user_category_date_idx
  on public.transactions (telegram_user_id, category_id, occurred_on desc, id desc);
create index if not exists transactions_user_history_idx
  on public.transactions (telegram_user_id, occurred_on desc, id desc);

create or replace function public.account_transaction_balances(target_user_id bigint)
returns table(account_id bigint, balance_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.account_id, coalesce(sum(t.amount_cents), 0)::bigint
  from public.transactions t
  where t.telegram_user_id = target_user_id and t.account_id is not null
  group by t.account_id
$$;
