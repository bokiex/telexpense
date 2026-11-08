alter table public.pending_transaction_captures
  add column if not exists version integer not null default 0;

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
  if capture.version is distinct from p_expected_version then
    return null;
  end if;

  select c.source_name into category_source_name
    from public.categories c
   where c.id = p_expected_category_id and c.telegram_user_id = p_telegram_user_id
     and c.active
     and (p_expected_subcategory_id is null or exists (
       select 1 from public.subcategories s
        where s.id = p_expected_subcategory_id
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
    p_telegram_user_id, capture.kind, category_source_name, p_expected_category_id,
    p_expected_subcategory_id, p_account_id, capture.description, capture.amount_cents
  ) returning id into transaction_id;
  return transaction_id;
end;
$$;
revoke all on function public.consume_pending_transaction_capture(bigint, text, bigint, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.consume_pending_transaction_capture(bigint, text, bigint, bigint, bigint, integer) to service_role;
