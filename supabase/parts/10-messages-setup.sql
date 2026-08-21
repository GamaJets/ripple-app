-- ─────────────────────────────────────────────────────────────────────────
-- Repple messaging — RLS + realtime for the coach↔client chat thread.
-- The thread is keyed by the client's id (messages.client_id = the client).
-- Depends on schema.sql (messages, clients) + domain-schema.sql (is_my_client).
-- Idempotent; safe to re-run.

alter table messages enable row level security;

drop policy if exists msg_client on messages;
create policy msg_client on messages for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid() and sender = 'client');

drop policy if exists msg_coach on messages;
create policy msg_coach on messages for all
  using (is_my_client(client_id))
  with check (is_my_client(client_id) and sender = 'coach');

do $$
begin
  begin
    alter publication supabase_realtime add table messages;
  exception
    when duplicate_object then null;
    when others then null;
  end;
end $$;


-- ─────────────────────────────────────────────────────────────────────────
