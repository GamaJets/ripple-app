-- ─────────────────────────────────────────────────────────────────────────
-- No function in this schema is callable without signing in.
--
-- Postgres grants EXECUTE to PUBLIC on every function it creates. That default
-- is what `anon` resolves through, and `anon` is the key compiled into the
-- shipped mobile app — so every RPC was reachable by anyone who extracted it.
-- Thirty-two SECURITY DEFINER functions had no revoke at all, and the three
-- that did named `anon` rather than PUBLIC, which does nothing.
--
-- Two ways this kept coming back:
--
--   · A new function silently inherits the PUBLIC grant. Nobody has to make a
--     mistake for the hole to exist; it is there unless someone removes it.
--   · `drop function` takes the ACL with it, so recreating a function to fix
--     something else quietly restores the default. That happened today: the
--     class-attendance fix dropped and recreated its function, and the
--     recreated one was anon-callable again until the revoke was re-applied.
--
-- So this is written as a loop over the catalogue rather than a list of names.
-- A list would go stale the first time somebody adds a function, which is
-- exactly how the schema arrived here.
--
-- Trigger functions are skipped: they return `trigger`, PostgREST does not
-- expose them as RPCs, and they are invoked by the trigger rather than called.
--
-- Every function gets `authenticated`, which is strictly narrower than the
-- PUBLIC grant it replaces. This is not the authorization — each function
-- still carries its own tenant check, and that is what stops one gym reading
-- another. This only ensures a caller has proved who they are first.
--
-- Nothing in the product needs anon RPC access. Every call site was checked:
-- record_referral, the one that looks like a pre-auth candidate, records the
-- SIGNED-IN user and runs after sign-up returns a session.
--
-- RE-RUN THIS after adding or recreating any function. It is idempotent.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_function_result(p.oid) <> 'trigger'
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
