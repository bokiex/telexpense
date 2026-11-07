-- Run after schema.sql: psql -v ON_ERROR_STOP=1 -f tests-sql/card-payment-classification.sql
begin;
insert into public.users (telegram_user_id) values (920001), (920002);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value values
  (920001, 920001, 'bank', 'Bank', 'bank'),
  (920002, 920001, 'cash', 'Cash', 'cash'),
  (920003, 920001, 'card', 'Card', 'card'),
  (920004, 920001, 'other-card', 'Other card', 'card'),
  (920005, 920002, 'other-user', 'Other user', 'bank');
insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents) values
  (920001, 'transfer', 920001, '10000000-0000-0000-0000-000000000001', 'Payment', -1000),
  (920001, 'transfer', 920003, '10000000-0000-0000-0000-000000000001', 'Payment', 1000),
  (920001, 'transfer', 920002, '10000000-0000-0000-0000-000000000002', 'Not payment', -2000),
  (920001, 'transfer', 920003, '10000000-0000-0000-0000-000000000002', 'Not payment', 2000);

do $$
declare g uuid := '10000000-0000-0000-0000-000000000001';
begin
  -- Owner-scoped references reject a cross-owned leg at insertion.
  begin
    insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents)
    values (920001, 'transfer', 920005, g, 'Cross-owned extra leg', 0);
    raise exception 'cross-owned account accepted';
  exception when foreign_key_violation then null;
  end;
  -- An extra same-owner leg still makes the group malformed and must not be
  -- hidden by the account join in payment classification.
  insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents)
  values (920001, 'transfer', 920002, g, 'Same-owner extra leg', 0);
  if exists (select 1 from public.card_statement_payments(920001) where group_id = g) then
    raise exception 'malformed group with an extra leg accepted';
  end if;
  delete from public.transactions where telegram_user_id = 920001 and transfer_group_id = g and amount_cents = 0;
  -- No snapshot has ever captured either group.
  update public.accounts set account_type = 'cash' where id = 920001;
  update public.accounts set account_type = 'bank' where id = 920002;
  if (select count(*) from public.card_statement_payments(920001)) <> 1
     or not exists (select 1 from public.card_statement_payments(920001) where group_id = g) then
    raise exception 'account type changes reclassified historical transfers';
  end if;
  perform public.update_transfer_group(920001, g, 920001, 920003, 'Amount edit', 1500, '2024-01-01', false);
  if not exists (select 1 from public.card_statement_payments(920001) where group_id = g and amount_cents = 1500) then
    raise exception 'same-account edit lost classification';
  end if;
  perform public.update_transfer_group(920001, g, 920002, 920003, 'Changed source', 1500, '2024-01-01', false);
  if not exists (select 1 from public.card_statement_payments(920001) where group_id = g) then
    raise exception 'account edit did not classify new bank source';
  end if;
  perform public.update_transfer_group(920001, g, 920001, 920004, 'Changed both', 1500, '2024-01-01', false);
  if exists (select 1 from public.card_statement_payments(920001) where group_id = g) then
    raise exception 'account edit retained old payment classification';
  end if;
  begin
    perform public.update_transfer_group(920001, g, 920005, 920003, 'Wrong owner', 1500, '2024-01-01', false);
    raise exception 'cross-user account accepted';
  exception when raise_exception then
    if sqlerrm <> 'Source account is not available.' then raise; end if;
  end;
end $$;

-- Both materialization entry points use the same insert-time classification.
insert into public.recurring_rules (id, telegram_user_id, name, rule_type, amount_cents, from_account_id, to_account_id, day_of_month)
overriding system value values (920001, 920001, 'Recurring payment', 'account_transfer', 3000, 920002, 920003, 1);
select * from public.materialize_recurring_transactions_for_user(920001, '2024-01', 100);
select * from public.materialize_recurring_transactions('2024-02', 100);
update public.accounts set account_type = 'cash' where id = 920002;
do $$ begin
  if (select count(*) from public.card_statement_payments(920001) p
      join public.transactions t on t.telegram_user_id = 920001 and t.transfer_group_id = p.group_id and t.amount_cents < 0
      where t.recurring_rule_id = 920001) <> 2 then
    raise exception 'recurring payments did not retain creation classification';
  end if;
  if exists (select 1 from public.card_statement_payments(920002)) then raise exception 'cross-user payment leak'; end if;
end $$;
rollback;
