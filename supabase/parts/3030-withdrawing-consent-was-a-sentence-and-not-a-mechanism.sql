-- ═══════════════════════════════════════════════════════════════════════════
-- The product promised a member could withdraw consent. Nothing anywhere let
-- them, and nothing anywhere recorded it if they had.
-- APPLIED to the live database on 13 Sep 2026 as part_3030_agreement_revocations.
--
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `SIGNING_RULE` in src/lib/gymSigning.ts is the one sentence a member reads
-- before they agree to anything their gym asks for. It ends:
--
--     "...it cannot be edited or taken back afterwards — withdrawing consent
--      later is a new record, not the quiet disappearance of this one."
--
-- Part 185 says the same thing in its own comment, above the two policies that
-- deny the member UPDATE and DELETE on `gym_agreement_signatures`:
--
--     "Withdrawing consent is a real right and it is a NEW record of the
--      withdrawal, not the quiet disappearance of the record that consent was
--      ever given."
--
-- Both sentences are correct about the half they were written to defend. The
-- signature is immutable, and it should be. What neither of them mentions is
-- that THE NEW RECORD DOES NOT EXIST. There is no table it could be written
-- to, no policy that would admit it, no function that writes one, and no
-- control on any screen — member-side or console-side — that offers it. A
-- grep of this repository for revoke, revocation, withdraw or rescind finds
-- join codes, invitations, staff roles, account-deletion requests and a member
-- deleting a progress photograph. It finds nothing at all about consent.
--
-- So the sentence describes a mechanism to somebody in the act of relying on
-- it. A member reads "withdrawing consent later is a new record" and agrees on
-- that basis; what the product actually offers them, for ever, is the row they
-- just wrote.
--
-- ── Why photo consent is the one that matters ──────────────────────────────
--
-- `AGREEMENT_NOTE` in src/lib/gymDocs.ts already says of `photo_consent`:
-- "Whether this person may be photographed or filmed in the building. Usually
-- not required to join." It is the one kind on the list that is a PREFERENCE
-- rather than a condition of entry, and the one a person most plausibly
-- changes their mind about. A progress photograph is somebody's body, and "I
-- agreed to this in March 2024" is not consent in perpetuity. A gym that goes
-- on putting a member in its Instagram posts eighteen months after they asked
-- it to stop is not defended by the signature it holds; it is embarrassed by
-- it.
--
-- ── A revocation is a NEW ROW. Never an update, never a delete. ───────────
--
-- This is the shape of the table and it is stated first because getting it
-- wrong is the failure that destroys a record rather than merely missing one.
--
-- Nothing in this part touches `gym_agreement_signatures`. No column is added
-- to it, no row is updated, no row is deleted, no policy on it is widened. The
-- signature stays exactly as it was written, because somebody DID agree, on
-- that date, in those words, and a gym asked afterwards what it was operating
-- on last week has to be able to say. Erasing it would not be respecting the
-- withdrawal — it would be falsifying the record of the period before it.
--
-- Both facts stand and the schema holds both: they agreed then, and they
-- withdrew later. Reading them together is what `inForce` in
-- src/lib/gymSigning.ts does, and neither row is diminished by the other.
--
-- This is the rule part 700 applies to a mistyped cost and part 2820 to a
-- chase that never happened: a correction is a second recorded fact, never an
-- erasure. Here it is not a correction at all — nothing about the signature
-- was wrong — which makes the argument for keeping it stronger, not weaker.
--
-- ── Scoped to a KIND, and why not to an agreement row ─────────────────────
--
-- `member_id` + `kind`, not `agreement_id`.
--
-- A member who withdraws photo consent has NOT withdrawn their liability
-- waiver, and a schema that could not express that would be used wrongly on
-- its first day: the only revocation anybody could write would be total, so
-- either it would be offered for everything — which for a waiver is the
-- uninsured-training failure below — or it would not be offered at all, which
-- is where we started.
--
-- The reason it is not scoped to the agreement ROW is subtler and it is the
-- one that would have bitten. Versions exist here: `nextVersion` in
-- src/lib/gymDocs.ts publishes v2 of a gym's photo consent and `forMember`
-- matches signatures on the agreement row, deliberately, so signing v1 does
-- not cover v2. If a revocation were scoped the same way, a gym publishing a
-- new version of its photo policy would silently clear every withdrawal ever
-- made against the old one — the member is shown an unsigned document and
-- nothing anywhere remembers that they said no. The withdrawal is about the
-- SUBJECT, not about the wording, so it is scoped to the subject.
--
-- Kind-scoped also survives the member signing again. A member may withdraw,
-- change their mind, and sign a fresh consent; that later signature is in
-- force because it is later, and the earlier revocation stays on the record as
-- the reason there is a gap in the middle. Which is why there is no unique
-- constraint on (member, kind): the pair is a history, read newest-first, and
-- not a flag.
--
-- ── Which kinds may be revoked, and why the other four may not ────────────
--
-- Getting this wrong in either direction is bad, and the two directions fail
-- differently. A photo consent that cannot be withdrawn is the defect this
-- part exists for. A waiver that CAN be withdrawn would let somebody go on
-- training in a building whose insurer believes it holds a current one, which
-- is worse than the thing being fixed. So the list is a CHECK constraint and
-- not a convention.
--
--   photo_consent      REVOCABLE. A preference, not a condition of entry —
--                      the gym's own note on the kind already says so. This is
--                      the whole reason for the part.
--
--   guardian_consent   REVOCABLE, but never from the member's own account.
--                      The adult who gave it may take it back; the minor it is
--                      about may not, for exactly the reason `GUARDIAN_REFUSAL`
--                      refuses the SIGNING from that account. A fifteen-year-
--                      old revoking their own guardian consent is not a weaker
--                      record, it is the wrong person's — and it would read as
--                      the right one. The CHECK admits the kind; the member
--                      insert policy in §3 does not, so it can only be
--                      recorded at the desk by the gym.
--
--   waiver             NOT REVOCABLE. A condition of entry, not a preference.
--                      Withdrawing it while the membership continues means
--                      somebody is training in the building with no current
--                      waiver and nothing stopping them at the door. The way
--                      out of a waiver is to stop training there, which is a
--                      membership decision and not a consent toggle.
--
--   terms, contract    NOT REVOCABLE, and for a reason that is not about
--                      safety. Withdrawing agreement to the terms of a live
--                      membership is not a preference being changed — it is
--                      the membership being ended, which has notice periods,
--                      a final invoice and a direct debit attached to it. A
--                      button here that looked like it did that, and did not,
--                      would be the worst control in the product: the member
--                      believes they have cancelled and the standing order
--                      goes on being collected. Cancelling lives in billing.
--
--   par_q              NOT REVOCABLE, and this one is a category error rather
--                      than a risk. A health questionnaire is a declaration of
--                      fact at a moment — what was true of somebody's heart in
--                      March — and not a standing permission. There is nothing
--                      to withdraw: an answer cannot be un-given, only
--                      superseded by a newer questionnaire, which is a fresh
--                      signature against a fresh version and already works. A
--                      revocation here would leave a gym that had screened
--                      somebody holding a record saying it had un-screened
--                      them, which is a worse position than either.
--
-- src/lib/gymSigning.ts holds the same two lists — `REVOCABLE_KINDS` and
-- `MEMBER_REVOCABLE_KINDS` — under the same names, and a kind added to one and
-- not the other produces either a button that 23514s or a right nobody is
-- offered. Same drift part 2820 named around `via`, same answer: say so here.
--
-- ── WHAT THIS DOES NOT DO TO DATA ALREADY COLLECTED ──────────────────────
--
-- Stated at length because a control that implied otherwise would be worse
-- than no control at all, and because this is the question a member actually
-- has when they tap it.
--
-- A row in this table is a statement about PERMISSION GOING FORWARD, and that
-- is the whole of what it claims. From the moment it exists the gym no longer
-- holds a current consent of that kind for that person, and everything the gym
-- decides from here — whether to photograph them in a class, whether to use a
-- picture in an advert, whether to put them on the wall — has to be decided
-- against a consent that is not in force.
--
-- It does NOT delete anything, and nothing in this part is capable of
-- deleting anything:
--
--   · Photographs already taken stay where they are. This part issues no
--     DELETE against any table and touches no storage bucket. `gym-docs`,
--     `coach-docs`, `progress-photos` and the rest are not mentioned.
--   · Copies that have already left are beyond any schema's reach. A printed
--     poster, a photograph in a magazine, a post somebody has already shared:
--     nothing written in this database can retrieve those, and a product that
--     implied it could would be lying to the person who most needed the truth.
--   · The signature itself stays, as above. So does every record made while
--     the consent WAS in force, which is the point of keeping it.
--
-- Erasing specific files is a different act with a different mechanism —
-- `deleteDocument` in src/lib/gymDocs.ts removes the object and the row
-- together, precisely because an earlier version removed the row and left the
-- file — and it is a request a member makes of their gym, person to person. It
-- is not this table, and this table does not trigger it. The member-facing
-- copy in src/lib/gymSigning.ts says all of that in the member's own language
-- before they tap anything.
--
-- ── Applying this ─────────────────────────────────────────────────────────
--
-- Additive. One new table, two indexes, its policies, its grants. Nothing
-- existing is altered, no trigger is added or widened anywhere, and there is
-- no backfill — a member who asked their gym to stop photographing them last
-- year said it in an email, and a row invented here would be Repple asserting
-- a date nobody stated.
--
-- The reading library tolerates this part NOT having been applied: 42P01 from
-- `fetchMyRevocations` is read as "the feature is not deployed", which is a
-- true statement about a database where no consent CAN have been withdrawn,
-- and is kept strictly distinct from a read that failed on the wire. See
-- `RevocationRead` in src/lib/gymSigning.ts.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the withdrawal ───────────────────────────────────────────────────────

