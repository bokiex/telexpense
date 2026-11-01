-- NULL denotes a legacy snapshot whose historical payment amounts are unknown.
alter table public.card_statement_snapshots
  add column if not exists payment_baseline jsonb;

-- Exactly two owned, balanced legs, from a bank to a card. A changed or
-- deleted group disappears here but remains in the immutable snapshot baseline.
create or replace function public.card_statement_payments(target_user_id bigint)
returns table (group_id uuid, account_id bigint, amount_cents bigint)
language sql stable security invoker set search_path = ''
as $$
  select t.transfer_group_id,
    max(t.account_id) filter (where a.account_type = 'card' and t.amount_cents > 0),
    sum(t.amount_cents) filter (where a.account_type = 'card' and t.amount_cents > 0)
  from public.transactions t
  left join public.accounts a on a.id = t.account_id and a.telegram_user_id = t.telegram_user_id
  where t.telegram_user_id = target_user_id and t.transfer_group_id is not null
  group by t.transfer_group_id
  having count(*) = 2 and sum(t.amount_cents) = 0
    and count(*) filter (where a.account_type = 'bank' and t.amount_cents < 0) = 1
    and count(*) filter (where a.account_type = 'card' and t.amount_cents > 0) = 1;
$$;

-- One statement-level MVCC snapshot captures both the insertion and all groups.
create or replace function public.create_card_statement_snapshot(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = ''
as $$
  insert into public.card_statement_snapshots
    (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
  select target_user_id, a.id, target_closing_date, target_due_date, target_original_cents, target_remaining_cents,
    coalesce((select jsonb_agg(jsonb_build_object('groupId', p.group_id, 'amountCents', p.amount_cents) order by p.group_id)
              from public.card_statement_payments(target_user_id) p where p.account_id = a.id), '[]'::jsonb)
  from public.accounts a
  where a.telegram_user_id = target_user_id and a.id = target_account_id and a.account_type = 'card'
  returning id;
$$;

-- Explicitly re-enter a legacy snapshot using an authoritative current amount.
-- Never overwrite a snapshot whose baseline is already known.
create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = ''
as $$
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = coalesce((select jsonb_agg(jsonb_build_object('groupId', p.group_id, 'amountCents', p.amount_cents) order by p.group_id)
        from public.card_statement_payments(target_user_id) p where p.account_id = s.account_id), '[]'::jsonb)
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id;
$$;

-- A single database statement gives status a consistent view of statements and
-- grouped transfers, even while another request edits or deletes a payment.
create or replace function public.read_card_statement_inputs(target_user_id bigint)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.closing_date, s.id)
      from public.card_statement_snapshots s where s.telegram_user_id = target_user_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('groupId', p.group_id, 'accountId', p.account_id, 'amountCents', p.amount_cents))
      from public.card_statement_payments(target_user_id) p), '[]'::jsonb)
  );
$$;

revoke all on function public.card_statement_payments(bigint) from public, anon, authenticated;
revoke all on function public.create_card_statement_snapshot(bigint, bigint, date, date, integer, integer) from public, anon, authenticated;
revoke all on function public.read_card_statement_inputs(bigint) from public, anon, authenticated;
revoke all on function public.rebaseline_legacy_card_statement(bigint, bigint, date, date, integer, integer) from public, anon, authenticated;
grant execute on function public.card_statement_payments(bigint) to service_role;
grant execute on function public.create_card_statement_snapshot(bigint, bigint, date, date, integer, integer) to service_role;
grant execute on function public.read_card_statement_inputs(bigint) to service_role;
grant execute on function public.rebaseline_legacy_card_statement(bigint, bigint, date, date, integer, integer) to service_role;
