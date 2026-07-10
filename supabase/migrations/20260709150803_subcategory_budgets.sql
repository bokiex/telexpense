alter table public.budgets
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete cascade;

alter table public.budgets
  drop constraint if exists budgets_telegram_user_id_category_month_key;

delete from public.budgets b
where b.subcategory_id is not null
  and not exists (
    select 1
    from public.subcategories s
    join public.categories c on c.id = s.category_id
    where s.id = b.subcategory_id
      and s.telegram_user_id = b.telegram_user_id
      and c.telegram_user_id = b.telegram_user_id
      and public.normalize_identity(c.source_name) = public.normalize_identity(b.category)
  );

create unique index if not exists budgets_user_category_month_uidx
  on public.budgets (telegram_user_id, category, month)
  where subcategory_id is null;

create unique index if not exists budgets_user_subcategory_month_uidx
  on public.budgets (telegram_user_id, subcategory_id, month)
  where subcategory_id is not null;

create index if not exists budgets_user_subcategory_idx
  on public.budgets (telegram_user_id, subcategory_id)
  where subcategory_id is not null;
