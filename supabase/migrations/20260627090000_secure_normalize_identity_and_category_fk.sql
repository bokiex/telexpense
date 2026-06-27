alter function public.normalize_identity(text) set search_path = public;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.transactions'::regclass
      and c.confrelid = 'public.categories'::regclass
      and c.contype = 'f'
      and a.attname = 'category_id'
  ) then
    alter table public.transactions
      add constraint transactions_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
end $$;
