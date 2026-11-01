-- Exercises upgrade of old transfers; run after schema.sql in a disposable database.
begin;
insert into public.users (telegram_user_id) values (930001);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value values
  (930001, 930001, 'cash', 'Former bank', 'cash'),
  (930002, 930001, 'card', 'Card', 'card');
insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents) values
  (930001, 'transfer', 930001, '20000000-0000-0000-0000-000000000001', 'Captured', -1000),
  (930001, 'transfer', 930002, '20000000-0000-0000-0000-000000000001', 'Captured', 1000),
  (930001, 'transfer', 930001, '20000000-0000-0000-0000-000000000002', 'Unknown', -2000),
  (930001, 'transfer', 930002, '20000000-0000-0000-0000-000000000002', 'Unknown', 2000);
insert into public.card_statement_snapshots (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
values (930001, 930002, '2024-01-31', '2024-02-20', 5000, 4000,
  '[{"groupId":"20000000-0000-0000-0000-000000000001","amountCents":1000,"sourceAccountId":930001},{"groupId":"20000000-0000-0000-0000-000000000002","amountCents":2000}]');
drop trigger capture_transfer_account_type on public.transactions;
update public.transactions set transfer_account_type = null where telegram_user_id = 930001;
\ir ../supabase/migrations/20261101111855_persistent_transfer_payment_classification.sql
-- A second execution must not reinterpret existing classifications.
update public.accounts set account_type = 'bank' where id = 930001;
\ir ../supabase/migrations/20261101111855_persistent_transfer_payment_classification.sql
do $$ begin
  if (select count(*) from public.card_statement_payments(930001)) <> 1
     or not exists (select 1 from public.card_statement_payments(930001) where group_id = '20000000-0000-0000-0000-000000000001') then
    raise exception 'backfill guessed or lost historical payment identity';
  end if;
end $$;
rollback;
