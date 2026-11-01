-- Non-card accounts cannot be recovered as cards. Keep their
-- snapshots for if the account becomes a card again, but exclude them from
-- card status until then. Both reads remain in the same MVCC snapshot.
create or replace function public.read_card_statement_inputs(target_user_id bigint)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'statements', coalesce((select jsonb_agg(to_jsonb(s) order by s.closing_date, s.id)
      from public.card_statement_snapshots s
      join public.accounts a on a.id = s.account_id and a.telegram_user_id = s.telegram_user_id
      where s.telegram_user_id = target_user_id and a.account_type = 'card'), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('groupId', p.group_id, 'accountId', p.account_id, 'amountCents', p.amount_cents))
      from public.card_statement_payments(target_user_id) p), '[]'::jsonb)
  );
$$;
