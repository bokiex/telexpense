#!/usr/bin/env bash
# Run against a disposable database with schema.sql (or the migrations) applied.
# Uses the normal PG* environment variables and independent PostgreSQL sessions.
set -euo pipefail
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -q)
logs=$(mktemp -d)
pids=()
setup_done=0
cleanup() {
  for pid in "${pids[@]}"; do wait "$pid" || true; done
  if [[ $setup_done == 1 ]]; then
    "${psql_cmd[@]}" -c 'delete from public.users where telegram_user_id in (930001, 930002)' >/dev/null
  fi
  rm -rf "$logs"
}
trap cleanup EXIT
"${psql_cmd[@]}" <<'SQL'
begin;
insert into public.users (telegram_user_id) values (930001), (930002);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value values
  (930001, 930001, 'bank', 'Bank', 'bank'), (930002, 930001, 'cash', 'Cash', 'cash'),
  (930003, 930002, 'bank', 'Bank', 'bank'), (930004, 930002, 'cash', 'Cash', 'cash');
insert into public.categories (id, telegram_user_id, source_key, source_name, name) overriding system value values
  (930001, 930001, 'bills', 'Bills', 'Bills');
insert into public.recurring_rules (id, telegram_user_id, name, rule_type, amount_cents, from_account_id, to_account_id, day_of_month, category_id)
overriding system value values
  (930001, 930001, 'Subscription', 'subscription', 100, 930001, null, 1, 930001),
  (930002, 930001, 'Transfer', 'account_transfer', 200, 930001, 930002, 1, null),
  (930003, 930001, 'Second transfer', 'account_transfer', 300, 930001, 930002, 1, null),
  (930004, 930002, 'Other user', 'account_transfer', 400, 930003, 930004, 1, null);
commit;
SQL
setup_done=1

wait_for() {
  local app=$1 event=$2
  for _ in {1..150}; do
    if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = '$app' and $event") == 1 ]]; then return; fi
    sleep 0.02
  done
  echo "$app did not reach expected state: $event" >&2
  return 1
}

# A short batch must not hide a locked eligible rule. Exercise both entry
# points in each direction, worker commit/rollback, and an ordinary edit.
for mode in global-first scoped-first rollback edit-commit edit-rollback limited; do
  case "$mode" in
    global-first) month=2024-01; first="select * from public.materialize_recurring_transactions('$month', 1)"; second="public.materialize_recurring_transactions_for_user(930001, '$month', 100)"; expected=2; finish=commit ;;
    scoped-first) month=2024-02; first="select * from public.materialize_recurring_transactions_for_user(930001, '$month', 1)"; second="public.materialize_recurring_transactions('$month', 100)"; expected=3; finish=commit ;;
    rollback) month=2024-03; first="select * from public.materialize_recurring_transactions('$month', 1)"; second="public.materialize_recurring_transactions_for_user(930001, '$month', 100)"; expected=3; finish=rollback ;;
    edit-commit) month=2024-04; first="update public.recurring_rules set amount_cents = 150 where id = 930001"; second="public.materialize_recurring_transactions_for_user(930001, '$month', 100)"; expected=3; finish=commit ;;
    edit-rollback) month=2024-05; first="update public.recurring_rules set amount_cents = 175 where id = 930001"; second="public.materialize_recurring_transactions_for_user(930001, '$month', 100)"; expected=3; finish=rollback ;;
    limited) month=2024-09; first="select * from public.materialize_recurring_transactions('$month', 1)"; second="public.materialize_recurring_transactions_for_user(930001, '$month', 1)"; expected=1; finish=commit ;;
  esac
  PGAPPNAME=recurring_first "${psql_cmd[@]}" >"$logs/first" 2>&1 <<SQL &
begin;
$first;
select pg_sleep(3);
$finish;
SQL
  first_pid=$!; pids+=("$first_pid")
  wait_for recurring_first "wait_event = 'PgSleep'"
  PGAPPNAME=recurring_second "${psql_cmd[@]}" >"$logs/second" 2>&1 <<SQL &
set statement_timeout = '10s';
do \$\$ declare n bigint; begin
  select rules_materialized into n from $second;
  if n <> $expected then raise exception '$mode returned short batch: expected %, got %', $expected, n; end if;
end \$\$;
SQL
  second_pid=$!; pids+=("$second_pid")
  if ! wait_for recurring_second "wait_event_type = 'Lock'"; then
    wait "$second_pid" || true; printf '%s\n' 'second worker output:' >&2; builtin read -r -d '' output <"$logs/second" || true; printf '%s\n' "$output" >&2; exit 1
  fi
  # A scoped call for another user must not wait for this user's rule.
  if [[ $mode != scoped-first ]]; then
    "${psql_cmd[@]}" <<SQL
