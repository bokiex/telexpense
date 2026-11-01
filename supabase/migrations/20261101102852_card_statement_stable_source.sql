-- Recognize current bank-to-card payments and payments captured on the same
-- card's baseline even if their source account type later changes. New non-bank
-- transfers are not payments. Both legs must remain owned and balanced.
create or replace function public.card_statement_payments(target_user_id bigint)
returns table (group_id uuid, account_id bigint, amount_cents bigint)
language sql stable security invoker set search_path = ''
as $$
  with groups as (
    select t.transfer_group_id as group_id,
      max(t.account_id) filter (where a.account_type = 'card' and t.amount_cents > 0) as account_id,
      sum(t.amount_cents) filter (where a.account_type = 'card' and t.amount_cents > 0) as amount_cents,
      bool_or(a.account_type = 'bank' and t.amount_cents < 0) as bank_source
    from public.transactions t
    left join public.accounts a on a.id = t.account_id and a.telegram_user_id = t.telegram_user_id
    where t.telegram_user_id = target_user_id and t.transfer_group_id is not null
    group by t.transfer_group_id
    having count(*) = 2 and sum(t.amount_cents) = 0
      and count(*) filter (where a.id is not null and t.amount_cents < 0) = 1
      and count(*) filter (where a.account_type = 'card' and t.amount_cents > 0) = 1
  )
  select g.group_id, g.account_id, g.amount_cents
  from groups g
  where g.bank_source or exists (
    select 1 from public.card_statement_snapshots s
    where s.telegram_user_id = target_user_id and s.account_id = g.account_id
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object('groupId', g.group_id::text))
  );
$$;
