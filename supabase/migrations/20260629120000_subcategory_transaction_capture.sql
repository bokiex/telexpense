alter table public.transactions
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete set null;

create index if not exists transactions_user_subcategory_date_idx
  on public.transactions (telegram_user_id, subcategory_id, occurred_on desc, id desc);

create table if not exists public.pending_transaction_captures (
  token text primary key,
  telegram_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  description text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  category_id bigint references public.categories(id) on delete cascade,
  subcategory_id bigint references public.subcategories(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_transaction_captures_user_expiry_idx
  on public.pending_transaction_captures (telegram_user_id, expires_at);

alter table public.pending_transaction_captures enable row level security;
