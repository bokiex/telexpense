create index if not exists recurring_rules_active_traversal_idx
  on public.recurring_rules (telegram_user_id, id) where active;

create or replace function public.materialize_recurring_transactions(
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language plpgsql volatile security invoker set search_path = public
as $$
declare
  locked_user_id bigint;
  locked_rule_id bigint;
  last_user_id bigint;
  last_rule_id bigint;
  counted_user_id bigint;
  claimed_users bigint;
  claimed_count bigint;
begin
  -- Each command after a blocking row lock must see a new snapshot. Higher
  -- isolation levels retain a transaction snapshot and can hide a committed run.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'recurring materialization requires READ COMMITTED isolation'
      using errcode = '25001';
  end if;
  users_processed := 0;
  rules_materialized := 0;
  while rules_materialized < batch_size loop
  -- Lock in a common order across global and scoped workers. Never skip a
  -- locked eligible rule: a short batch is interpreted by callers as done.
  select r.telegram_user_id, r.id
  into locked_user_id, locked_rule_id
  from public.recurring_rules r
    -- NOT VALID owner FKs can leave legacy cross-owner account references.
    where (last_rule_id is null or (r.telegram_user_id, r.id) > (last_user_id, last_rule_id))
      and r.active
      and exists (
        select 1 from public.accounts a
        where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
      )
      and (r.to_account_id is null or exists (
        select 1 from public.accounts a
        where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
      ))
      and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and batch_size between 1 and 500
       and (
        target_month || '-' ||
        lpad(least(r.day_of_month, extract(day from (
          (target_month || '-01')::date + interval '1 month - 1 day'
        )))::integer::text, 2, '0')
      )::date <= current_date
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
      and not exists (
        select 1 from public.recurring_rule_runs existing
        where existing.telegram_user_id = r.telegram_user_id
          and existing.recurring_rule_id = r.id
          and existing.month = target_month
      )
    order by r.telegram_user_id, r.id
  limit 1
  for no key update of r;
  exit when not found;
  last_user_id := locked_user_id;
  last_rule_id := locked_rule_id;

  -- Re-evaluate the rule and its run in a fresh statement snapshot after the
  -- wait. This observes committed edits/claims and retries rolled-back claims.
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
    where r.telegram_user_id = locked_user_id and r.id = locked_rule_id
      and r.active
      and exists (
        select 1 from public.accounts a
        where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
      )
      and (r.to_account_id is null or exists (
        select 1 from public.accounts a
        where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
      ))
      and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and batch_size between 1 and 500
       and (
        target_month || '-' ||
        lpad(least(r.day_of_month, extract(day from (
          (target_month || '-01')::date + interval '1 month - 1 day'
        )))::integer::text, 2, '0')
      )::date <= current_date
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
     select telegram_user_id, id, target_month,
            case when rule_type = 'subscription' then null else run_group_id end
     from candidates
    on conflict (telegram_user_id, recurring_rule_id, month) do nothing
    returning telegram_user_id, recurring_rule_id, transfer_group_id
  ),
  claimed_rules as (
     select r.*, c.transfer_group_id, category.source_name as resolved_category,
            case when r.subcategory_id is null then null else subcategory.id end as resolved_subcategory_id
     from claimed c
     join public.recurring_rules r
       on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id
     left join public.categories category
       on category.id = r.category_id and category.telegram_user_id = r.telegram_user_id
     left join public.subcategories subcategory
       on subcategory.id = r.subcategory_id
       and subcategory.telegram_user_id = r.telegram_user_id
       and subcategory.category_id = r.category_id
  ),
  inserted_transactions as (
     insert into public.transactions (
       telegram_user_id, kind, category, category_id, subcategory_id, account_id,
       transfer_group_id, recurring_rule_id, description, amount_cents, occurred_on
    )
    select r.telegram_user_id,
           case
             when leg.destination then
               case when r.rule_type = 'investment_transfer' then 'investment' else 'transfer' end
             when r.rule_type = 'investment_transfer' then 'transfer'
             when r.rule_type in ('subscription', 'loan_payment') then 'expense'
             else 'transfer'
           end,
            case when r.rule_type = 'account_transfer' then null else r.resolved_category end,
            case when r.rule_type = 'account_transfer' then null else r.category_id end,
            case when r.rule_type = 'account_transfer' then null else r.resolved_subcategory_id end,
           case when leg.destination then r.to_account_id else r.from_account_id end,
           case when r.rule_type = 'subscription' then null else r.transfer_group_id end,
           r.id,
           r.name,
            case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
           (
             target_month || '-' ||
             lpad(least(r.day_of_month, extract(day from (
               (target_month || '-01')::date + interval '1 month - 1 day'
             )))::integer::text, 2, '0')
           )::date
    from claimed_rules r
    cross join lateral (values (false), (true)) as leg(destination)
    where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
    returning recurring_rule_id
  )
  select count(distinct telegram_user_id)::bigint, count(*)::bigint
  into claimed_users, claimed_count from claimed;
  if claimed_count > 0 then
    rules_materialized := rules_materialized + claimed_count;
    if counted_user_id is distinct from locked_user_id then
      users_processed := users_processed + claimed_users;
      counted_user_id := locked_user_id;
    end if;
  end if;
  end loop;
  return next;
