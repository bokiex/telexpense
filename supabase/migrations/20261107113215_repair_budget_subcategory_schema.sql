-- Some deployments have set_budget but still have the pre-subcategory budgets
-- table. Preserve existing targets; fail rather than discard conflicting data.
alter table public.budgets
  add column if not exists subcategory_id bigint;

-- ADD COLUMN IF NOT EXISTS alone does not add the FK when the column already
-- exists. Accept an equivalent FK under any name on partially upgraded schemas.
do $$
declare
  fk_name text := 'budgets_subcategory_id_fkey';
  incompatible_fk record;
  suffix integer := 0;
begin
  -- Every FK on this exact relationship must cascade. Even one incompatible
  -- FK can block deletion or change its outcome alongside a cascading FK.
  for incompatible_fk in
    select c.conname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'subcategory_id'
    where c.conrelid = 'public.budgets'::regclass
      and c.contype = 'f'
      and c.conkey = array[a.attnum]::smallint[]
      and c.confrelid = 'public.subcategories'::regclass
      and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.subcategories'::regclass and attname = 'id')]::smallint[]
      and c.confdeltype <> 'c'
  loop
    execute format('alter table public.budgets drop constraint %I', incompatible_fk.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'subcategory_id'
    where c.conrelid = 'public.budgets'::regclass
      and c.contype = 'f'
      and c.conkey = array[a.attnum]::smallint[]
      and c.confrelid = 'public.subcategories'::regclass
      and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.subcategories'::regclass and attname = 'id')]::smallint[]
      and c.confdeltype = 'c'
  ) then
    -- A same-named constraint may enforce an unrelated invariant. Preserve it
    -- and choose an unused name rather than dropping it or failing the upgrade.
    while exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass and conname = fk_name) loop
      suffix := suffix + 1;
      fk_name := 'budgets_subcategory_id_fkey_' || suffix;
    end loop;
    execute format('alter table public.budgets add constraint %I foreign key (subcategory_id) references public.subcategories(id) on delete cascade', fk_name);
  end if;
end;
$$;

alter table public.budgets
  drop constraint if exists budgets_telegram_user_id_category_month_key;

create unique index if not exists budgets_user_category_month_uidx
  on public.budgets (telegram_user_id, category, month)
  where subcategory_id is null;

create unique index if not exists budgets_user_subcategory_month_uidx
  on public.budgets (telegram_user_id, subcategory_id, month)
  where subcategory_id is not null;

create index if not exists budgets_user_subcategory_idx
  on public.budgets (telegram_user_id, subcategory_id)
  where subcategory_id is not null;

create or replace function public.set_budget(
  p_telegram_user_id bigint,
  p_category text,
  p_month text,
  p_amount_cents integer,
  p_subcategory_id bigint default null
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  if p_subcategory_id is null then
    insert into public.budgets (telegram_user_id, category, month, amount_cents, subcategory_id)
    values (p_telegram_user_id, p_category, p_month, p_amount_cents, null)
    on conflict (telegram_user_id, category, month) where subcategory_id is null
    do update set amount_cents = excluded.amount_cents;
  else
    insert into public.budgets (telegram_user_id, category, month, amount_cents, subcategory_id)
    values (p_telegram_user_id, p_category, p_month, p_amount_cents, p_subcategory_id)
    on conflict (telegram_user_id, subcategory_id, month) where subcategory_id is not null
    do update set amount_cents = excluded.amount_cents;
  end if;
end;
$$;
