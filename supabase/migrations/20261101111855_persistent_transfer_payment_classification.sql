-- Preserve the account roles at the time a transfer is made, rather than
-- inferring payment status from mutable account metadata or statement history.
alter table public.transactions add column if not exists transfer_account_type text;

-- Captured baselines establish the destination card role even if the card was
-- reclassified. A captured source identity also establishes the bank role;
-- source-less old baselines cannot establish a non-bank source was a payment.
update public.transactions t
set transfer_account_type = case
  when t.amount_cents > 0 and exists (
    select 1 from public.card_statement_snapshots s
    where s.telegram_user_id = t.telegram_user_id and s.account_id = t.account_id
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object('groupId', t.transfer_group_id::text))
  ) then 'card'
  when t.amount_cents < 0 and exists (
    select 1 from public.transactions destination
    join public.card_statement_snapshots s
      on s.telegram_user_id = t.telegram_user_id and s.account_id = destination.account_id
    where destination.telegram_user_id = t.telegram_user_id
      and destination.transfer_group_id = t.transfer_group_id and destination.amount_cents > 0
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object(
        'groupId', t.transfer_group_id::text, 'sourceAccountId', t.account_id))
  ) then 'bank'
  else a.account_type end
from public.accounts a
where t.transfer_group_id is not null and t.transfer_account_type is null
  and a.id = t.account_id and a.telegram_user_id = t.telegram_user_id;

-- The trigger covers both ordinary grouped inserts and both recurring
-- materializers. Account metadata changes never rewrite historical roles.
create or replace function public.capture_transfer_account_type()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.transfer_group_id is null then
    new.transfer_account_type := null;
  elsif tg_op = 'INSERT' or old.account_id is distinct from new.account_id
      or old.transfer_group_id is distinct from new.transfer_group_id
      or old.telegram_user_id is distinct from new.telegram_user_id then
    select a.account_type into new.transfer_account_type from public.accounts a
    where a.id = new.account_id and a.telegram_user_id = new.telegram_user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists capture_transfer_account_type on public.transactions;
create trigger capture_transfer_account_type before insert or update on public.transactions
for each row execute function public.capture_transfer_account_type();

-- Reclassify both roles only when an edit changes either account identity.
-- Amount, date and description edits preserve the original classification.
create or replace function public.update_transfer_group(
  target_user_id bigint, target_transfer_group_id uuid, from_account_id bigint,
  to_account_id bigint, transfer_description text, transfer_amount_cents integer,
  transfer_occurred_on date, transfer_savings_allocation boolean
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  destination_kind text;
  source_type text;
  destination_type text;
  old_source bigint;
  old_destination bigint;
begin
  perform 1 from public.transactions where telegram_user_id = target_user_id
    and transfer_group_id = target_transfer_group_id order by id for update;
  if (select count(*) <> 2 from public.transactions where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id) then
    raise exception 'Transfer group is not available.';
  end if;
  select max(account_id) filter (where amount_cents < 0), max(account_id) filter (where amount_cents > 0)
    into old_source, old_destination from public.transactions
    where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id;
  select account_type into source_type from public.accounts where telegram_user_id = target_user_id and id = from_account_id;
  select account_type into destination_type from public.accounts where telegram_user_id = target_user_id and id = to_account_id;
  if source_type is null then raise exception 'Source account is not available.'; end if;
  if destination_type is null then raise exception 'Destination account is not available.'; end if;
  destination_kind := case when destination_type = 'investment' then 'investment' else 'transfer' end;
  update public.transactions
  set kind = 'expense', category = null, category_id = null, subcategory_id = null,
      account_id = from_account_id, description = transfer_description, amount_cents = -transfer_amount_cents,
      occurred_on = transfer_occurred_on, savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents < 0;
  if not found then raise exception 'Transfer source leg is not available.'; end if;
  update public.transactions
  set kind = destination_kind, category = null, category_id = null, subcategory_id = null,
      account_id = to_account_id, description = transfer_description, amount_cents = transfer_amount_cents,
      occurred_on = transfer_occurred_on, savings_allocation = transfer_savings_allocation
  where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents > 0;
  if not found then raise exception 'Transfer destination leg is not available.'; end if;
  if old_source is distinct from from_account_id or old_destination is distinct from to_account_id then
    update public.transactions set transfer_account_type = case when amount_cents < 0 then source_type else destination_type end
    where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id;
  end if;
end;
$$;

create or replace function public.card_statement_payments(target_user_id bigint)
returns table (group_id uuid, account_id bigint, amount_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select t.transfer_group_id, max(t.account_id) filter (where t.amount_cents > 0),
    sum(t.amount_cents) filter (where t.amount_cents > 0)
  from public.transactions t
  left join public.accounts a on a.id = t.account_id and a.telegram_user_id = t.telegram_user_id
  where t.telegram_user_id = target_user_id and t.transfer_group_id is not null
  group by t.transfer_group_id
  having count(*) = 2 and sum(t.amount_cents) = 0
    and count(*) filter (where a.id is not null) = 2
    and count(*) filter (where t.amount_cents < 0 and t.transfer_account_type = 'bank') = 1
    and count(*) filter (where t.amount_cents > 0 and t.transfer_account_type = 'card' and a.account_type = 'card') = 1;
$$;
