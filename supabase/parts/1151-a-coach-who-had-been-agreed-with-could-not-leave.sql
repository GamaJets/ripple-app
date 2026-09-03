-- ═══════════════════════════════════════════════════════════════════════════
-- A coach who had been agreed with could not leave.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- Erasing a coach's account raises 23503 and nothing happens, for any coach
-- one of whose documents anybody has ever accepted or been sent.
--
-- Read off the live catalogue on 3 Sep 2026 rather than reasoned from the SQL
-- files, because the whole point is that no single file contains the fault —
-- it is made of three foreign keys written in three different parts, each of
-- which is right on its own:
--
--     coach_documents.coach_id             → trainers(id)        ON DELETE CASCADE
--     coach_document_acceptances.document_id → coach_documents(id) ON DELETE RESTRICT
--     coach_document_recipients.document_id  → coach_documents(id) ON DELETE RESTRICT
--     trainers.id                          → profiles(id)        ON DELETE CASCADE
--     profiles.id                          → auth.users(id)      ON DELETE CASCADE
--
-- `action_account_deletion()` (part 41) ends with `delete from auth.users where
-- id = p_subject`. That cascades to `profiles`, to `trainers`, and then to
-- `coach_documents` — where the RESTRICT from the acceptance stops it dead and
-- takes the whole transaction with it. Nothing is deleted. The `deletion_log`
-- insert that runs two lines earlier is rolled back with it, so there is not
-- even a record that the attempt was made.
--
-- Each of the three keys is deliberate and each is argued for where it was
-- written. Part 135 makes a coach's document immutable and undeletable because
-- an acceptance points at it: "A coach who could edit the title or swap the
-- file behind an accepted document would hold a signed acceptance of something
-- nobody read." Part 156 repeats the choice for the recipient list and gives
-- the reason in one line: "a cascade here would be the first route to removing
-- one." Both are correct. Neither was thinking about the coach walking away.
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- A personal trainer uploads their studio waiver, requires it, and eleven
-- clients accept it over a year. They then stop trading, or fall out with the
-- gym, or simply want out of a product they no longer use, and ask to be
-- deleted. The gym owner taps the button. The RPC raises a foreign-key error
-- with a constraint name in it, the screen shows whatever it shows for an
-- unexpected failure, and the coach's account — their name, their photo, their
-- bio, their paperwork, their clients' conversations with them — stays exactly
-- where it is. There is no message anywhere that explains why, because nobody
-- wrote one: this is not a refusal the product knows about, it is a constraint
-- violation surfacing through an RPC that expected to succeed.
--
-- Part 41 exists because `request_account_deletion()` wrote a timestamp that
-- nothing read. This is the same defect one layer further down: a deletion path
-- that looks complete, is wired end to end, and cannot finish.
--
-- ── THE ANSWER, AND THE TWO IT IS NOT ────────────────────────────────────
--
-- The question part 135 and part 156 never had to answer is: when the person
-- who OWNS the paperwork erases their account, what happens to the record that
-- somebody agreed to it?
--
-- NOT (a) loosen the foreign keys to CASCADE. That is one line and it is
-- wrong. RESTRICT is doing real work every other day of the year: it is the
-- last thing standing between an accepted document and a route to deleting it,
-- and part 156 names it as such. A cascade would make every future path to
-- `delete from coach_documents` — an admin fixing a typo, a cleanup script, a
-- policy somebody adds — silently take the acceptances with it. The
-- constraints stay exactly as they are.
--
-- NOT (b) refuse the erasure and tell the coach they cannot leave while
-- somebody holds an acceptance. That is what happens today, minus the
-- explanation, and it is not defensible. The acceptance is a record about the
-- COACH's document; the person asking to be erased is the coach. There is no
-- statutory retention behind a personal trainer's own par-form the way there is
-- behind an invoice (part 184, and `tenants.record_retention_years`), and this
-- product does not get to keep somebody's identity indefinitely because their
-- clients ticked a box.
--
-- SO (c): one named route, and only one. A BEFORE DELETE trigger on
-- `public.profiles` releases the acceptances and the recipient rows for the
-- documents that are about to cascade, and NOTHING ELSE can. The foreign keys
-- keep refusing every other caller. Deleting an accepted document is still
-- impossible; deleting the ACCOUNT THAT OWNS IT is now possible, and it is the
-- only thing that is.
--
-- The consequence is stated plainly rather than buried: when a coach erases
-- their account, the record that a client accepted that coach's waiver goes
-- too. That is the correct end of the trade and it costs something real. The
-- alternative is keeping the document — which means keeping the coach's uid in
-- the object key, their file in the bucket and their row in `coach_documents`
-- forever — which is not retention, it is a refusal to erase wearing
-- retention's clothes.
--
-- ── WHERE THE TRIGGER GOES, AND WHY NOT IN action_account_deletion() ─────
--
-- On `profiles`, for the reason part 1120 gives at length and part 184 relies
-- on: a cascading delete fires row triggers on the child table, so this runs
-- whether the erasure came from `action_account_deletion()`, from the Supabase
-- dashboard, or from the admin API. Inside the RPC it would cover the first
-- only, and the other two are the routes an operator uses when something has
-- already gone wrong.
--
-- BEFORE DELETE, because the release has to happen while `coach_documents`
-- still exists to identify the rows by.
--
-- ── WHAT ELSE WAS CHECKED ────────────────────────────────────────────────
--
-- The same catalogue sweep, for every RESTRICT or NO ACTION delete rule in
-- `public`, returns six and only these two sit on a path from `profiles`:
--
--     coach_document_acceptances.document_id → coach_documents  RESTRICT  ← this
--     coach_document_recipients.document_id  → coach_documents  RESTRICT  ← this
--     gym_agreement_signatures.agreement_id  → gym_agreements   RESTRICT
--     gym_payments.reverses_payment_id       → gym_payments     RESTRICT
--     exercise_videos.exercise_id            → exercises        NO ACTION
--     workout_logs.exercise_id               → exercises        NO ACTION
--
-- The third blocks deleting a TENANT whose agreements have been signed, not a
-- person: `gym_agreement_signatures.member_id` is `on delete set null`, so a
-- member's erasure passes through it. Nothing in this product deletes a tenant,
-- and whether a gym should be erasable at all is a different question from this
-- one. It is written down here so the next person does not have to re-run the
-- query. The last three are not on any erasure path.
--
-- ── MEASURED BEFORE WRITING ──────────────────────────────────────────────
--
-- Live on 3 Sep 2026, read-only: `coach_documents` 0 rows,
-- `coach_document_acceptances` 0, `coach_document_recipients` 0, `trainers` 8,
-- `profiles` 20. So no coach is stuck today and applying this deletes nothing.
-- It closes the hole before the first coach uploads their first waiver, which
-- is the only cheap moment — after that, the first person to hit it is a real
-- coach being told nothing while an owner taps a button that does not work.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
--   · It does not alter a foreign key. Every constraint above is untouched.
--   · It does not delete a `coach_documents` row. The cascade does that, from
--     `trainers`, exactly as part 135 wrote it.
--   · It does not touch `liability_waivers` (part 84), which is Repple's own
--     release and is nothing to do with this table — part 135 is emphatic about
--     that and this file does not name it again.
--   · It does not remove the bytes from `coach-docs`. That is part 1152, which
--     must be applied with this one; see its header for the order.
--   · It does not touch a CLIENT's erasure. That path already works and is
--     already right: `coach_document_acceptances.client_id` references
--     `clients(id) on delete cascade` and `clients.id` references
--     `profiles(id) on delete cascade`, so an erased client's acceptances go
--     with them and `coach_doc_unaccepted()` starts answering true again for
--     any document nobody else has accepted — which is the coach regaining the
--     right to delete a file that no longer anchors anybody's evidence. That is
--     the correct behaviour and it needs no code.
--
-- Idempotent and safe to re-run: `or replace` on the function, the trigger
-- dropped by name first.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The release
-- ═════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER, and it must be: neither table has an UPDATE or DELETE
-- policy and neither has a DELETE grant behind one — that is the whole of part
-- 135 § 4 and part 156 § 1 — so nothing running as `authenticated` can remove
-- these rows and nothing should be able to. The function's owner is the role
-- that applies setup.sql. The trigger is the only caller.
--
-- Scoped by `coach_documents.coach_id = old.id` and by nothing else. It cannot
-- reach an acceptance of a document belonging to any other coach, and it takes
-- no argument, so there is no shape of it that could be aimed at somebody.
--
-- No exception block. If the release fails, the erasure must fail loudly rather
-- than proceed to the RESTRICT and fail confusingly — and a caught exception
-- here would be a savepoint rollback that leaves the same 23503 waiting two
-- statements later. Part 1120 makes the same call for the same reason.

