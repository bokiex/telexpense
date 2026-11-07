#!/usr/bin/env bash
# Disposable PostgreSQL database with schema.sql applied; uses PG* variables.
set -euo pipefail
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -q)
log=$(mktemp)
first_pid=
cleanup() {
  if [[ -n $first_pid ]]; then wait "$first_pid" || true; fi
  "${psql_cmd[@]}" -c 'delete from public.users where telegram_user_id = 950101' >/dev/null || true
  rm -f "$log"
}
trap cleanup EXIT
"${psql_cmd[@]}" <<'SQL'
insert into public.users (telegram_user_id) values (950101);
insert into public.categories (id, telegram_user_id, source_key, source_name, name) overriding system value values (950101, 950101, 'delete-race', 'delete-race', 'Test');
insert into public.subcategories (id, telegram_user_id, category_id, name) overriding system value values (950101, 950101, 950101, 'Child');
SQL
PGAPPNAME=delete_subcategory_first "${psql_cmd[@]}" >"$log" 2>&1 <<'SQL' &
begin;
insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents) values (950101, 'delete-race', 950101, '2026-01', 1);
select pg_sleep(3);
commit;
SQL
first_pid=$!
for _ in {1..100}; do
  [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = 'delete_subcategory_first' and wait_event = 'PgSleep'") == 1 ]] && break
  sleep 0.03
done
"${psql_cmd[@]}" <<'SQL'
set statement_timeout = '8s';
do $$ begin
  if public.delete_unused_subcategory(950101, 950101) <> 'in_use' then raise exception 'concurrent budget was not protected'; end if;
  if not exists (select 1 from public.budgets where subcategory_id = 950101) then raise exception 'budget lost'; end if;
end $$;
SQL
wait "$first_pid"
first_pid=
