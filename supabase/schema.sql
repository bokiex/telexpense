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
  currency text not null default 'SGD',
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
  category text not null,
  category_id bigint,
  account_id bigint references public.accounts(id) on delete set null,
  transfer_group_id uuid,
  recurring_rule_id bigint,
  description text not null,
  amount_cents integer not null,
  currency text not null default 'SGD',
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_snapshots (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  account_id bigint not null references public.accounts(id) on delete cascade,
  month text not null,
  portfolio_value_cents integer not null,
  currency text not null default 'SGD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id, account_id, month)
);

create table if not exists public.recurring_rules (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  name text not null,
  rule_type text not null check (rule_type in ('subscription', 'investment_transfer', 'loan_payment')),
  amount_cents integer not null,
  currency text not null default 'SGD',
  category text not null,
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
  amount_cents integer not null,
  currency text not null default 'SGD',
  unique (telegram_user_id, category, month)
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

alter table public.transactions
  add column if not exists account_id bigint references public.accounts(id) on delete set null;

alter table public.transactions
  add column if not exists transfer_group_id uuid;

alter table public.transactions
  add column if not exists recurring_rule_id bigint references public.recurring_rules(id) on delete set null;

alter table public.transactions
  add column if not exists category_id bigint references public.categories(id) on delete set null;

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

create index if not exists recurring_rule_runs_user_month_idx
  on public.recurring_rule_runs (telegram_user_id, month);

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.categories enable row level security;
alter table public.subcategories enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.recurring_rule_runs enable row level security;

create or replace function public.normalize_identity(value text)
returns text language sql immutable strict parallel safe
set search_path = public
as $$ select lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) $$;

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
on conflict do nothing;

update public.transactions t set category_id = c.id
from public.categories c
where t.category_id is null
  and c.telegram_user_id = t.telegram_user_id
  and public.normalize_identity(c.source_name) = public.normalize_identity(t.category);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'account'
  ) then
    execute $sql$
      insert into public.accounts (telegram_user_id, account_key, name, account_type, currency, color, icon)
      select distinct telegram_user_id, public.normalize_identity(account),
        initcap(public.normalize_identity(account)), 'bank', upper(currency), '#60a5fa', 'Wallet'
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

insert into public.accounts (telegram_user_id, account_key, name, account_type, currency, color, icon)
select u.telegram_user_id, 'debit card', 'Debit Card', 'bank', 'SGD', '#60a5fa', 'Wallet'
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
  insert into public.accounts (telegram_user_id, account_key, name, account_type, currency, color, icon)
  values (new.telegram_user_id, 'debit card', 'Debit Card', 'bank', 'SGD', '#60a5fa', 'Wallet')
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
alter table public.accounts add constraint accounts_liability_opening_balance_check
  check (account_type not in ('loan', 'card') or opening_balance_cents <= 0);

create unique index if not exists categories_user_canonical_name_uidx
  on public.categories (telegram_user_id, public.normalize_identity(source_name));
create unique index if not exists categories_user_canonical_key_uidx
  on public.categories (telegram_user_id, public.normalize_identity(source_key));
create unique index if not exists subcategories_user_canonical_name_uidx
  on public.subcategories (telegram_user_id, category_id, public.normalize_identity(name));
create index if not exists transactions_user_category_date_idx
  on public.transactions (telegram_user_id, category_id, occurred_on desc, id desc);

create or replace function public.materialize_recurring_transactions(
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language sql volatile security invoker set search_path = public
as $$
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
    where r.active
      and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and batch_size between 1 and 500
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
    select telegram_user_id, id, target_month, run_group_id from candidates
    on conflict (telegram_user_id, recurring_rule_id, month) do nothing
    returning telegram_user_id, recurring_rule_id, transfer_group_id
  ),
  claimed_rules as (
    select r.*, c.transfer_group_id
    from claimed c
    join public.recurring_rules r
      on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id
  ),
  inserted_transactions as (
    insert into public.transactions (
      telegram_user_id, kind, category, category_id, account_id,
      transfer_group_id, recurring_rule_id, description, amount_cents,
      currency, occurred_on
    )
    select r.telegram_user_id,
           case
             when leg.destination then
               case when r.rule_type = 'investment_transfer' then 'investment' else 'transfer' end
             when r.rule_type = 'investment_transfer' then 'transfer'
             else 'expense'
           end,
           r.category,
           category_match.id,
           case when leg.destination then r.to_account_id else r.from_account_id end,
           r.transfer_group_id,
           r.id,
           r.name,
           case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
           r.currency,
           (
             target_month || '-' ||
             lpad(least(r.day_of_month, extract(day from (
               (target_month || '-01')::date + interval '1 month - 1 day'
             )))::integer::text, 2, '0')
           )::date
    from claimed_rules r
    cross join lateral (values (false), (true)) as leg(destination)
    left join lateral (
      select c.id from public.categories c
      where c.telegram_user_id = r.telegram_user_id
        and public.normalize_identity(c.source_name) = public.normalize_identity(r.category)
      limit 1
    ) category_match on true
    where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
    returning recurring_rule_id
  )
  select count(distinct telegram_user_id)::bigint, count(*)::bigint from claimed
$$;

revoke execute on function public.materialize_recurring_transactions(text, integer) from public;
revoke execute on function public.materialize_recurring_transactions(text, integer) from anon;
revoke execute on function public.materialize_recurring_transactions(text, integer) from authenticated;
grant execute on function public.materialize_recurring_transactions(text, integer) to service_role;

create or replace function public.account_transaction_balances(target_user_id bigint)
returns table(account_id bigint, balance_cents bigint)
language sql stable security invoker set search_path = public
as $$
  select t.account_id, coalesce(sum(t.amount_cents), 0)::bigint
  from public.transactions t
  where t.telegram_user_id = target_user_id and t.account_id is not null
  group by t.account_id
$$;

-- The app uses a server-side Supabase secret/service-role key after validating Telegram initData.
-- No anon policies are required for the Mini App API flow.
