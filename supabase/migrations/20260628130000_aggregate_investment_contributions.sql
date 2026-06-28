create or replace function public.investment_contribution_totals(
  target_user_id bigint,
  account_cutoffs jsonb
)
returns table(account_id bigint, total_cents bigint, month_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with cutoffs as (
    select key::bigint as account_id, value::text as cutoff_month
    from jsonb_each_text(account_cutoffs)
    where key ~ '^[0-9]+$'
      and value ~ '^\d{4}-(0[1-9]|1[0-2])$'
  )
  select
    t.account_id,
    coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
    coalesce(sum(t.amount_cents) filter (
      where t.occurred_on >= (c.cutoff_month || '-01')::date
    ), 0)::bigint as month_cents
  from cutoffs c
  join public.transactions t
    on t.account_id = c.account_id
   and t.telegram_user_id = target_user_id
   and t.kind in ('investment', 'transfer')
   and t.amount_cents > 0
   and t.occurred_on < ((c.cutoff_month || '-01')::date + interval '1 month')
  group by t.account_id
$$;

revoke execute on function public.investment_contribution_totals(bigint, jsonb) from public;
revoke execute on function public.investment_contribution_totals(bigint, jsonb) from anon;
revoke execute on function public.investment_contribution_totals(bigint, jsonb) from authenticated;
grant execute on function public.investment_contribution_totals(bigint, jsonb) to service_role;
