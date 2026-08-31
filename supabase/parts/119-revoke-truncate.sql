-- ── Take TRUNCATE, REFERENCES and TRIGGER off the API roles ────────────────
--
-- Found while adding `coach_notes` (part 108): a table created in this project
-- arrives with `anon` and `authenticated` already holding the full DML set,
-- because Supabase ships stock default privileges. NOT naming a role in a
-- GRANT does not keep it out. 80 of 89 public tables carried an `anon` grant
-- that nobody in this repository wrote.
--
-- Row-level security is on for all 89, and no policy reachable by `anon`
-- resolves without `auth.uid()`, so nothing was exposed. SELECT, INSERT,
-- UPDATE and DELETE are all filtered by policy — which is how Supabase is
-- meant to work — and they are left exactly as they are. Revoking those
-- wholesale is a separate, tested change: the risk is breaking an
-- unauthenticated path nobody has enumerated, and that is not a thing to
-- discover at six in the morning.
--
-- TRUNCATE is different, and it is why this exists:
--
--   **RLS DOES NOT APPLY TO TRUNCATE.** It is a table-level operation. A role
--   holding it can empty a table whatever its policies say, and every
--   carefully-argued policy in this schema is silent on it.
--
-- PostgREST exposes no truncate verb, so it was latent rather than open. It is
-- still the one privilege in the set that policies cannot contain, held by the
-- role any stranger on the internet gets by asking.
--
-- REFERENCES and TRIGGER go with it: neither is ever legitimately exercised by
-- a client role, and both let a grantee attach behaviour to a table they do not
-- own.
--
-- Two passes, because the first filtered on `relkind = 'r'` and so skipped
-- views — `pending_deletions` kept all three. TRUNCATE on a view cannot be
-- executed, so that half is tidiness; a grant nobody wrote and nobody needs
-- reads as deliberate five years later.
--
-- Default privileges are altered as well, so a table created after this does
-- not quietly reinstate what it removes.
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
