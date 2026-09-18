alter table public.transactions
  add column if not exists savings_allocation boolean not null default false;

drop function if exists public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date);
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
      amount_cents = -transfer_amount_cents, occurred_on = transfer_occurred_on,
      savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents < 0;
  if not found then raise exception 'Transfer source leg is not available.'; end if;
  update public.transactions
  set kind = destination_kind, category = null, category_id = null, subcategory_id = null,
      account_id = to_account_id, description = transfer_description,
      amount_cents = transfer_amount_cents, occurred_on = transfer_occurred_on,
      savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents > 0;
  if not found then raise exception 'Transfer destination leg is not available.'; end if;
end;
$$;

revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) from public;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) from anon;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) from authenticated;
grant execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date, boolean) to service_role;
