-- Run against a disposable database with schema.sql applied, e.g. psql -1 -v ON_ERROR_STOP=1 -f this-file.
begin;
insert into public.users (telegram_user_id) values (910001), (910002);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value values
  (910001, 910001, 'test-bank', 'Bank', 'bank'),
  (910002, 910001, 'test-card', 'Card', 'card'),
  (910003, 910002, 'test-card', 'Other card', 'card'),
  (910004, 910001, 'test-cash', 'Cash', 'cash'),
  (910005, 910001, 'test-card-2', 'Second card', 'card');
insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents) values
  (910001, 'transfer', 910001, '00000000-0000-0000-0000-000000000001', 'Payment', -3000),
  (910001, 'transfer', 910002, '00000000-0000-0000-0000-000000000001', 'Payment', 3000),
  (910001, 'transfer', 910002, '00000000-0000-0000-0000-000000000002', 'Invalid group', 6000),
  (910001, 'transfer', 910004, '00000000-0000-0000-0000-000000000003', 'Cash transfer', -2000),
  (910001, 'transfer', 910002, '00000000-0000-0000-0000-000000000003', 'Cash transfer', 2000);

do $$
declare snapshot_id bigint; data jsonb;
begin
  snapshot_id := public.create_card_statement_snapshot(910001, 910002, '2024-01-31', '2024-02-20', 10000, 8000);
  if snapshot_id is null then raise exception 'snapshot not created'; end if;
  if public.create_card_statement_snapshot(910001, 910003, '2024-01-31', '2024-02-20', 10000, 8000) is not null then
    raise exception 'cross-user card accepted';
  end if;
  data := public.read_card_statement_inputs(910001);
  if data->'statements'->0->'payment_baseline' <> '[{"groupId":"00000000-0000-0000-0000-000000000001","amountCents":3000,"sourceAccountId":910001}]'::jsonb then
    raise exception 'baseline was not captured: %', data;
  end if;
  if jsonb_array_length(data->'payments') <> 1 then raise exception 'invalid group counted'; end if;
  update public.accounts set account_type = 'cash' where id = 910001 and telegram_user_id = 910001;
  data := public.read_card_statement_inputs(910001);
  if jsonb_array_length(data->'payments') <> 1 or (data->'payments'->0->>'amountCents')::integer <> 3000 then
    raise exception 'source account type change lost a historical payment';
  end if;
  -- Pre-upgrade baselines contain no trustworthy source identity; do not guess.
  update public.card_statement_snapshots set payment_baseline = '[{"groupId":"00000000-0000-0000-0000-000000000001","amountCents":3000}]'::jsonb where id = snapshot_id;
  if jsonb_array_length(public.read_card_statement_inputs(910001)->'payments') <> 0 then
    raise exception 'source-less historical baseline guessed a non-bank source';
  end if;
  update public.card_statement_snapshots set payment_baseline = data->'statements'->0->'payment_baseline' where id = snapshot_id;
  insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents) values
    (910001, 'transfer', 910001, '00000000-0000-0000-0000-000000000004', 'New cash transfer', -1000),
    (910001, 'transfer', 910002, '00000000-0000-0000-0000-000000000004', 'New cash transfer', 1000);
  if jsonb_array_length(public.read_card_statement_inputs(910001)->'payments') <> 1 then
    raise exception 'new non-bank transfer counted';
  end if;
  update public.transactions set account_id = 910004
    where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000001' and amount_cents < 0;
  if jsonb_array_length(public.read_card_statement_inputs(910001)->'payments') <> 0 then
    raise exception 'different non-bank source recognized as captured payment';
  end if;
  update public.transactions set account_id = 910001
    where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000001' and amount_cents < 0;
  update public.transactions set amount_cents = case when amount_cents < 0 then -1500 else 1500 end
    where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000001';
  data := public.read_card_statement_inputs(910001);
  if (data->'payments'->0->>'amountCents')::integer <> 1500 then raise exception 'captured payment edit lost'; end if;
  update public.transactions set account_id = 910005
    where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000001' and amount_cents > 0;
  if jsonb_array_length(public.read_card_statement_inputs(910001)->'payments') <> 0 then
    raise exception 'baseline on a different card recognized non-bank transfer';
  end if;
  update public.transactions set account_id = 910002
    where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000001' and amount_cents > 0;
  update public.transactions set amount_cents = case when amount_cents < 0 then -3000 else 3000 end
    where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000001';
  update public.accounts set account_type = 'bank' where id = 910001 and telegram_user_id = 910001;
  delete from public.transactions where telegram_user_id = 910001 and transfer_group_id = '00000000-0000-0000-0000-000000000004';
  if jsonb_array_length(public.read_card_statement_inputs(910002)->'statements') <> 0 then raise exception 'cross-user leak'; end if;
  if public.rebaseline_legacy_card_statement(910001, 910002, '2024-01-31', '2024-02-20', 10000, 7000) is not null then
    raise exception 'known baseline was overwritten';
  end if;
  update public.card_statement_snapshots set payment_baseline = null where id = snapshot_id;
  if public.rebaseline_legacy_card_statement(910002, 910002, '2024-01-31', '2024-02-20', 10000, 7000) is not null then
    raise exception 'cross-user legacy update accepted';
  end if;
  if public.rebaseline_legacy_card_statement(910001, 910002, '2024-01-31', '2024-02-20', 10000, 7000) is distinct from snapshot_id then
    raise exception 'legacy baseline was not replaced';
  end if;
  if (public.read_card_statement_inputs(910001)->'statements'->0->'payment_baseline'->0->>'sourceAccountId')::bigint <> 910001 then
    raise exception 'legacy rebaseline did not capture source identity';
  end if;
  perform public.update_transfer_group(910001, '00000000-0000-0000-0000-000000000001', 910001, 910002, 'Edited payment', 1000, '2024-01-31', false);
  data := public.read_card_statement_inputs(910001);
  if (data->'payments'->0->>'amountCents')::integer <> 1000
     or (data->'statements'->0->'payment_baseline'->0->>'amountCents')::integer <> 3000 then
    raise exception 'edit did not preserve the baseline';
  end if;
  perform public.delete_transfer_group(910001, '00000000-0000-0000-0000-000000000001');
  data := public.read_card_statement_inputs(910001);
  if jsonb_array_length(data->'payments') <> 0 or jsonb_array_length(data->'statements'->0->'payment_baseline') <> 1 then
    raise exception 'deletion did not preserve the baseline';
  end if;
  update public.card_statement_snapshots set payment_baseline = null where id = snapshot_id;
  update public.accounts set account_type = 'cash' where id = 910002 and telegram_user_id = 910001;
  if jsonb_array_length(public.read_card_statement_inputs(910001)->'statements') <> 0 then
    raise exception 'non-card legacy snapshot leaked into card status';
  end if;
  update public.accounts set account_type = 'card' where id = 910002 and telegram_user_id = 910001;
  if jsonb_array_length(public.read_card_statement_inputs(910001)->'statements') <> 1 then
    raise exception 'legacy snapshot lost after account becomes a card again';
  end if;
end $$;
rollback;
