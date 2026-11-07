-- Run against a disposable database with schema.sql applied.
begin;
insert into public.users (telegram_user_id) values (950001), (950002);
insert into public.categories (telegram_user_id, source_key, source_name, name) values (950001, 'delete-test', 'delete-test', 'Test');
insert into public.accounts (telegram_user_id, account_key, name) values (950001, 'delete-test', 'Test');
insert into public.subcategories (telegram_user_id, category_id, name)
select 950001, id, 'Child' from public.categories where telegram_user_id = 950001 and source_key = 'delete-test';
do $$
declare c bigint; s bigint; a bigint; r bigint;
begin
  select id into strict c from public.categories where telegram_user_id = 950001 and source_key = 'delete-test';
  select id into strict s from public.subcategories where telegram_user_id = 950001 and category_id = c and name = 'Child';
  select id into strict a from public.accounts where telegram_user_id = 950001 and account_key = 'delete-test';
  if public.delete_unused_subcategory(950002, s) <> 'not_found' then raise exception 'owner isolation failed'; end if;
  insert into public.transactions (telegram_user_id, kind, category, category_id, subcategory_id, description, amount_cents)
    values (950001, 'expense', 'delete-test', c, s, 'test', -1);
  if public.delete_unused_subcategory(950001, s) <> 'in_use' then raise exception 'transaction not protected'; end if;
  delete from public.transactions where telegram_user_id = 950001;
  insert into public.recurring_rules (telegram_user_id, name, rule_type, amount_cents, from_account_id, category, category_id, subcategory_id)
    values (950001, 'test', 'subscription', 1, a, 'delete-test', c, s) returning id into r;
  if public.delete_unused_subcategory(950001, s) <> 'in_use' then raise exception 'rule not protected'; end if;
  delete from public.recurring_rules where id = r;
  insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents) values (950001, 'delete-test', s, '2026-01', 1);
  if public.delete_unused_subcategory(950001, s) <> 'in_use' then raise exception 'budget not protected'; end if;
  delete from public.budgets where subcategory_id = s;
  insert into public.pending_transaction_captures (token, telegram_user_id, description, amount_cents, category_id, subcategory_id, expires_at)
    values ('delete-test', 950001, 'test', -1, c, s, now() + interval '1 day');
  if public.delete_unused_subcategory(950001, s) <> 'in_use' then raise exception 'pending capture not protected'; end if;
  delete from public.pending_transaction_captures where token = 'delete-test';
  if public.delete_unused_subcategory(950001, s) <> 'deleted' then raise exception 'unused deletion failed'; end if;
  if public.delete_unused_subcategory(950001, s) <> 'not_found' then raise exception 'missing deletion failed'; end if;
end $$;
rollback;
