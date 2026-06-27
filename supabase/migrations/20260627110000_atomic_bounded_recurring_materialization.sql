alter table public.categories
  add constraint categories_telegram_user_id_source_key_key
  unique (telegram_user_id, source_key);

alter table public.subcategories
  add constraint subcategories_telegram_user_id_category_id_name_key
  unique (telegram_user_id, category_id, name);

with ranked as (
  select id,
         first_value(id) over (
           partition by telegram_user_id, category, month
           order by id
         ) as keeper_id,
         sum(amount_cents) over (
           partition by telegram_user_id, category, month
         )::integer as combined_amount_cents,
         row_number() over (
           partition by telegram_user_id, category, month
           order by id
         ) as duplicate_number
  from public.budgets
),
combined as (
  update public.budgets b
  set amount_cents = r.combined_amount_cents
  from ranked r
  where b.id = r.keeper_id
    and r.duplicate_number = 1
  returning b.id
)
delete from public.budgets b
using ranked r
where b.id = r.id
  and r.duplicate_number > 1;

alter table public.budgets
  add constraint budgets_telegram_user_id_category_month_key
  unique (telegram_user_id, category, month);

create or replace function public.materialize_recurring_transactions(
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language sql
volatile
security invoker
set search_path = public
as $$
  with candidates as (
    select r.*,
           (
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 1, 8) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 9, 4) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 13, 4) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 17, 4) || '-' ||
             substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 21, 12)
           )::uuid as run_group_id
    from public.recurring_rules r
    where r.active
      and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and batch_size between 1 and 500
      and not exists (
        select 1
        from public.recurring_rule_runs existing
        where existing.telegram_user_id = r.telegram_user_id
          and existing.recurring_rule_id = r.id
          and existing.month = target_month
      )
    order by r.telegram_user_id, r.id
    limit batch_size
  ),
  claimed as (
    insert into public.recurring_rule_runs (
      telegram_user_id, recurring_rule_id, month, transfer_group_id
    )
    select telegram_user_id, id, target_month, run_group_id
    from candidates
    on conflict (telegram_user_id, recurring_rule_id, month) do nothing
    returning telegram_user_id, recurring_rule_id, transfer_group_id
  ),
  claimed_rules as (
    select r.*, c.transfer_group_id
    from claimed c
    join public.recurring_rules r
      on r.telegram_user_id = c.telegram_user_id
     and r.id = c.recurring_rule_id
  ),
  inserted_transactions as (
    insert into public.transactions (
      telegram_user_id, kind, category, category_id, account_id,
      transfer_group_id, recurring_rule_id, description, amount_cents,
      currency, occurred_on
    )
    select r.telegram_user_id,
           case
             when leg.destination then
               case when r.rule_type = 'investment_transfer' then 'investment' else 'transfer' end
             when r.rule_type = 'investment_transfer' then 'transfer'
             else 'expense'
           end,
           r.category,
           category_match.id,
           case when leg.destination then r.to_account_id else r.from_account_id end,
           r.transfer_group_id,
           r.id,
           r.name,
           case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
           r.currency,
           (
             target_month || '-' ||
             lpad(least(r.day_of_month, extract(day from (
               (target_month || '-01')::date + interval '1 month - 1 day'
             )))::integer::text, 2, '0')
           )::date
    from claimed_rules r
    cross join lateral (
      values (false), (true)
    ) as leg(destination)
    left join lateral (
      select c.id
      from public.categories c
      where c.telegram_user_id = r.telegram_user_id
        and public.normalize_identity(c.source_name) = public.normalize_identity(r.category)
      limit 1
    ) category_match on true
    where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
    returning recurring_rule_id
  )
  select count(distinct telegram_user_id)::bigint,
         count(*)::bigint
  from claimed
$$;

revoke execute on function public.materialize_recurring_transactions(text, integer) from public;
revoke execute on function public.materialize_recurring_transactions(text, integer) from anon;
revoke execute on function public.materialize_recurring_transactions(text, integer) from authenticated;
grant execute on function public.materialize_recurring_transactions(text, integer) to service_role;