end;
$$;

create or replace function public.materialize_recurring_transactions_for_user(
  target_telegram_user_id bigint,
  target_month text,
  batch_size integer default 100
)
returns table(users_processed bigint, rules_materialized bigint)
language plpgsql volatile security invoker set search_path = public
as $$
declare
  locked_user_id bigint;
  locked_rule_id bigint;
  last_user_id bigint;
  last_rule_id bigint;
  counted_user_id bigint;
  claimed_users bigint;
  claimed_count bigint;
begin
  -- Each command after a blocking row lock must see a new snapshot. Higher
  -- isolation levels retain a transaction snapshot and can hide a committed run.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'recurring materialization requires READ COMMITTED isolation'
      using errcode = '25001';
  end if;
  users_processed := 0;
  rules_materialized := 0;
  while rules_materialized < batch_size loop
  -- Lock in a common order across global and scoped workers. Never skip a
  -- locked eligible rule: a short batch is interpreted by callers as done.
  select r.telegram_user_id, r.id
  into locked_user_id, locked_rule_id
  from public.recurring_rules r
  where (last_rule_id is null or r.id > last_rule_id)
    and r.telegram_user_id = target_telegram_user_id
    and r.active
    and exists (
      select 1 from public.accounts a
      where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
    )
    and (r.to_account_id is null or exists (
      select 1 from public.accounts a
      where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
    ))
    and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    and batch_size between 1 and 500
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
    and not exists (
      select 1 from public.recurring_rule_runs x
      where x.telegram_user_id = r.telegram_user_id
        and x.recurring_rule_id = r.id
        and x.month = target_month
    )
  order by r.id
  limit 1
  for no key update of r;
  exit when not found;
  last_user_id := locked_user_id;
  last_rule_id := locked_rule_id;

  -- Re-evaluate the rule and its run in a fresh statement snapshot after the
  -- wait. This observes committed edits/claims and retries rolled-back claims.
  with candidates as (
  select r.*,
         (substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 1, 8) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 9, 4) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 13, 4) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 17, 4) || '-' ||
          substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 21, 12))::uuid as run_group_id
  from public.recurring_rules r
  where r.telegram_user_id = locked_user_id and r.id = locked_rule_id
      and r.telegram_user_id = target_telegram_user_id
    and r.active
    and exists (
      select 1 from public.accounts a
      where a.id = r.from_account_id and a.telegram_user_id = r.telegram_user_id
    )
    and (r.to_account_id is null or exists (
      select 1 from public.accounts a
      where a.id = r.to_account_id and a.telegram_user_id = r.telegram_user_id
    ))
    and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    and batch_size between 1 and 500
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
    and not exists (
      select 1 from public.recurring_rule_runs x
      where x.telegram_user_id = r.telegram_user_id
        and x.recurring_rule_id = r.id
        and x.month = target_month
    )
  order by r.id
  limit batch_size
), claimed as (
  insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month, transfer_group_id)
  select telegram_user_id, id, target_month,
         case when rule_type = 'subscription' then null else run_group_id end
  from candidates
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
  insert into public.transactions (
    telegram_user_id, kind, category, category_id, subcategory_id, account_id,
    transfer_group_id, recurring_rule_id, description, amount_cents, occurred_on
  )
  select r.telegram_user_id,
         case when leg.destination and r.rule_type = 'investment_transfer' then 'investment'
              when leg.destination then 'transfer'
              when r.rule_type in ('subscription', 'loan_payment') then 'expense'
              else 'transfer' end,
         case when r.rule_type = 'account_transfer' then null else r.resolved_category end,
         case when r.rule_type = 'account_transfer' then null else r.category_id end,
         case when r.rule_type = 'account_transfer' then null else r.resolved_subcategory_id end,
         case when leg.destination then r.to_account_id else r.from_account_id end,
         case when r.rule_type = 'subscription' then null else r.transfer_group_id end,
         r.id, r.name,
         case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end,
         (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date
  from claimed_rules r
  cross join lateral (values (false), (true)) as leg(destination)
  where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null)
  returning recurring_rule_id
)
select count(distinct telegram_user_id)::bigint, count(*)::bigint
  into claimed_users, claimed_count from claimed;
  if claimed_count > 0 then
    rules_materialized := rules_materialized + claimed_count;
    if counted_user_id is distinct from locked_user_id then
      users_processed := users_processed + claimed_users;
      counted_user_id := locked_user_id;
    end if;
  end if;
  end loop;
  return next;
end;
$$;

revoke execute on function public.materialize_recurring_transactions(text, integer) from public;
revoke execute on function public.materialize_recurring_transactions(text, integer) from anon;
revoke execute on function public.materialize_recurring_transactions(text, integer) from authenticated;
grant execute on function public.materialize_recurring_transactions(text, integer) to service_role;
revoke execute on function public.materialize_recurring_transactions_for_user(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.materialize_recurring_transactions_for_user(bigint, text, integer) to service_role;