create table if not exists public.gym_agreement_revocations (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,

  -- `on delete set null`, exactly as `gym_agreement_signatures.member_id` is in
  -- part 185, and for the same reason turned around: a gym asked what it was
  -- operating on must be able to show BOTH the consent and its withdrawal, and
  -- a withdrawal that vanished when the account was erased would leave the
  -- signature standing alone — the record would then say the gym held a
  -- current consent it had been told to stop relying on.
  member_id   uuid        references public.profiles(id) on delete set null,

  -- WHICH consent, and not which document. See the header: scoped to the kind
  -- so that publishing a new version of the gym's photo policy cannot silently
  -- clear a withdrawal, and so that withdrawing one thing is not withdrawing
  -- everything.
  --
  -- The CHECK is the revocability rule and the only place it is enforced. The
  -- four kinds absent from it — waiver, terms, contract, par_q — are absent
  -- deliberately and each for its own reason, set out in the header. Adding
  -- one here without reading that is how somebody ends up training in a
  -- building whose insurer believes it holds a current waiver.
  kind        text        not null
              check (kind in ('photo_consent', 'guardian_consent')),

  -- The moment the withdrawal was recorded. An instant and not a bare date,
  -- unlike `gym_invoice_chases.chased_on` in part 2820, and the difference is
  -- which question the column answers. A chase is an act somebody performed in
  -- the world on a day they state afterwards. A withdrawal takes effect WHEN
  -- IT IS WRITTEN — the ordering against `signed_at` is what decides whether
  -- the consent is in force, so both sides of that comparison have to be the
  -- same kind of thing, to the same precision. `signed_at` is a timestamptz,
  -- so this is.
  --
  -- Defaulted rather than accepted from the caller. There is no backdating: an
  -- app that could name the moment could name one before a signature and make
  -- a live consent read as withdrawn, or one in the future and make a
  -- withdrawal that has not happened yet.
  revoked_at  timestamptz not null default now(),

  -- The account whose session recorded it. Usually the member themselves;
  -- the owner where it was taken at the desk, which for guardian_consent is
  -- the only way it can be taken at all.
  recorded_by uuid        references public.profiles(id) on delete set null,

  -- Why, in their own words, where they chose to give one. Never required: a
  -- member withdrawing consent to be photographed owes nobody an explanation,
  -- and a box that must be filled to proceed is a toll on a right.
  reason      text        check (reason is null or (btrim(reason) <> '' and length(reason) <= 1000))
);

