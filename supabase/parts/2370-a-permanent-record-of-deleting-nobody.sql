-- ═══════════════════════════════════════════════════════════════════════════
-- "This permanently erases  and everything of theirs"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIED. Verified after: the view and the function both carry
-- nullif(btrim(full_name), ''), anon cannot execute the function, and the
-- count of anon-executable SECURITY DEFINER functions held at 2.
--
-- A blank name, carried from an unguarded text field all the way into an audit
-- row that outlives the account it describes — and read out, on the way, in the
-- confirmation for an irreversible delete.
--
-- ── the chain, all three halves verified live ─────────────────────────────
--
--  1. app/(trainer)/profile.tsx's Name field writes raw state: no trim, no
--     blank guard, and src/ui/coachProfile.tsx passes it straight into
--     `.update({ full_name: v.name })`. A coach who clears that field stores an
--     empty string for real. The CLIENT app guards the identical field —
--     `cd.setName(nameVal.trim() || cd.name)` — so the coach path is the odd
--     one out rather than the norm.
--
--  2. This part's half. Neither `pending_deletions` nor
--     `action_account_deletion()` guards the column, checked against the LIVE
--     objects rather than the parts. `my_coach()` (part 115) and
--     `my_coach_profile()` (part 130) both `nullif` this exact column, so the
--     guard exists in this schema and was simply missing here.
--
--  3. app/(owner)/deletions.tsx reads it with `??`, which does not catch `''`,
--     and `fig('')` returns an empty string rather than a dash.
--
-- ── why the SQL half is the one that matters ──────────────────────────────
--
-- `action_account_deletion()` copies `full_name` into
-- `deletion_log.subject_label` and then deletes the account in the very next
-- statement. `deletion_log` is the permanent record of an irreversible act,
-- kept precisely because the profile is gone. A blank frozen there cannot be
-- repaired from the row, because the row is the only thing left — the name it
-- was supposed to preserve was deleted a line later.
--
-- The other two halves show a bad screen. This one destroys the evidence.
--
-- ── what the owner saw ────────────────────────────────────────────────────
--
-- On app/(owner)/deletions.tsx, whose entire job is unambiguous identification
-- before an irreversible delete: a blank row in the queue, a confirmation
-- headed "Delete ?", and a body reading "This permanently erases  and
-- everything of theirs — their profile, workouts, logs, scans, messages and
-- bookings, across 39 tables."
--
-- That is a QUOTATION of the confirmation as it stood when this part was
-- written, kept verbatim because the blank is the defect this part is about.
-- Two of its other words have since been corrected on the screen itself, and
-- this note is here so the quotation above is not read as the current wording
-- or as a figure anybody should copy.
--
-- ── the "39 tables" in that quotation was itself wrong ─────────────────────
--
-- 39 came from a live count taken when `action_account_deletion()` was
-- written, when this schema was about a quarter of its present size, and it
-- was never re-counted. It is not stale by a little. The function ends with
-- `delete from auth.users where id = p_subject`, so the blast radius is the
-- transitive closure of `on delete cascade` from `auth.users`, and measured
-- against the LIVE catalogue on 14 September 2026 (project
-- phgfwzpkkwdysftlgkoq) that is 118 tables in `public` plus 11 inside
-- Supabase's own `auth` schema — 129 in all:
--
--   with recursive fk as (
--     select (conrelid::regclass)::text  as child,
--            (confrelid::regclass)::text as parent
--       from pg_constraint
--      where contype = 'f' and confdeltype = 'c')
--   , rec as (
--     select 'auth.users'::text as tbl
--      union
--     select fk.child from fk join rec on fk.parent = rec.tbl)
--   select count(*) from rec;
--
-- Re-run that query rather than counting clauses in supabase/setup.sql. The
-- file parse gives 125 and is wrong: a `create table` clause is not the last
-- word on a foreign key, and the retention part named below drops three of
-- them and recreates them with a different action. (Cited by constraint name
-- rather than by line: setup.sql is generated from 349 parts and every line
-- number in it moves the next time a part is added.)
-- app/(owner)/deletions.tsx holds the
-- 118 in `CASCADE_TABLES` with the same provenance, and the owner console
-- states it inline.
--
-- ── and the sentence next to it was inverted ───────────────────────────────
--
-- The same confirmation went on to say the member's invoices and memberships
-- went too. They do not. The retention part of this schema — the one adding
-- `gym_invoices.billed_name`, `gym_payments.payer_name` and
-- `memberships.member_label` — drops `memberships_member_id_fkey`,
-- `gym_invoices_member_id_fkey` and `gym_payments_member_id_fkey` and
-- recreates all three ON DELETE SET NULL, with a BEFORE DELETE trigger
-- copying the name across first, precisely so a gym's financial record
-- outlives the erasure. Confirmed live on 14 September 2026, all three
-- `confdeltype = 'n'`:
--
--   select conname, confdeltype from pg_constraint
--    where conname in ('memberships_member_id_fkey',
--                      'gym_invoices_member_id_fkey',
--                      'gym_payments_member_id_fkey');
--
-- So the copy told an owner their financial record would be destroyed at the
-- moment they were deciding whether to press a button with no undo. Note also
-- that the surviving rows are detached, NOT anonymous: `gym_passes.holder_name`,
-- `gym_agreement_signatures.signed_name` and `.guardian_name`,
-- `staff_grants.subject_name` and `gym_events.summary` all keep the name by
-- design. Which is the other reason the blank `full_name` this part guards
-- matters: a name copied onto a surviving row is a blank copied onto it.
--
-- ── latent, not damage ────────────────────────────────────────────────────
--
-- Live counts at the time of writing: 0 profiles with a blank or whitespace
-- `full_name`, 0 `deletion_log` rows with a blank `subject_label`. Nothing has
-- fired. That is the argument for closing it now rather than after — this is
-- the one defect in tonight's set where the damage, once done, cannot be
-- undone by fixing the code.
--
-- ── shape of the fix ──────────────────────────────────────────────────────
--
-- `nullif(btrim(...), '')` in both, which is the form parts 115 and 130
-- already use on this column, so a blank arrives as NULL and every reader's
-- existing null handling takes over. Nothing here invents a placeholder: the
-- screens already know how to say "this account" when there is no name, and a
-- name that was never given should read as absent rather than as a name that
-- happens to be empty.
--
-- No backfill, and it needs none: there are no blank rows to repair. If one
-- ever appears in `deletion_log` it cannot be repaired anyway, which is the
-- whole point of the guard being here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · the view the owner's queue reads ──────────────────────────────────
-- The WITH clause is not decoration and is not optional. `create or replace
-- view` with no WITH clause RESETS the view's reloptions, so omitting it here
-- silently stripped `security_invoker` off a view that part 41 created with it
-- — see this part's postscript. Every view in this schema carries it.
create or replace view public.pending_deletions
with (security_invoker = true) as
  select id as subject_id,
         tenant_id,
         -- A name nobody typed is absent, not empty. Same form as my_coach()
         -- and my_coach_profile() use on this column.
         nullif(btrim(full_name), '') as full_name,
         role,
         deletion_requested_at,
         greatest(0, 30 - extract(day from now() - deletion_requested_at)::integer) as days_remaining
    from profiles p
   where deletion_requested_at is not null;

