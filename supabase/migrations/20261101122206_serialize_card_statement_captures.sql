-- All capture entry points must take the same transaction lock before reading
-- the baseline or assigning an order. Hash collisions only serialize extra cards.
-- READ COMMITTED is required: a VOLATILE PL/pgSQL function's separate SQL
-- commands obtain fresh command snapshots, including after a lock wait. A
-- repeatable-read transaction would retain its older transaction snapshot.
create or replace function public.create_card_statement_snapshot(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language plpgsql volatile security invoker set search_path = '' as $$
declare result_id bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Card statement capture requires READ COMMITTED isolation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('card-statement:' || target_user_id::text || ':' || target_account_id::text, 0));
  insert into public.card_statement_snapshots
    (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
  select target_user_id, a.id, target_closing_date, target_due_date, target_original_cents, target_remaining_cents,
    public.card_statement_payment_baseline(target_user_id, a.id)
  from public.accounts a
  where a.telegram_user_id = target_user_id and a.id = target_account_id and a.account_type = 'card'
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.rebaseline_legacy_card_statement(
  target_user_id bigint, target_account_id bigint, target_closing_date date,
  target_due_date date, target_original_cents integer, target_remaining_cents integer
) returns bigint language plpgsql volatile security invoker set search_path = '' as $$
declare result_id bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Card statement capture requires READ COMMITTED isolation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('card-statement:' || target_user_id::text || ':' || target_account_id::text, 0));
  update public.card_statement_snapshots s
  set due_date = target_due_date, original_amount_cents = target_original_cents,
      remaining_amount_cents = target_remaining_cents,
      payment_baseline = public.card_statement_payment_baseline(target_user_id, s.account_id),
      capture_order = nextval('public.card_statement_capture_order_seq')
  where s.telegram_user_id = target_user_id and s.account_id = target_account_id
    and s.closing_date = target_closing_date and s.payment_baseline is null
    and exists (select 1 from public.accounts a where a.id = s.account_id
      and a.telegram_user_id = target_user_id and a.account_type = 'card')
  returning s.id into result_id;
  return result_id;
end;
$$;