comment on table public.gym_agreement_revocations is
  'A member withdrawing one KIND of consent, as a new row. Nothing here updates or deletes a signature: the row in gym_agreement_signatures stays exactly as written, because somebody did agree on that date and erasing it would falsify the record of the period before the withdrawal. Both facts stand together. A row states that permission is withdrawn GOING FORWARD and claims nothing whatever about data already collected — it deletes no photograph, empties no bucket, and cannot reach a copy that has already left the building. Kind-scoped rather than agreement-scoped so that publishing a new version of a document cannot silently clear a withdrawal. See supabase/parts/3030.';

comment on column public.gym_agreement_revocations.member_id is
  'Whose consent was withdrawn. NULL means that account has since been erased — the withdrawal itself stands, and stands deliberately: a withdrawal that disappeared with the account would leave the signature alone on the record, saying the gym still held a consent it had been told to stop relying on. NULL does NOT mean the withdrawal was anonymous or that nobody made it.';

comment on column public.gym_agreement_revocations.kind is
  'Which consent: photo_consent | guardian_consent. These two and no others. waiver, terms and contract are conditions of a live membership rather than preferences — withdrawing a waiver would mean training in a building with no current one, and withdrawing terms is ending the membership, which belongs in billing with the notice period and the final invoice. par_q is a declaration of fact at a moment, not a standing permission: it is superseded by a newer questionnaire, never un-given. Mirrored by REVOCABLE_KINDS in src/lib/gymSigning.ts.';