-- The view carried the Supabase default grants, which give anon full DML on
-- anything created in `public`. Restated to what this view actually needs.
revoke all on public.pending_deletions from anon;
revoke insert, update, delete on public.pending_deletions from authenticated;
grant select on public.pending_deletions to authenticated;

-- ── 2 · the function that freezes it ──────────────────────────────────────
create or replace function public.action_account_deletion(p_subject uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare subj_tenant uuid; subj_name text; subj_requested timestamptz;
begin
  -- Guarded at the read, so every use below sees the same value. The insert is
  -- the one that matters: it writes deletion_log.subject_label and the profile
  -- is deleted on the next line, so a blank stored here can never be repaired.
  select tenant_id, nullif(btrim(full_name), ''), deletion_requested_at
    into subj_tenant, subj_name, subj_requested
  from profiles where id = p_subject;
  if not found then raise exception 'No such account.' using errcode = 'P0002'; end if;
  if subj_requested is null then
    raise exception 'That member has not asked to be deleted.' using errcode = '42501';
  end if;
  if not is_owner_of(subj_tenant) then
    raise exception 'Only the owner of that gym can action this.' using errcode = '42501';
  end if;
  insert into deletion_log (tenant_id, subject_id, subject_label, requested_at, actioned_by)
  values (subj_tenant, p_subject, subj_name, subj_requested, auth.uid());
  delete from auth.users where id = p_subject;
end $function$;

-- Restated because `create or replace` on a function that did not previously
-- exist leaves EXECUTE with PUBLIC, which in a Supabase project includes anon.
revoke all on function public.action_account_deletion(uuid) from public, anon;
grant execute on function public.action_account_deletion(uuid) to authenticated;

-- ── postscript · what the first version of this part broke ────────────────
--
-- The first applied version of section 1 was `create or replace view
-- public.pending_deletions as ...` with no WITH clause. Part 41 created this
-- view `with (security_invoker = true)`; `create or replace view` resets
-- reloptions that the new statement does not restate, so that one omission
-- turned it back into a definer view owned by `postgres`.
--
-- A definer view does not consult the RLS on the table underneath it. This view
-- selects from `profiles`, and `profiles` is where the tenant boundary lives.
-- Worse, the view carried the Supabase default grants — anon and authenticated
-- both held SELECT — so for as long as it stood, the deletion queue of EVERY
-- gym was readable: names, tenant ids, and the date each member asked to be
-- erased. Signed out was enough.
--
-- Nothing in the app would have shown it, which is the part worth keeping. All
-- three readers state in a comment that they deliberately do NOT filter by
-- tenant, because the view is invoker-scoped and therefore already scoped:
-- app/(owner)/deletions.tsx:29, app/(owner)/settings.tsx:227 and
-- studio-web/app/deletions/page.tsx:32. Their isolation was entirely this one
-- reloption. The screens would have looked identical and been wrong.
--
-- Found by get_advisors, which reported `security_definer_view` against
-- `pending_deletions` — the only view of the six in this schema without the
-- flag. Repaired live with `alter view ... set (security_invoker = true)`,
-- verified against pg_class.reloptions, and the grants tightened past where
-- they started: anon now holds nothing on this view and authenticated holds
-- SELECT alone.
--
-- scripts/check-views.mjs exists so the next omission fails the build instead
-- of an advisor run.
