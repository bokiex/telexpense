-- Existing insert IDs approximate capture order. Legacy rebaselines performed
-- before this migration have no recorded order and cannot be reconstructed.
create sequence if not exists public.card_statement_capture_order_seq;
grant usage, select on sequence public.card_statement_capture_order_seq to service_role;
alter table public.card_statement_snapshots add column if not exists capture_order bigint;
do $$
declare snapshot_id bigint;
begin
  for snapshot_id in select id from public.card_statement_snapshots where capture_order is null order by id loop
    update public.card_statement_snapshots set capture_order = nextval('public.card_statement_capture_order_seq') where id = snapshot_id;
  end loop;
end $$;
alter table public.card_statement_snapshots alter column capture_order set default nextval('public.card_statement_capture_order_seq');
alter table public.card_statement_snapshots alter column capture_order set not null;

-- A legacy re-entry is a new observation, not an observation at its old ID.
create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language sql volatile security invoker set search_path = '' as $$
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = public.card_statement_payment_baseline(target_user_id, s.account_id),
      capture_order = nextval('public.card_statement_capture_order_seq')
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id;
$$;
