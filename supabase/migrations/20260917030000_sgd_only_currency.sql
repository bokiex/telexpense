begin;

update public.accounts set currency = 'SGD';
update public.transactions set currency = 'SGD';
update public.budgets set currency = 'SGD';
update public.portfolio_snapshots set currency = 'SGD';
update public.recurring_rules set currency = 'SGD';
update public.pending_transaction_captures set currency = 'SGD';

drop function if exists public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, text, date);
create function public.update_transfer_group(target_user_id bigint, target_transfer_group_id uuid, from_account_id bigint, to_account_id bigint, transfer_description text, transfer_amount_cents integer, transfer_occurred_on date)
returns void language plpgsql security invoker set search_path = '' as $$
declare destination_kind text;
begin
  if (select count(*) <> 2 from public.transactions where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id) then raise exception 'Transfer group is not available.'; end if;
  select case when account_type = 'investment' then 'investment' else 'transfer' end into destination_kind from public.accounts where telegram_user_id = target_user_id and id = to_account_id;
  if destination_kind is null then raise exception 'Destination account is not available.'; end if;
  update public.transactions set kind = 'expense', category = null, category_id = null, subcategory_id = null, account_id = from_account_id, description = transfer_description, amount_cents = -transfer_amount_cents, occurred_on = transfer_occurred_on where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents < 0;
  if not found then raise exception 'Transfer source leg is not available.'; end if;
  update public.transactions set kind = destination_kind, category = null, category_id = null, subcategory_id = null, account_id = to_account_id, description = transfer_description, amount_cents = transfer_amount_cents, occurred_on = transfer_occurred_on where telegram_user_id = target_user_id and transfer_group_id = target_transfer_group_id and amount_cents > 0;
  if not found then raise exception 'Transfer destination leg is not available.'; end if;
end;
$$;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date) from public;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date) from anon;
revoke execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date) from authenticated;
grant execute on function public.update_transfer_group(bigint, uuid, bigint, bigint, text, integer, date) to service_role;

create or replace function public.consume_pending_transaction_capture(p_telegram_user_id bigint, p_token text, p_account_id bigint, p_expected_category_id bigint, p_expected_subcategory_id bigint)
returns bigint language plpgsql set search_path = public as $$
declare capture public.pending_transaction_captures%rowtype; category_source_name text; account_name text; transaction_id bigint;
begin
  select * into capture from public.pending_transaction_captures where telegram_user_id = p_telegram_user_id and token = p_token and expires_at > now() for update;
  if not found or capture.category_id is distinct from p_expected_category_id or capture.subcategory_id is distinct from p_expected_subcategory_id then return null; end if;
  select c.source_name into category_source_name from public.categories c join public.subcategories s on s.category_id = c.id and s.telegram_user_id = p_telegram_user_id where c.id = capture.category_id and c.telegram_user_id = p_telegram_user_id and c.active and s.id = capture.subcategory_id;
  select a.name into account_name from public.accounts a where a.id = p_account_id and a.telegram_user_id = p_telegram_user_id and a.active;
  if category_source_name is null or account_name is null then raise exception 'Pending transaction selection is not available'; end if;
  delete from public.pending_transaction_captures where telegram_user_id = p_telegram_user_id and token = p_token;
  insert into public.transactions (telegram_user_id, kind, category, category_id, subcategory_id, account_id, description, amount_cents) values (p_telegram_user_id, 'expense', category_source_name, capture.category_id, capture.subcategory_id, p_account_id, capture.description, capture.amount_cents) returning id into transaction_id;
  return transaction_id;
end;
$$;

create or replace function public.materialize_recurring_transactions(target_month text, batch_size integer default 100)
returns table(users_processed bigint, rules_materialized bigint) language sql volatile security invoker set search_path = public as $$
  with candidates as (select r.*, (substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 1, 8) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 9, 4) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 13, 4) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 17, 4) || '-' || substr(md5(r.telegram_user_id::text || ':' || r.id::text || ':' || target_month), 21, 12))::uuid as run_group_id from public.recurring_rules r where r.active and target_month ~ '^\d{4}-(0[1-9]|1[0-2])$' and batch_size between 1 and 500 and (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date <= current_date and not exists (select 1 from public.recurring_rule_runs existing where existing.telegram_user_id = r.telegram_user_id and existing.recurring_rule_id = r.id and existing.month = target_month) order by r.telegram_user_id, r.id limit batch_size), claimed as (insert into public.recurring_rule_runs (telegram_user_id, recurring_rule_id, month, transfer_group_id) select telegram_user_id, id, target_month, run_group_id from candidates on conflict (telegram_user_id, recurring_rule_id, month) do nothing returning telegram_user_id, recurring_rule_id, transfer_group_id), claimed_rules as (select r.*, c.transfer_group_id from claimed c join public.recurring_rules r on r.telegram_user_id = c.telegram_user_id and r.id = c.recurring_rule_id), inserted_transactions as (insert into public.transactions (telegram_user_id, kind, category, category_id, account_id, transfer_group_id, recurring_rule_id, description, amount_cents, occurred_on) select r.telegram_user_id, case when leg.destination then case when r.rule_type = 'investment_transfer' then 'investment' else 'transfer' end when r.rule_type = 'investment_transfer' then 'transfer' else 'expense' end, r.category, category_match.id, case when leg.destination then r.to_account_id else r.from_account_id end, case when r.rule_type = 'subscription' then null else r.transfer_group_id end, r.id, r.name, case when leg.destination then abs(r.amount_cents) else -abs(r.amount_cents) end, (target_month || '-' || lpad(least(r.day_of_month, extract(day from ((target_month || '-01')::date + interval '1 month - 1 day')))::integer::text, 2, '0'))::date from claimed_rules r cross join lateral (values (false), (true)) as leg(destination) left join lateral (select c.id from public.categories c where c.telegram_user_id = r.telegram_user_id and public.normalize_identity(c.source_name) = public.normalize_identity(r.category) limit 1) category_match on true where not leg.destination or (r.rule_type <> 'subscription' and r.to_account_id is not null) returning recurring_rule_id) select count(distinct telegram_user_id)::bigint, count(*)::bigint from claimed
$$;

alter table public.accounts drop column currency;
alter table public.transactions drop column currency;
alter table public.budgets drop column currency;
alter table public.portfolio_snapshots drop column currency;
alter table public.recurring_rules drop column currency;
alter table public.pending_transaction_captures drop column currency;

commit;
