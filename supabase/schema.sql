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
