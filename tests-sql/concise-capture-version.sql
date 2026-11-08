begin;
insert into public.users (telegram_user_id) values (950201);
insert into public.categories (telegram_user_id, source_key, source_name, name) values (950201, 'capture-version', 'capture-version', 'Test'), (950201, 'other', 'other', 'Other');
insert into public.subcategories (telegram_user_id, category_id, name)
select 950201, id, 'Other child' from public.categories where telegram_user_id = 950201 and source_key = 'other';
insert into public.accounts (telegram_user_id, account_key, name) values (950201, 'capture-version', 'Test');
do $$
declare c bigint; a bigint; other_category bigint; other_child bigint; saved bigint;
begin
  select id into strict c from public.categories where telegram_user_id = 950201 and source_key = 'capture-version';
  select id into strict a from public.accounts where telegram_user_id = 950201 and account_key = 'capture-version';
  select id into strict other_category from public.categories where telegram_user_id = 950201 and source_key = 'other';
  select id into strict other_child from public.subcategories where telegram_user_id = 950201 and name = 'Other child';
  insert into public.pending_transaction_captures (token, telegram_user_id, description, amount_cents, category_id, account_id, version, expires_at)
    values ('capture-version', 950201, 'test', -1, c, null, 2, now() + interval '1 day');
  if public.consume_pending_transaction_capture(950201, 'capture-version', a, c, null, 1) is not null then
    raise exception 'stale capture version was consumed';
  end if;
  if not exists (select 1 from public.pending_transaction_captures where token = 'capture-version') then
    raise exception 'stale capture version removed the pending capture';
  end if;
  begin
    perform public.consume_pending_transaction_capture(950201, 'capture-version', a, c, other_child, 2);
    raise exception 'invalid child was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Pending transaction selection is not available' then raise; end if;
  end;
  saved := public.consume_pending_transaction_capture(950201, 'capture-version', a, c, null, 2);
  if saved is null or not exists (select 1 from public.transactions where id = saved and telegram_user_id = 950201 and category_id = c and subcategory_id is null and account_id = a) then
    raise exception 'current capture version was not saved';
  end if;
  insert into public.pending_transaction_captures (token, telegram_user_id, description, amount_cents, version, expires_at)
    values ('capture-category', 950201, 'test', -1, 0, now() + interval '1 day');
  saved := public.consume_pending_transaction_capture(950201, 'capture-category', a, other_category, other_child, 0);
  if saved is null or not exists (select 1 from public.transactions where id = saved and telegram_user_id = 950201 and category_id = other_category and subcategory_id = other_child and account_id = a) then
    raise exception 'final category and child were not saved';
  end if;
end $$;
rollback;
