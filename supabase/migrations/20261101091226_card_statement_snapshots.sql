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
