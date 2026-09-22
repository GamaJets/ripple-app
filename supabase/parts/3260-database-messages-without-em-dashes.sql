-- Messages the database writes for people, without em dashes.
--
-- A TestFlight tester read the em dash as the sign of an app written by a
-- machine, and the app's own strings lost theirs on 21 Sep 2026
-- (scripts/check-dash.mjs). About forty were still inside functions here:
-- notification bodies (a chargeback, a declined subscription card, a waitlist
-- seat), refusals (an invoice that cannot be edited, a pack that was not drawn
-- down) and the gym's event log.
--
-- Rewritten where they live rather than by hand, one function at a time, so
-- no function is re-created from an older part with older logic: each
-- definition is read back from the catalogue, every " — " becomes a full stop
-- with the next letter capitalised, and it is re-created as it was. A lone
-- "—" (an unknown figure) has no spaces round it and is left alone. Comments
-- change too, which is harmless. CREATE OR REPLACE keeps the owner, the grants,
-- SECURITY DEFINER and the search_path, which pg_get_functiondef writes out.
--
-- Idempotent: a second run finds nothing to change. Functions that belong to
-- an extension are not touched.
do $$
declare
  f record;
  d text;
  i int;
begin
  for f in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')
       and strpos(pg_get_functiondef(p.oid), ' — ') > 0
  loop
    d := pg_get_functiondef(f.oid);
    loop
      i := strpos(d, ' — ');
      exit when i = 0;
      d := left(d, i - 1) || '. ' || upper(substr(d, i + 3, 1)) || substr(d, i + 4);
    end loop;
    execute d;
  end loop;
end
$$;
