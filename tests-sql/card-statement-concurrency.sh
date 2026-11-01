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
echo 'concurrent snapshot and grouped edit passed'
