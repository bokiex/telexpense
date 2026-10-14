alter table public.recurring_rules
  add column if not exists category_id bigint references public.categories(id) on delete set null,
  add column if not exists subcategory_id bigint references public.subcategories(id) on delete set null;

update public.recurring_rules r
set category_id = c.id
from public.categories c
where r.category_id is null
  and r.rule_type <> 'account_transfer'
  and c.telegram_user_id = r.telegram_user_id
  and public.normalize_identity(c.source_name) = public.normalize_identity(r.category);

create or replace function public.materialize_recurring_transactions(target_month text, batch_size integer default 100)
returns table(users_processed bigint, rules_materialized bigint)
language sql volatile security invoker set search_path = public
as $$
with candidates as (
  select r.*, (substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 1, 8) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 9, 4) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 13, 4) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 17, 4) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 21, 12))::uuid as run_group_id
  from public.recurring_rules r
   where r.active and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$' and batch_size between 1 and 500
     and (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date <= current_date
     and (r.rule_type = 'subscription' or r.to_account_id is not null)
     and (r.rule_type = 'account_transfer' or exists (
       select 1
       from public.categories c
       left join public.subcategories s on s.id = r.subcategory_id
         and s.telegram_user_id = r.telegram_user_id
         and s.category_id = c.id
       where c.id = r.category_id
         and c.telegram_user_id = r.telegram_user_id
         and (r.subcategory_id is null or s.id is not null)
     ))
    and not exists (select 1 from public.recurring_rule_runs x where x.telegram_user_id = r.telegram_user_id and x.recurring_rule_id = r.id and x.month = target_month)
  order by r.telegram_user_id, r.id limit batch_size
), claimed as (
  insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month, transfer_group_id)
  select telegram_user_id, id, target_month, case when rule_type = 'subscription' then null else run_group_id end from candidates
  on conflict (telegram_user_id, recurring_rule_id, month) do nothing
  returning telegram_user_id, recurring_rule_id, transfer_group_id
), claimed_rules as (
   select r.*, c.transfer_group_id, category.source_name as resolved_category,
     case when r.subcategory_id is null then null else subcategory.id end as resolved_subcategory_id
   from claimed c
   join public.recurring_rules r on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id
   left join public.categories category on category.id = r.category_id and category.telegram_user_id = r.telegram_user_id
   left join public.subcategories subcategory on subcategory.id = r.subcategory_id
     and subcategory.telegram_user_id = r.telegram_user_id
     and subcategory.category_id = r.category_id
), inserted_transactions as (
  insert into public.transactions (telegram_user_id, kind, category, category_id, subcategory_id, account_id, transfer_group_id, recurring_rule_id, description, amount_cents, occurred_on)
  select r.telegram_user_id,
    case when leg.destination and r.rule_type = 'investment_transfer' then 'investment' when leg.destination then 'transfer' when r.rule_type in ('subscription', 'loan_payment') then 'expense' else 'transfer' end,
     case when r.rule_type = 'account_transfer' then null else r.resolved_category end,
     case when r.rule_type = 'account_transfer' then null else r.category_id end,
     case when r.rule_type = 'account_transfer' then null else r.resolved_subcategory_id end,
    case when leg.destination then r.to_account_id else r.from_account_id end,
    case when r.rule_type = 'subscription' then null else r.transfer_group_id end, r.id, r.name,
    case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
    (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date
  from claimed_rules r cross join lateral (values (false), (true)) as leg(destination)
  where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
  returning recurring_rule_id
)
select count(distinct telegram_user_id)::bigint, count(*)::bigint from claimed;
$$;

revoke execute on function public.materialize_recurring_transactions(text, integer) from public, anon, authenticated;
grant execute on function public.materialize_recurring_transactions(text, integer) to service_role;
