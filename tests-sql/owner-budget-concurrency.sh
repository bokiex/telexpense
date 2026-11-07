#!/usr/bin/env bash
# Disposable PostgreSQL 15+ database with schema.sql applied; uses PG* variables.
# Independent sessions exercise the snapshot race and the category delete order.
set -euo pipefail
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -q)
log=$(mktemp)
first_pid=
setup_done=0
cleanup() {
  if [[ -n $first_pid ]]; then wait "$first_pid" || true; fi
  if [[ $setup_done == 1 ]]; then
    "${psql_cmd[@]}" -c 'delete from public.users where telegram_user_id = 940101' >/dev/null || true
  fi
  rm -f "$log"
}
trap cleanup EXIT
"${psql_cmd[@]}" <<'SQL'
begin;
insert into public.users (telegram_user_id) values (940101);
insert into public.categories (id, telegram_user_id, source_key, source_name, name) overriding system value values
  (940101, 940101, 'race-a', 'race-a', 'A'), (940102, 940101, 'race-b', 'race-b', 'B');
insert into public.subcategories (id, telegram_user_id, category_id, name) overriding system value values
  (940101, 940101, 940101, 'Child');
commit;
SQL
setup_done=1
wait_for_sleep() {
  for _ in {1..100}; do
    if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = 'owner_budget_first' and wait_event = 'PgSleep'") == 1 ]]; then return; fi
    sleep 0.03
  done
  echo 'first session did not reach concurrent window' >&2
  exit 1
}

# Establish a repeatable-read snapshot before the budget commits. Neither a
# category rename nor a reparent may pass just because the budget is invisible.
PGAPPNAME=owner_budget_first "${psql_cmd[@]}" >"$log" 2>&1 <<'SQL' &
begin isolation level repeatable read;
select count(*) from public.budgets where subcategory_id = 940101;
select pg_sleep(4);
do $$ begin
  begin
    update public.categories set source_key = 'renamed', source_name = 'renamed' where id = 940101;
    raise exception 'category rename unexpectedly accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.subcategories set category_id = 940102 where id = 940101;
    raise exception 'reparent unexpectedly accepted';
  exception when foreign_key_violation then null; end;
end $$;
commit;
SQL
first_pid=$!
wait_for_sleep
"${psql_cmd[@]}" <<'SQL'
set statement_timeout = '2s';
insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents)
values (940101, 'race-a', 940101, '2026-01', 100);
SQL
wait "$first_pid" || { first_pid=; printf 'repeatable-read session failed:\n' >&2; command cat "$log" >&2; exit 1; }
first_pid=

# Insert holds the FK key-share lock on the child; the other session deletes
# the category and cascades to the child. It must wait, not deadlock, then
# remove the newly committed budget too.
PGAPPNAME=owner_budget_first "${psql_cmd[@]}" >"$log" 2>&1 <<'SQL' &
begin;
insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents)
values (940101, 'race-a', 940101, '2026-02', 100);
select pg_sleep(4);
commit;
SQL
first_pid=$!
wait_for_sleep
"${psql_cmd[@]}" <<'SQL'
set statement_timeout = '8s';
delete from public.categories where id = 940101;
do $$ begin
  if exists (select 1 from public.subcategories where id = 940101)
     or exists (select 1 from public.budgets where subcategory_id = 940101) then
    raise exception 'category cascade left a child or budget';
  end if;
end $$;
SQL
wait "$first_pid" || { first_pid=; printf 'inserting session failed:\n' >&2; command cat "$log" >&2; exit 1; }
first_pid=
echo 'owner budget concurrency passed'
