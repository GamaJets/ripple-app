-- ─────────────────────────────────────────────────────────────────────────
-- Asking twice must not push the deadline away from you.
--
-- request_account_deletion() has been unconditional since 02-domain-schema.sql:
--
--   update profiles set deletion_requested_at = now() where id = auth.uid();
--
-- So a second call overwrites the first timestamp with a later one. The clock
-- the public page promises — actioned within 30 days of asking — restarts, and
-- pending_deletions.days_remaining jumps back up to 30. The person waited
-- longer by asking again, which is the opposite of what pressing the button
-- twice means.
--
-- This is not hypothetical. The client settings screen offers the request
-- again whenever it cannot READ the current state (a failed read must not
-- block anyone's right to erasure), so the double-call path is one dropped
-- connection away, and it is reachable by exactly the person least likely to
-- notice their deadline moved.
--
-- The fix is a where-clause, not a raise. Asking to be deleted when you have
-- already asked is not an error to be shouted at — the state you wanted is the
-- state you are in. It returns quietly, the original timestamp stands, and the
-- call stays idempotent for a client that retries.
--
-- Withdrawing still clears the flag, so withdraw-then-ask-again correctly
-- starts a fresh clock. That is a different act from asking twice.
--
-- `create or replace` keeps the function's existing ACL — only `drop function`
-- discards it — so the authenticated-only grant from 40-function-grants.sql
-- survives this. Verified with has_function_privilege after applying rather
-- than assumed, because that exact assumption was wrong earlier in this
-- schema's history.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.request_account_deletion()
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles
     set deletion_requested_at = now()
   where id = auth.uid()
     and deletion_requested_at is null;   -- the first ask is the one that counts
end $$;
