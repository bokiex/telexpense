create or replace function public.delete_transfer_group(
  target_user_id bigint,
  target_transfer_group_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    select count(*) <> 2
    from public.transactions
    where telegram_user_id = target_user_id
      and transfer_group_id = target_transfer_group_id
  ) then
    raise exception 'Transfer group is not available.';
  end if;

  delete from public.transactions
  where telegram_user_id = target_user_id
    and transfer_group_id = target_transfer_group_id;
end;
$$;

revoke execute on function public.delete_transfer_group(bigint, uuid) from public;
revoke execute on function public.delete_transfer_group(bigint, uuid) from anon;
revoke execute on function public.delete_transfer_group(bigint, uuid) from authenticated;
grant execute on function public.delete_transfer_group(bigint, uuid) to service_role;
