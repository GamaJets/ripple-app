-- ─────────────────────────────────────────────────────────────────────────
-- Nine RPCs anon could still call, and six trigger functions it could too.
--
-- 40-function-grants.sql closed this once and says so at the top: "Postgres
-- grants EXECUTE to PUBLIC on every function it creates … RE-RUN THIS after
-- adding or recreating any function." 51-advisor-tidy.sql did the same for
-- trigger functions and pinned their search_path.
--
-- Neither was re-run. Every function created by a part numbered above 51 —
-- parts 100 to 140, a whole night of them — arrived with the PUBLIC grant
-- intact, and with the `anon` and `authenticated` grants that Supabase's own
-- ALTER DEFAULT PRIVILEGES hands to every new function in `public`. Measured
-- against the live database tonight, `anon` — the key compiled into the
-- shipped app — could execute:
--
--   block_time, book_session, cancel_session, claim_tenant_brand,
--   join_by_code, my_join_code, my_join_code_stats, my_tenant_brand,
--   rotate_join_code
--
-- plus session_span() and six trigger functions. join_by_code is the one that
-- matters most: a join code is a credential, and an unauthenticated caller
-- with the publishable key had an oracle to try them against.
--
-- Note the shape of the ACLs this was found in. my_tenant_brand and
-- claim_tenant_brand had NO public grant — their part had revoked it — and
-- were still anon-callable, because Supabase grants to `anon` and to
-- `authenticated` SEPARATELY and `revoke … from public` leaves both standing.
-- Revoking PUBLIC is not revoking anon.
--
-- ── Why this is not simply "re-run part 40" ───────────────────────────────
--
-- Part 40's loop ends with `grant execute … to authenticated` on EVERY
-- non-trigger function. Run standalone against the database as it is now,
-- that would hand `authenticated` the four functions 100-ad-accounts.sql
-- deliberately keeps for the service role alone — set_synced_spend,
-- record_ad_sync, store_ad_account, choose_ad_account — undoing a narrowing
-- that was made on purpose. Inside the bundle part 40 runs before part 100,
-- so 100 re-narrows afterwards and the order saves it; standalone there is
-- nothing after it.
--
-- So this part only ever REVOKES. Nothing here can widen anything. Every
-- function that should be callable by a signed-in user already carries an
-- explicit `authenticated` grant — from part 40, from its own part, or from
-- Supabase's default privileges on creation — and revoking PUBLIC and anon
-- does not touch it. Verified against the live ACLs before this was written.
--
-- Trigger functions are revoked from all three, as part 51 does, and for the
-- reason part 51 gives: Postgres checks EXECUTE when a trigger is CREATED,
-- not each time it fires. handle_new_user has carried no grant at all since
-- the beginning and runs on every signup.
--
-- Extension-owned functions are skipped. btree_gist arrived with part 86's
-- exclusion constraint and put ~200 gbt_* functions in `public`; they are not
-- ours to re-privilege, and part 40's loop predates them.
--
-- Idempotent. Re-run it after adding any function — and unlike part 40, it is
-- safe to re-run standalone at any point.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ── no RPC is reachable without signing in.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and p.prokind = 'f'
      and d.objid is null
      and pg_get_function_result(p.oid) <> 'trigger'
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;

-- 2 ── trigger functions are not callable by anyone.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and p.prokind = 'f'
      and d.objid is null
      and pg_get_function_result(p.oid) = 'trigger'
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end $$;

-- 3 ── and every trigger function pins a search_path, as the rest do.
--
-- guard_tenant_brand() was the last one without. It is SECURITY INVOKER, so
-- the escalation that makes a mutable search_path dangerous on a DEFINER
-- function does not apply to it — set regardless, so every function in the
-- schema answers the same way.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and p.prokind = 'f'
      and d.objid is null
      and pg_get_function_result(p.oid) = 'trigger'
      and p.proconfig is null
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