comment on column public.gym_agreement_revocations.revoked_at is
  'When the withdrawal was recorded, and therefore when it took effect. Never NULL and never supplied by a caller — it defaults to now(), so nothing can backdate a withdrawal to before a signature or postdate one that has not happened. Compared against gym_agreement_signatures.signed_at to decide whether a consent is currently in force, which is why it is a timestamptz to the same precision and not a bare date.';

comment on column public.gym_agreement_revocations.recorded_by is
  'The account whose session wrote the row: the member themselves in the ordinary case, the gym owner where it was taken at the desk. NULL means that account has since been deleted — a receptionist who has left, an owner who has gone. It does NOT mean nobody recorded it, and the withdrawal is not weakened by it.';

comment on column public.gym_agreement_revocations.reason is
  'Why, in the member''s own words, where they chose to give one. NULL means no reason was given, which is the ordinary and expected case — a member withdrawing consent to be photographed owes nobody an explanation. NULL is NOT an unrecorded reason, a pending one, or grounds for a gym to treat the withdrawal as provisional.';

-- The read the member's own screen makes: "has this person withdrawn anything,
-- and when". Newest first, because only the newest matters against a signature
-- — a member may withdraw, sign again and withdraw again, and the history is
-- the point of keeping all three.
create index if not exists gym_agreement_revocations_member_idx
  on public.gym_agreement_revocations (member_id, kind, revoked_at desc, id desc);

-- And the console's sweep: "who at this gym has withdrawn what". `id` gives
-- the ordering a total order, without which a page boundary landing inside a
-- tied `revoked_at` drops and repeats rows — here that is a withdrawal missing
-- from the list a gym checks before it publishes a photograph.
create index if not exists gym_agreement_revocations_tenant_idx
  on public.gym_agreement_revocations (tenant_id, revoked_at desc, id desc);

-- ── 2. nothing about the signature changes ──────────────────────────────────
--
-- Said as a comment rather than as code, because the correct implementation of
-- "the signature is untouched" is the absence of every statement that would
-- touch it. There is deliberately no ALTER on gym_agreement_signatures in this
-- file, no `revoked_at` column added to it, no trigger that marks it, and no
-- widening of the two policies part 185 withheld from the member. If a later
-- part wants to show a withdrawal beside a signature it joins these two tables
-- on (member_id, kind) — it does not write to the left-hand one.

-- ── 3. who may read and write it ────────────────────────────────────────────

alter table public.gym_agreement_revocations enable row level security;

-- The owner sees every withdrawal in their own gym, and must: it is the list
-- they check before a photograph goes anywhere, and the list that answers for
-- them if somebody asks why one did.
drop policy if exists gym_agreement_revocations_owner_read on public.gym_agreement_revocations;
create policy gym_agreement_revocations_owner_read on public.gym_agreement_revocations
  for select
  to authenticated
  using (is_owner_of(tenant_id));

-- And may record one at the desk — a member who telephones, a member with no
-- phone, and the guardian case, which can be recorded NOWHERE ELSE.
drop policy if exists gym_agreement_revocations_owner_insert on public.gym_agreement_revocations;
create policy gym_agreement_revocations_owner_insert on public.gym_agreement_revocations
  for insert
  to authenticated
  with check (is_owner_of(tenant_id));

-- The member reads their own withdrawals. They have to: a screen that offered
-- a Withdraw button and could not then show that it had happened would leave
-- somebody tapping it twice and believing neither.
drop policy if exists gym_agreement_revocations_own_r on public.gym_agreement_revocations;
create policy gym_agreement_revocations_own_r on public.gym_agreement_revocations
  for select
  to authenticated
  using (member_id = (select auth.uid()));

