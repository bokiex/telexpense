insert into public.categories (
  telegram_user_id, source_key, source_name, name, budget_group, color, icon
)
select distinct source.telegram_user_id,
       public.normalize_identity(source.category),
       public.normalize_identity(source.category),
       initcap(public.normalize_identity(source.category)),
       case when public.normalize_identity(source.category) in ('income', 'investment', 'investments', 'salary')
         then 'Savings' else 'Needs' end,
       '#4ade80',
       'Wallet'
from (
  select telegram_user_id, category from public.transactions
  union
  select telegram_user_id, category from public.budgets
  union
  select telegram_user_id, category from public.recurring_rules
) source
where btrim(source.category) <> ''
on conflict do nothing;

update public.transactions t
set category_id = c.id
from public.categories c
where t.category_id is null
  and c.telegram_user_id = t.telegram_user_id
  and public.normalize_identity(c.source_name) = public.normalize_identity(t.category);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'account'
  ) then
    execute $sql$
      insert into public.accounts (
        telegram_user_id, account_key, name, account_type, currency, color, icon
      )
      select distinct telegram_user_id,
             public.normalize_identity(account),
             initcap(public.normalize_identity(account)),
             'bank',
             upper(currency),
             '#60a5fa',
             'Wallet'
      from public.transactions
      where account_id is null and btrim(account) <> ''
      on conflict do nothing
    $sql$;
    execute $sql$
      update public.transactions t
      set account_id = a.id
      from public.accounts a
      where t.account_id is null
        and a.telegram_user_id = t.telegram_user_id
        and public.normalize_identity(a.account_key) = public.normalize_identity(t.account)
    $sql$;
  end if;
end $$;

insert into public.categories (
  telegram_user_id, source_key, source_name, name, budget_group, color, icon
)
select u.telegram_user_id, seed.key, seed.key, seed.name, seed.budget_group, seed.color, seed.icon
from public.users u
cross join (values
  ('food', 'Food', 'Needs', '#fb923c', 'ShoppingCart'),
  ('transport', 'Transport', 'Needs', '#a78bfa', 'Car'),
  ('salary', 'Salary', 'Savings', '#4ade80', 'Briefcase')
) seed(key, name, budget_group, color, icon)
where not exists (
  select 1 from public.categories c where c.telegram_user_id = u.telegram_user_id
)
on conflict do nothing;

insert into public.accounts (
  telegram_user_id, account_key, name, account_type, currency, color, icon
)
select u.telegram_user_id, 'debit card', 'Debit Card', 'bank', 'SGD', '#60a5fa', 'Wallet'
from public.users u
where not exists (
  select 1 from public.accounts a where a.telegram_user_id = u.telegram_user_id
)
on conflict do nothing;

create or replace function public.seed_user_transaction_identities()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.categories (
    telegram_user_id, source_key, source_name, name, budget_group, color, icon
  ) values
    (new.telegram_user_id, 'food', 'food', 'Food', 'Needs', '#fb923c', 'ShoppingCart'),
    (new.telegram_user_id, 'transport', 'transport', 'Transport', 'Needs', '#a78bfa', 'Car'),
    (new.telegram_user_id, 'salary', 'salary', 'Salary', 'Savings', '#4ade80', 'Briefcase')
  on conflict do nothing;

  insert into public.accounts (
    telegram_user_id, account_key, name, account_type, currency, color, icon
  ) values (
    new.telegram_user_id, 'debit card', 'Debit Card', 'bank', 'SGD', '#60a5fa', 'Wallet'
  )
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists seed_user_transaction_identities on public.users;
create trigger seed_user_transaction_identities
after insert on public.users
for each row execute function public.seed_user_transaction_identities();
