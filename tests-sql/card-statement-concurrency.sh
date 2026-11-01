#!/usr/bin/env bash
# Run only against a disposable database with schema.sql applied. Uses the
# normal PG* environment variables; exercises two real concurrent sessions.
set -euo pipefail
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -q)
log=$(mktemp)
cleanup() {
  "${psql_cmd[@]}" <<'SQL' >/dev/null
    delete from public.transactions where telegram_user_id = 910099;
    delete from public.card_statement_snapshots where telegram_user_id = 910099;
    delete from public.accounts where telegram_user_id = 910099;
    delete from public.users where telegram_user_id = 910099;
SQL
  rm -f "$log"
}
"${psql_cmd[@]}" <<'SQL'
begin;
insert into public.users (telegram_user_id) values (910099);
insert into public.accounts (id, telegram_user_id, account_key, name, account_type) overriding system value values
  (910098, 910099, 'concurrency-bank', 'Bank', 'bank'),
  (910099, 910099, 'concurrency-card', 'Card', 'card');
insert into public.transactions (telegram_user_id, kind, account_id, transfer_group_id, description, amount_cents) values
  (910099, 'expense', 910098, '00000000-0000-0000-0000-000000000099', 'Payment', -3000),
  (910099, 'transfer', 910099, '00000000-0000-0000-0000-000000000099', 'Payment', 3000);
commit;
SQL
trap cleanup EXIT
# The update RPC changes both legs within this transaction. Hold it open while
# another connection captures a snapshot and reads the grouped payment.
PGAPPNAME=statement_concurrency_writer "${psql_cmd[@]}" >"$log" 2>&1 <<'SQL' &
begin;
select public.update_transfer_group(910099, '00000000-0000-0000-0000-000000000099', 910098, 910099, 'Payment', 1000, '2024-01-31', false);
select pg_sleep(5);
commit;
SQL
writer=$!
ready=0
for _ in {1..100}; do
  if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = 'statement_concurrency_writer' and wait_event = 'PgSleep'") == 1 ]]; then ready=1; break; fi
  sleep 0.03
done
if [[ $ready != 1 ]]; then echo 'writer did not reach concurrent window' >&2; wait "$writer" || true; exit 1; fi
"${psql_cmd[@]}" <<'SQL'
do $$
declare data jsonb;
begin
  perform public.create_card_statement_snapshot(910099, 910099, '2024-01-31', '2024-02-20', 10000, 7000);
  data := public.read_card_statement_inputs(910099);
  if (data->'payments'->0->>'amountCents')::integer <> 3000 or
     (data->'statements'->0->'payment_baseline'->0->>'amountCents')::integer <> 3000 then
    raise exception 'uncommitted edit produced an inconsistent snapshot: %', data;
  end if;
end $$;
SQL
wait "$writer" || { echo 'writer failed' >&2; exit 1; }
"${psql_cmd[@]}" <<'SQL'
do $$
declare data jsonb := public.read_card_statement_inputs(910099);
begin
  if (data->'payments'->0->>'amountCents')::integer <> 1000 or
     (data->'statements'->0->'payment_baseline'->0->>'amountCents')::integer <> 3000 then
    raise exception 'committed edit or immutable baseline missing: %', data;
  end if;
end $$;
SQL
# Exercise both capture paths in both positions. The waiter starts its RPC
# before the payment edit commits and must read a new READ COMMITTED command
# snapshot after the advisory lock is released (not its outer SELECT snapshot).
for mode in create-first rebaseline-first; do
  "${psql_cmd[@]}" <<'SQL'
delete from public.card_statement_snapshots where telegram_user_id = 910099;
insert into public.card_statement_snapshots (telegram_user_id, account_id, closing_date, due_date, original_amount_cents, remaining_amount_cents, payment_baseline)
values (910099, 910099, '2024-02-29', '2024-03-20', 10000, 9000, null);
select public.update_transfer_group(910099, '00000000-0000-0000-0000-000000000099', 910098, 910099, 'Payment', 1000, '2024-01-31', false);
SQL
  create="select public.create_card_statement_snapshot(910099, 910099, '2024-01-31', '2024-02-20', 10000, 9000)"
  rebaseline="select public.rebaseline_legacy_card_statement(910099, 910099, '2024-02-29', '2024-03-20', 10000, 9000)"
  if [[ $mode == create-first ]]; then first=$create; second=$rebaseline; else first=$rebaseline; second=$create; fi
  PGAPPNAME=statement_capture_first "${psql_cmd[@]}" >"$log" 2>&1 <<SQL &
begin;
$first;
select pg_sleep(5);
commit;
SQL
  first_pid=$!
  ready=0
  for _ in {1..100}; do
    if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = 'statement_capture_first' and wait_event = 'PgSleep'") == 1 ]]; then ready=1; break; fi
    sleep 0.03
  done
  if [[ $ready != 1 ]]; then echo 'first capture did not reach concurrent window' >&2; wait "$first_pid" || true; exit 1; fi
  PGAPPNAME=statement_capture_second "${psql_cmd[@]}" -c "$second" >>"$log" 2>&1 &
  second_pid=$!
  ready=0
  for _ in {1..100}; do
    if [[ $("${psql_cmd[@]}" -Atc "select count(*) from pg_stat_activity where application_name = 'statement_capture_second' and wait_event_type = 'Lock' and wait_event = 'advisory'") == 1 ]]; then ready=1; break; fi
    sleep 0.03
  done
  if [[ $ready != 1 ]]; then echo 'second capture did not wait for advisory lock' >&2; wait "$first_pid" || true; wait "$second_pid" || true; exit 1; fi
  "${psql_cmd[@]}" -c "select public.update_transfer_group(910099, '00000000-0000-0000-0000-000000000099', 910098, 910099, 'Payment', 3000, '2024-01-31', false)"
  wait "$first_pid" || { echo 'first capture failed' >&2; exit 1; }
  wait "$second_pid" || { echo 'second capture failed' >&2; exit 1; }
  "${psql_cmd[@]}" <<'SQL'
do $$
declare captured jsonb;
begin
  select jsonb_agg(jsonb_build_object('order', capture_order, 'baseline', payment_baseline) order by capture_order)
    into captured from public.card_statement_snapshots where telegram_user_id = 910099;
  if jsonb_array_length(captured) <> 2 or
     (captured->0->'baseline'->0->>'amountCents')::integer is distinct from 1000 or
     (captured->1->'baseline'->0->>'amountCents')::integer is distinct from 3000 then
    raise exception 'capture order does not match observed baselines: %', captured;
  end if;
end $$;
SQL
done
# Reject transaction-snapshot isolation rather than silently recording stale
# baselines after waiting, for either entry point.
"${psql_cmd[@]}" <<'SQL'
begin isolation level repeatable read;
do $$
begin
  begin
    perform public.create_card_statement_snapshot(910099, 910099, '2024-04-30', '2024-05-20', 10000, 9000);
    raise exception 'create unexpectedly accepted repeatable read';
  exception when raise_exception then
    if sqlerrm <> 'Card statement capture requires READ COMMITTED isolation' then raise; end if;
  end;
  begin
    perform public.rebaseline_legacy_card_statement(910099, 910099, '2024-02-29', '2024-03-20', 10000, 9000);
    raise exception 'rebaseline unexpectedly accepted repeatable read';
  exception when raise_exception then
    if sqlerrm <> 'Card statement capture requires READ COMMITTED isolation' then raise; end if;
  end;
end $$;
rollback;
SQL
echo 'concurrent snapshots, rebaselines and grouped edit passed'
