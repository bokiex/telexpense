create table if not exists public.users (
  telegram_user_id bigint primary key,
  first_name text,
  username text,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id bigint primary key generated always as identity,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'investment', 'transfer')),
  category text not null,
  account text not null,
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

create index if not exists transactions_user_month_idx
  on public.transactions (telegram_user_id, occurred_on desc);

create index if not exists budgets_user_month_idx
  on public.budgets (telegram_user_id, month);

alter table public.users enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

-- The app uses a server-side Supabase secret/service-role key after validating Telegram initData.
-- No anon policies are required for the Mini App API flow.