create or replace function public.profiles_release_coach_documents()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Recipients first. Neither table references the other, so the order is
  -- arbitrary to Postgres; it is written this way because a recipient row is
  -- the weaker record — who a document was put in front of — and an acceptance
  -- is the one this file is arguing about.
  delete from public.coach_document_recipients r
   where exists (select 1 from public.coach_documents d
                  where d.id = r.document_id and d.coach_id = old.id);

  delete from public.coach_document_acceptances a
   where exists (select 1 from public.coach_documents d
                  where d.id = a.document_id and d.coach_id = old.id);

  return old;
end $$;

revoke execute on function public.profiles_release_coach_documents() from public, anon, authenticated;

comment on function public.profiles_release_coach_documents() is
  'The ONLY route by which an accepted coach document''s acceptances can be removed, and it '
  'exists so that a coach can erase their account at all. The RESTRICT foreign keys in parts '
  '135 and 156 refuse every other caller and are deliberately unchanged. See supabase/parts/1151.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The hook
-- ═════════════════════════════════════════════════════════════════════════
--
-- The third BEFORE DELETE trigger on `profiles`, beside part 184's
-- `trg_profiles_retain_financial_record` and part 1120's
-- `trg_profiles_queue_file_purge`. All three are independent of each other's
-- ordering: this one touches only the two coach-document child tables, 184
-- touches only memberships and the money tables, and 1120 only reads
-- `storage.objects` and writes its own queue.
--
-- Dropped by name first so re-running this file cannot leave two.

