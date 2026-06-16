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
  account_type text not null default 'bank' check (account_type in ('cash', 'bank', 'card', 'investment', 'other')),
  opening_balance_cents integer not null default 0,
  currency text not null default 'USD',
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
  account text not null,
  account_id bigint references public.accounts(id) on delete set null,
  description text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  category text not null,
  month text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
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

create index if not exists transactions_user_month_idx
  on public.transactions (telegram_user_id, occurred_on desc);

create index if not exists transactions_user_account_idx
  on public.transactions (telegram_user_id, account_id);

create index if not exists budgets_user_month_idx
  on public.budgets (telegram_user_id, month);

create index if not exists accounts_user_idx
  on public.accounts (telegram_user_id, account_key);

create index if not exists categories_user_idx
  on public.categories (telegram_user_id, source_key);

create index if not exists subcategories_user_category_idx
  on public.subcategories (telegram_user_id, category_id);

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.categories enable row level security;
alter table public.subcategories enable row level security;

-- The app uses a server-side Supabase secret/service-role key after validating Telegram initData.
-- No anon policies are required for the Mini App API flow.
