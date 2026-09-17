drop function if exists public.set_budget(bigint, text, text, integer, text, bigint);

create function public.set_budget(
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
    insert into public.budgets (
      telegram_user_id, category, month, amount_cents, subcategory_id
    )
    values (
      p_telegram_user_id, p_category, p_month, p_amount_cents, null
    )
    on conflict (telegram_user_id, category, month) where subcategory_id is null
    do update set amount_cents = excluded.amount_cents;
  else
    insert into public.budgets (
      telegram_user_id, category, month, amount_cents, subcategory_id
    )
    values (
      p_telegram_user_id, p_category, p_month, p_amount_cents, p_subcategory_id
    )
    on conflict (telegram_user_id, subcategory_id, month) where subcategory_id is not null
    do update set amount_cents = excluded.amount_cents;
  end if;
end;
$$;
