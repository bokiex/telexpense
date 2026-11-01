-- Older baselines lack source identity. Do not guess it from a potentially
-- edited transfer: only baselines captured below can preserve a non-bank source.
create or replace function public.card_statement_payments(target_user_id bigint)
returns table (group_id uuid, account_id bigint, amount_cents bigint)
language sql stable security invoker set search_path = ''
as $$
  with groups as (
    select t.transfer_group_id as group_id,
      max(t.account_id) filter (where a.account_type = 'card' and t.amount_cents > 0) as account_id,
      max(t.account_id) filter (where a.id is not null and t.amount_cents < 0) as source_account_id,
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
      and s.payment_baseline @> jsonb_build_array(jsonb_build_object('groupId', g.group_id::text, 'sourceAccountId', g.source_account_id))
  );
$$;

-- Payments are validated by card_statement_payments; the negative leg is unique.
create or replace function public.card_statement_payment_baseline(target_user_id bigint, target_account_id bigint)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('groupId', p.group_id, 'amountCents', p.amount_cents,
    'sourceAccountId', t.account_id) order by p.group_id), '[]'::jsonb)
  from public.card_statement_payments(target_user_id) p
  join public.transactions t on t.telegram_user_id = target_user_id and t.transfer_group_id = p.group_id and t.amount_cents < 0
  where p.account_id = target_account_id;
$$;

create or replace function public.create_card_statement_snapshot(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = ''
as $$
  insert into public.card_statement_snapshots
    (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
  select target_user_id, a.id, target_closing_date, target_due_date, target_original_cents, target_remaining_cents,
    public.card_statement_payment_baseline(target_user_id, a.id)
  from public.accounts a
  where a.telegram_user_id = target_user_id and a.id = target_account_id and a.account_type = 'card'
  returning id;
$$;

create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = ''
as $$
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = public.card_statement_payment_baseline(target_user_id, s.account_id)
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id;
$$;

revoke all on function public.card_statement_payment_baseline(bigint, bigint) from public, anon, authenticated;
grant execute on function public.card_statement_payment_baseline(bigint, bigint) to service_role;
