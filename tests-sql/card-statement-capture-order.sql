-- Exercise the upgrade against schema.sql in a disposable database.
begin;
insert into public.users (telegram_user_id) values (940001);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value
values (940001, 940001, 'card', 'Card', 'card');
alter table public.card_statement_snapshots drop column capture_order;
drop sequence public.card_statement_capture_order_seq;
insert into public.card_statement_snapshots (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
values (940001, 940001, '2024-02-29', '2024-03-20', 10000, 10000, '[]'),
       (940001, 940001, '2024-01-31', '2024-02-20', 10000, 10000, null);
\ir ../supabase/migrations/20261101120826_card_statement_capture_order.sql
do $$
declare feb_order bigint; jan_order bigint;
begin
  select capture_order into feb_order from public.card_statement_snapshots where telegram_user_id = 940001 and closing_date = '2024-02-29';
  select capture_order into jan_order from public.card_statement_snapshots where telegram_user_id = 940001 and closing_date = '2024-01-31';
  if feb_order >= jan_order then raise exception 'upgrade did not preserve insertion order'; end if;
  perform public.rebaseline_legacy_card_statement(940001, 940001, '2024-01-31', '2024-02-20', 10000, 10000);
  if (select capture_order from public.card_statement_snapshots where telegram_user_id = 940001 and closing_date = '2024-01-31') <= jan_order then
    raise exception 'legacy re-entry did not advance capture order';
  end if;
end $$;
rollback;
