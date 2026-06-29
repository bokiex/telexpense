alter table public.transactions
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete set null;

update public.transactions t
   set subcategory_id = null
 where subcategory_id is not null
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

drop function if exists public.consume_pending_transaction_capture(bigint, text, bigint);

create or replace function public.consume_pending_transaction_capture(
  p_telegram_user_id bigint,
  p_token text,
  p_account_id bigint,
  p_expected_category_id bigint,
  p_expected_subcategory_id bigint
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
  select *
    into capture
    from public.pending_transaction_captures
   where telegram_user_id = p_telegram_user_id
     and token = p_token
     and expires_at > now()
   for update;

  if not found then
    return null;
  end if;
  if capture.category_id is distinct from p_expected_category_id
     or capture.subcategory_id is distinct from p_expected_subcategory_id then
    return null;
  end if;

  select c.source_name
    into category_source_name
    from public.categories c
    join public.subcategories s
      on s.category_id = c.id
     and s.telegram_user_id = p_telegram_user_id
   where c.id = capture.category_id
     and c.telegram_user_id = p_telegram_user_id
     and c.active
     and s.id = capture.subcategory_id;

  select a.name
    into account_name
    from public.accounts a
   where a.id = p_account_id
     and a.telegram_user_id = p_telegram_user_id
     and a.active;

  if category_source_name is null or account_name is null then
    raise exception 'Pending transaction selection is not available';
  end if;

  delete from public.pending_transaction_captures
   where telegram_user_id = p_telegram_user_id
     and token = p_token;

  insert into public.transactions (
    telegram_user_id, kind, category, category_id, subcategory_id, account_id,
    description, amount_cents, currency
  ) values (
    p_telegram_user_id, 'expense', category_source_name, capture.category_id,
    capture.subcategory_id, p_account_id, capture.description,
    capture.amount_cents, capture.currency
  )
  returning id into transaction_id;

  return transaction_id;
end;
$$;
