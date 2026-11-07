-- Lock the parent before checking references. Foreign key checks on concurrent
-- inserts/updates take a key-share lock, so they cannot race this deletion.
create or replace function public.delete_unused_subcategory(p_user_id bigint, p_subcategory_id bigint)
returns text language plpgsql set search_path = public as $$
begin
  perform 1 from public.subcategories
    where id = p_subcategory_id and telegram_user_id = p_user_id for update;
  if not found then return 'not_found'; end if;

  if exists (select 1 from public.transactions where subcategory_id = p_subcategory_id)
    or exists (select 1 from public.recurring_rules where subcategory_id = p_subcategory_id)
    or exists (select 1 from public.budgets where subcategory_id = p_subcategory_id)
    or exists (select 1 from public.pending_transaction_captures where subcategory_id = p_subcategory_id)
  then return 'in_use'; end if;

  delete from public.subcategories where id = p_subcategory_id and telegram_user_id = p_user_id;
  return 'deleted';
end;
$$;
revoke all on function public.delete_unused_subcategory(bigint, bigint) from public, anon, authenticated;
grant execute on function public.delete_unused_subcategory(bigint, bigint) to service_role;
