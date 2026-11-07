#!/usr/bin/env bash
# Disposable PostgreSQL database with schema.sql applied; uses PG* variables.
set -euo pipefail
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -q)
tmpdir=$(mktemp -d)
first_pid=
second_pid=
cleanup() {
  exec 3>&- || true
  if [[ -n $second_pid ]]; then kill "$second_pid" 2>/dev/null || true; wait "$second_pid" || true; fi
  if [[ -n $first_pid ]]; then kill "$first_pid" 2>/dev/null || true; wait "$first_pid" || true; fi
  "${psql_cmd[@]}" -c 'delete from public.users where telegram_user_id = 950101' >/dev/null || true
  rm -rf "$tmpdir"
}
trap cleanup EXIT
"${psql_cmd[@]}" <<'SQL'
insert into public.users (telegram_user_id) values (950101);
insert into public.categories (id, telegram_user_id, source_key, source_name, name) overriding system value values (950101, 950101, 'delete-race', 'delete-race', 'Test');
insert into public.subcategories (id, telegram_user_id, category_id, name) overriding system value values (950101, 950101, 950101, 'Child');
SQL
mkfifo "$tmpdir/input"
exec 3<>"$tmpdir/input"
PGAPPNAME=delete_subcategory_first "${psql_cmd[@]}" <"$tmpdir/input" >"$tmpdir/first.log" 2>&1 &
first_pid=$!
printf '%s\n' 'begin;' "insert into public.budgets (telegram_user_id, category, subcategory_id, month, amount_cents) values (950101, 'delete-race', 950101, '2026-01', 1);" >&3
ready=false
for _ in {1..100}; do
  if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = 'delete_subcategory_first' and state = 'idle in transaction' and query like 'insert into public.budgets%'") == 1 ]]; then
    ready=true
    break
  fi
  sleep 0.05
done
if [[ $ready != true ]]; then echo 'insert session did not reach the synchronization point' >&2; exit 1; fi
PGAPPNAME=delete_subcategory_second "${psql_cmd[@]}" >"$tmpdir/second.log" 2>&1 <<'SQL' &
set statement_timeout = '15s';
do $$ begin
  if public.delete_unused_subcategory(950101, 950101) <> 'in_use' then raise exception 'concurrent budget was not protected'; end if;
  if not exists (select 1 from public.budgets where subcategory_id = 950101) then raise exception 'budget lost'; end if;
end $$;
SQL
second_pid=$!
blocked=false
for _ in {1..100}; do
  if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity waiter join pg_stat_activity blocker on blocker.pid = any(pg_blocking_pids(waiter.pid)) where waiter.application_name = 'delete_subcategory_second' and blocker.application_name = 'delete_subcategory_first'") == 1 ]]; then
    blocked=true
    break
  fi
  sleep 0.05
done
if [[ $blocked != true ]]; then echo 'delete did not block on the uncommitted reference' >&2; exit 1; fi
printf '%s\n' 'commit;' '\q' >&3
wait "$first_pid"
first_pid=
wait "$second_pid"
second_pid=