drop trigger if exists trg_profiles_release_coach_documents on public.profiles;
create trigger trg_profiles_release_coach_documents
  before delete on public.profiles
  for each row execute function public.profiles_release_coach_documents();


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Prove the path is open
-- ═════════════════════════════════════════════════════════════════════════
--
-- The assertion is not "the trigger exists" — a trigger that exists and does
-- the wrong thing looks identical from the catalogue. It is that the two
-- constraints this part is routing around are still RESTRICT, because if a
-- later hand ever loosens them to CASCADE then this trigger is no longer the
-- only route and the guarantee in its comment is false.
--
-- This is the assertion part 135 would have written if it had known to.

do $$
declare
  v_bad text[];
begin
  select coalesce(array_agg(c.conname order by c.conname), '{}'::text[])
    into v_bad
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'public.coach_documents'::regclass
     and c.confdeltype <> 'r';   -- 'r' = RESTRICT

  if array_length(v_bad, 1) is not null then
    raise exception
      'Foreign keys onto coach_documents are no longer RESTRICT: %. RESTRICT is what makes an accepted document undeletable (parts 135, 156); trg_profiles_release_coach_documents is meant to be the ONLY way past it. Loosening these makes that claim untrue. See supabase/parts/1151.',
      v_bad;
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'trg_profiles_release_coach_documents'
       and not t.tgisinternal
  ) then
    raise exception 'trg_profiles_release_coach_documents is not on public.profiles — a coach whose document has been accepted cannot be erased. See supabase/parts/1151.';
  end if;
end $$;
