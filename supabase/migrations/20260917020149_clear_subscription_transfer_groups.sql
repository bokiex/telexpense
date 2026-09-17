update public.transactions t
set transfer_group_id = null
from public.recurring_rules r
where r.id = t.recurring_rule_id
  and r.telegram_user_id = t.telegram_user_id
  and r.rule_type = 'subscription'
  and t.transfer_group_id is not null
  and 1 = (
    select count(*)
    from public.transactions grouped
    where grouped.transfer_group_id = t.transfer_group_id
  );

create or replace function public.materialize_recurring_transactions(
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language sql volatile security invoker set search_path = public
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
      and (
        target_month || '-' ||
        lpad(least(r.day_of_month, extract(day from (
          (target_month || '-01')::date + interval '1 month - 1 day'
        )))::integer::text, 2, '0')
      )::date <= current_date
      and not exists (
        select 1 from public.recurring_rule_runs existing
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
    select telegram_user_id, id, target_month, run_group_id from candidates
    on conflict (telegram_user_id, recurring_rule_id, month) do nothing
    returning telegram_user_id, recurring_rule_id, transfer_group_id
  ),
  claimed_rules as (
    select r.*, c.transfer_group_id
    from claimed c
    join public.recurring_rules r
      on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id
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
           case when r.rule_type = 'subscription' then null else r.transfer_group_id end,
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
    cross join lateral (values (false), (true)) as leg(destination)
    left join lateral (
      select c.id from public.categories c
      where c.telegram_user_id = r.telegram_user_id
        and public.normalize_identity(c.source_name) = public.normalize_identity(r.category)
      limit 1
    ) category_match on true
    where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
    returning recurring_rule_id
  )
  select count(distinct telegram_user_id)::bigint, count(*)::bigint from claimed
$$;

revoke execute on function public.materialize_recurring_transactions(text, integer) from public;
revoke execute on function public.materialize_recurring_transactions(text, integer) from anon;
revoke execute on function public.materialize_recurring_transactions(text, integer) from authenticated;
grant execute on function public.materialize_recurring_transactions(text, integer) to service_role;