set statement_timeout = '1s';
do \$\$ declare n bigint; begin
  select rules_materialized into n from public.materialize_recurring_transactions_for_user(930002, '$month', 1);
  if n <> 1 then raise exception 'independent user batch: %', n; end if;
end \$\$;
SQL
  fi
  wait "$first_pid" || { printf 'first worker failed: '; printf '%s\n' "$(<"$logs/first")"; exit 1; }
  wait "$second_pid" || { printf 'second worker failed: '; printf '%s\n' "$(<"$logs/second")"; exit 1; }
  pids=()
  if [[ $mode == limited ]]; then
    "${psql_cmd[@]}" <<SQL
do \$\$ declare n bigint; begin
  select rules_materialized into n from public.materialize_recurring_transactions_for_user(930001, '$month', 100);
  if n <> 1 then raise exception 'limited batch did not leave exactly one rule: %', n; end if;
end \$\$;
SQL
  fi
  "${psql_cmd[@]}" <<SQL
do \$\$ declare n bigint; expected_amount integer; begin
  select rules_materialized into n from public.materialize_recurring_transactions('$month', 100);
  if n <> 0 then raise exception 'materialization was not complete after $mode: %', n; end if;
  expected_amount := case when '$mode' in ('edit-commit', 'edit-rollback', 'limited') then 150 else 100 end;
  if (select count(*) from public.recurring_rule_runs where month = '$month' and telegram_user_id in (930001, 930002)) <> 4
     or (select count(*) from public.transactions where occurred_on = ('$month' || '-01')::date and telegram_user_id in (930001, 930002) and recurring_rule_id between 930001 and 930004) <> 7
     or (select count(*) from public.transactions where recurring_rule_id = 930001 and occurred_on = ('$month' || '-01')::date and telegram_user_id = 930001 and kind = 'expense' and category_id = 930001 and amount_cents = -expected_amount) <> 1
     or (select count(*) from public.transactions where recurring_rule_id = 930002 and occurred_on = ('$month' || '-01')::date and telegram_user_id = 930001 and transfer_group_id is not null and abs(amount_cents) = 200) <> 2 then
    raise exception 'incorrect run claims or transaction legs after $mode';
  end if;
end \$\$;
SQL
done

# Batch limits must still count materialized rules, not already-claimed rows.
"${psql_cmd[@]}" <<'SQL'
do $$ declare n bigint; u bigint; begin
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions('2024-06', 1);
  if n <> 1 or u <> 1 then raise exception 'first limited batch: %, %', u, n; end if;
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions_for_user(930001, '2024-06', 2);
  if n <> 2 or u <> 1 then raise exception 'second scoped batch: %, %', u, n; end if;
  if exists (select 1 from public.recurring_rule_runs where telegram_user_id = 930002 and month = '2024-06') then
    raise exception 'scoped batch crossed users';
  end if;
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions('2024-06', 2);
  if n <> 1 or u <> 1 then raise exception 'last limited batch: %, %', u, n; end if;
  select users_processed, rules_materialized into u, n from public.materialize_recurring_transactions('2024-08', 4);
  if n <> 4 or u <> 2 then raise exception 'multi-user batch: %, %', u, n; end if;
end $$;
-- Stronger isolation cannot supply the fresh snapshots required after waiting.
begin isolation level repeatable read;
do $$ begin
  begin
    perform * from public.materialize_recurring_transactions('2024-07', 1);
    raise exception 'repeatable read unexpectedly accepted';
  exception when sqlstate '25001' then null; end;
  begin
    perform * from public.materialize_recurring_transactions_for_user(930001, '2024-07', 1);
    raise exception 'scoped repeatable read unexpectedly accepted';
  exception when sqlstate '25001' then null; end;
end $$;
rollback;
begin isolation level serializable;
do $$ begin
  begin
    perform * from public.materialize_recurring_transactions_for_user(930001, '2024-07', 1);
    raise exception 'serializable unexpectedly accepted';
  exception when sqlstate '25001' then null; end;
  begin
    perform * from public.materialize_recurring_transactions('2024-07', 1);
    raise exception 'global serializable unexpectedly accepted';
  exception when sqlstate '25001' then null; end;
end $$;
rollback;
SQL
echo 'concurrent recurring materialization passed'
