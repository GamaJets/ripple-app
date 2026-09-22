-- ═══════════════════════════════════════════════════════════════════════════
-- Two product calls, made and written down
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLIED. Verified after: gym_agreement_signatures carries only INSERT and
-- SELECT policies and `authenticated` holds only INSERT and SELECT on it;
-- exercises.created_by exists; the four authorless coach rows are
-- 1-arm-plated-row, dumbbell-over-head-press-single-arm,
-- machine-preacher-tricep-extension and standing-dumbbell-curls — all real
-- movements rather than typos, which is worth knowing before anyone corrects
-- them. Anon-executable SECURITY DEFINER functions still hold at 2.
--
--
-- Both were raised as findings earlier and deliberately left, because each
-- needed a decision rather than a repair. Tim asked for the decisions. They are
-- below, with the reasoning, so the next person can disagree with the argument
-- rather than guess at it.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 1 · Custom movements stay in the GLOBAL catalogue
-- ═════════════════════════════════════════════════════════════════════════
--
-- The question was whether a coach's own movement belongs in `exercises`,
-- which every gym reads, or in the tenant-scoped `coach_exercises`.
--
-- It belongs in `exercises`, and the reason is that the slug is not a name —
-- it is an IDENTITY, and four separate systems key on it:
--
--   · `exercise_translations` — 1,166 rows landed against these exact ids
--     tonight, 583 German and 583 Spanish. A movement outside the catalogue
--     has no translation and never will.
--   · `exercise_videos` and the demo/animation paths, which are keyed on
--     `exercises.id`.
--   · `muscle_volume`, which joins a logged movement to its muscle group
--     THROUGH the catalogue — the only reason the app can answer "how much
--     back work did I do".
--   · `matchExercises` in src/lib/exerciseHistory.ts, which resolves a logged
--     NAME to a catalogue row so history matches across a rename.
--
-- Moving custom movements to `coach_exercises` would give a coach's own
-- movements none of those, and would give the same physical movement a
-- different identity in every gym that invented it. `coach_exercises` is the
-- right place for a coach's own LIBRARY — which is what it holds — and the
-- wrong place for the identity of a movement.
--
-- ── what was actually wrong, and what this does about it ──────────────────
--
-- The real complaint stands: one coach's typo becomes a permanent globally
-- readable row keyed on their typing. Part 2380 gave that half its answer — a
-- platform admin can now UPDATE and DELETE, where before nobody could.
--
-- The half left over is that a wrong row cannot be TRACED. `source = 'coach'`
-- says a coach wrote it and nothing says which coach, so an admin looking at
-- `barbell-benchpres` has no one to ask what it was meant to be, and no way to
-- tell a typo from a real movement they have not heard of.
--
-- `created_by` closes that. Nullable, because the 604 curated rows have no
-- author and inventing one would be worse than the gap. ON DELETE SET NULL,
-- because a movement outlives the account that named it — and because the
-- alternative, CASCADE, would delete catalogue rows other gyms are using when
-- a coach closes their account.
--
-- Not enforced as NOT NULL for coach rows, deliberately: a constraint that can
-- only be satisfied by a client sending a column it has never sent would
-- refuse every custom movement the moment this applied, on every handset that
-- has not taken the update. The app sets it going forward; the four existing
-- coach rows keep a null and are named in the query at the foot of this file.

alter table public.exercises
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

comment on column public.exercises.created_by is
  'Who added this row, when a person did. NULL on the curated catalogue, which has no author, and NULL on the four coach rows that predate supabase/parts/2590. Set by src/ui/customExercise.ts on every coach-written row from that part onwards. It exists so a wrong row can be TRACED: `source = ''coach''` says a coach wrote it and nothing said which, so a platform admin correcting a typo had nobody to ask what it was meant to be. ON DELETE SET NULL because a movement outlives the account that named it, and because CASCADE would delete catalogue rows other gyms are using when a coach closes their account.';

-- The insert policy gains the one thing it can honestly check: a row claiming
-- an author must claim the caller. It cannot require an author, for the reason
-- in the header — an older bundle sends no column at all.
drop policy if exists exercises_staff_w on public.exercises;
create policy exercises_staff_w on public.exercises for insert
  to authenticated
  with check (
    my_role() in ('trainer', 'owner')
    and (created_by is null or created_by = (select auth.uid()))
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A gym owner may NOT rewrite or delete a member's signed waiver
-- ═════════════════════════════════════════════════════════════════════════
--
-- `gym_agreement_signatures` carried, live:
--
--     gym_agreement_sig_owner_u  UPDATE  using/with check is_owner_of(tenant_id)
--     gym_agreement_sig_owner_d  DELETE  using           is_owner_of(tenant_id)
--
-- A signature is the record that a member agreed to something — the gym's
-- liability waiver, its terms, its cancellation policy. The party it protects
-- the gym FROM is the member; the party it could be inconvenient for is the
-- gym. So the gym being able to rewrite or remove it is the interested party
-- withdrawing the evidence, and a signature that the counterparty can edit is
-- not a signature.
--
-- The shape this should have is already in this schema and was decided
-- deliberately: `coach_document_acceptances` has no UPDATE and no DELETE
-- policy at all, for exactly this reason.
--
-- Both are dropped. Checked before dropping, not after: nothing in app/,
-- src/, studio-web/ or supabase/functions/ updates or deletes a signature —
-- every reference is an insert or a read (gymDocs.ts, gymSigning.ts,
-- agreements.tsx, the export path). And the table holds 0 rows, so nothing
-- that exists is affected either way.
--
-- What is deliberately KEPT:
--
--   · `gym_agreement_sig_owner_i` — the owner may INSERT a signature for
--     somebody else (`member_id is distinct from auth.uid()`). That is the
--     front desk signing a member in on the gym's own tablet, which is how
--     most waivers actually get signed, and it is a different act from
--     altering one that exists.
--   · both SELECT policies. The gym must be able to read what was signed;
--     that is the whole point of keeping it.
--
-- An erasure still removes them: the FK to the member cascades, executed by
-- the database, which consults neither grant nor policy.

drop policy if exists gym_agreement_sig_owner_u on public.gym_agreement_signatures;
drop policy if exists gym_agreement_sig_owner_d on public.gym_agreement_signatures;

-- Revoked as well as unpoliced. A policy is the rule and the grant is the
-- door; leaving `authenticated` holding UPDATE and DELETE on this table would
-- mean the next `for all` policy anybody adds silently reopens it.
revoke update, delete on public.gym_agreement_signatures from authenticated;
revoke all on public.gym_agreement_signatures from anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · What to check after applying
-- ═════════════════════════════════════════════════════════════════════════
--
--   · the four authorless coach rows, which are the ones an admin may want to
--     ask about and now cannot:
--
--       select id, name, created_by from public.exercises
--        where source = 'coach' order by id;
--
--   · the signature table has no UPDATE or DELETE policy, and authenticated
--     holds neither verb:
--
--       select policyname, cmd from pg_policies
--        where tablename = 'gym_agreement_signatures';
--       select privilege_type from information_schema.role_table_grants
--        where table_name = 'gym_agreement_signatures' and grantee = 'authenticated';
--
--   · `select public.get_advisors('security')` is clean and the count of
--     anon-executable SECURITY DEFINER functions still holds at 2.
-- ═══════════════════════════════════════════════════════════════════════════
