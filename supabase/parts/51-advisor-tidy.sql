-- ─────────────────────────────────────────────────────────────────────────
-- Clearing the security advisor, and recording which of it mattered.
--
-- Three notices on 27 Aug 2026. None of them was a hole. Written down because
-- the advisor will raise them again for the next person, and "we looked, and
-- here is why it is fine" is worth more on disk than in somebody's memory.
--
-- 1. Nine trigger functions carried EXECUTE for anon and authenticated.
--
--    40-function-grants.sql skips trigger functions on purpose and says why:
--    PostgREST does not expose a function returning `trigger` as an RPC, so
--    there is no route to reach one, and plpgsql refuses to run a trigger
--    function outside a trigger even if there were. The advisor reads the
--    grant rather than the route, so it flags them.
--
--    Revoked here anyway. It costs nothing, and a grant nobody can account for
--    is one somebody later mistakes for deliberate.
--
--    Triggers keep firing. Postgres checks EXECUTE when a trigger is CREATED,
--    not each time it fires, and the proof is already in production:
--    handle_new_user and provision_profile have carried no anon or
--    authenticated grant all along and run on every single signup.
--
-- 2. public.photo_purge has RLS enabled and no policies.
--
--    That already denies everyone except service_role and the SECURITY
--    DEFINER functions that work the queue, which is exactly what this table
--    wants. But the denial is implicit, and an implicit denial reads like an
--    unfinished table — one `create policy` away from somebody "completing"
--    it. Made explicit instead.
--
-- 3. guard_profile_identity has a mutable search_path.
--
--    Worth being accurate about: it is SECURITY INVOKER, not DEFINER. It runs
--    as the caller, so the search_path escalation that makes this dangerous on
--    a DEFINER function does not apply, and its body resolves no tables at all.
--    Set regardless, so every function in the schema answers the same way.
--
-- Idempotent. Safe to re-run, and worth re-running after adding any trigger.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ── trigger functions are not callable by anyone.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_function_result(p.oid) = 'trigger'
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end $$;

-- 3 ── and they all pin a search_path, as the rest of the schema does.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_function_result(p.oid) = 'trigger'
      and p.proconfig is null
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;

-- 2 ── the purge queue says out loud that it is nobody's to read.
drop policy if exists "photo_purge belongs to the purge job" on public.photo_purge;
create policy "photo_purge belongs to the purge job"
  on public.photo_purge
  for all
  to anon, authenticated
  using (false)
  with check (false);