-- And may write one for themselves, for the kinds that are theirs to withdraw.
--
-- Three conditions, and the third is the one that is easy to leave out:
--
--   member_id = auth.uid()   nobody withdraws anybody else's consent. Same
--                            shape as `gym_agreement_sig_own_i` in part 185,
--                            and the same reason: the row is about a person,
--                            so the session decides who that is.
--   tenant_id = my_tenant()  a withdrawal is addressed to the gym that holds
--                            the consent, and a member belongs to one.
--   kind = 'photo_consent'   NOT the CHECK constraint's list. The CHECK says
--                            what may be withdrawn at all; this says what may
--                            be withdrawn FROM THIS ACCOUNT. guardian_consent
--                            passes the CHECK and is refused here, because the
--                            account belongs to the person the consent is
--                            ABOUT and an adult's decision taken from the
--                            minor's phone is the wrong signature — exactly
--                            what `GUARDIAN_REFUSAL` refuses on the way in.
--                            MEMBER_REVOCABLE_KINDS in src/lib/gymSigning.ts
--                            is this list, and the screen shows a control only
--                            for what is in it.
drop policy if exists gym_agreement_revocations_own_i on public.gym_agreement_revocations;
create policy gym_agreement_revocations_own_i on public.gym_agreement_revocations
  for insert
  to authenticated
  with check (
    member_id = (select auth.uid())
    and tenant_id = my_tenant()
    and kind = 'photo_consent'
  );

-- No UPDATE and no DELETE, for anybody, including the owner — and both are
-- named and dropped rather than merely never written, so that a policy added
-- by somebody who wanted an "undo" button does not survive a rebuild of this
-- file.
--
-- This is part 185's rule applied to the other side of the same record, and it
-- has to be, or the fix is hollow: a withdrawal that the gym holding the
-- consent can delete is not a withdrawal, it is a suggestion. Changing one's
-- mind back is a fresh signature against a current version of the document —
-- which already works, is already dated, and already says who gave it — and
-- the revocation stays underneath it as the reason there is a gap.
drop policy if exists gym_agreement_revocations_owner_update on public.gym_agreement_revocations;
drop policy if exists gym_agreement_revocations_owner_delete on public.gym_agreement_revocations;
drop policy if exists gym_agreement_revocations_own_u on public.gym_agreement_revocations;
drop policy if exists gym_agreement_revocations_own_d on public.gym_agreement_revocations;
-- Staff are not admitted in any direction. `gym_agreement_signatures` admits
-- no trainer policy either, and why a member stopped agreeing to be
-- photographed is not something the schema publishes to the floor.
drop policy if exists gym_agreement_revocations_staff_read on public.gym_agreement_revocations;

-- RLS narrows a GRANT; it does not create one. UPDATE and DELETE are revoked
-- as well as unpolicied, so that a policy added later cannot become live
-- without somebody also granting the privilege back and noticing why it is
-- missing.
revoke all on public.gym_agreement_revocations from anon, authenticated, public;
grant select, insert on public.gym_agreement_revocations to authenticated;
revoke update, delete on public.gym_agreement_revocations from authenticated;
grant all on public.gym_agreement_revocations to service_role;

-- ── 4. what this part deliberately does NOT do ──────────────────────────────
--
--   · It deletes nothing and can delete nothing. No DELETE statement, no
--     storage bucket, no trigger that reaches one. See the header: a
--     revocation is about permission going forward, and the schema makes no
--     claim about photographs already taken or copies that have already left.
--   · It adds no column to `gym_agreement_signatures` and no trigger to it.
--     The signature is untouched by construction, not by care.
--   · It writes no notification. A member withdrawing photo consent is not a
--     message this product sends on their behalf to their gym's owner — the
--     owner reads the list — and part 2100 is the record of what an
--     enthusiastic automatic nudge cost the last time.
--   · It does not require that a signature exists first. The app gates its
--     control on one, but a member telling their gym "I never agreed to that
--     and I do not agree now" is a real statement, and a row with no signature
--     behind it is not a corrupt row. A trigger that refused it would turn
--     that sentence into an error message.
--   · It adds no unique constraint on (member_id, kind). The pair is a
--     history, not a flag: withdraw, sign again, withdraw again is a sequence
--     a person is entitled to, and each step is its own dated fact.
