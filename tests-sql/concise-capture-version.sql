begin;
insert into public.users (telegram_user_id) values (950201);
insert into public.categories (telegram_user_id, source_key, source_name, name) values (950201, 'capture-version', 'capture-version', 'Test');
insert into public.accounts (telegram_user_id, account_key, name) values (950201, 'capture-version', 'Test');
do $$
declare c bigint; a bigint; saved bigint;
begin
  select id into strict c from public.categories where telegram_user_id = 950201 and source_key = 'capture-version';
  select id into strict a from public.accounts where telegram_user_id = 950201 and account_key = 'capture-version';
  insert into public.pending_transaction_captures (token, telegram_user_id, description, amount_cents, category_id, account_id, version, expires_at)
    values ('capture-version', 950201, 'test', -1, c, a, 2, now() + interval '1 day');
  if public.consume_pending_transaction_capture(950201, 'capture-version', a, c, null, 1) is not null then
    raise exception 'stale capture version was consumed';
  end if;
  if not exists (select 1 from public.pending_transaction_captures where token = 'capture-version') then
    raise exception 'stale capture version removed the pending capture';
  end if;
  saved := public.consume_pending_transaction_capture(950201, 'capture-version', a, c, null, 2);
  if saved is null or not exists (select 1 from public.transactions where id = saved and telegram_user_id = 950201 and category_id = c and subcategory_id is null) then
    raise exception 'current capture version was not saved';
  end if;
end $$;
rollback;
