-- ═══════════════════════════════════════════════════════════════════════════
-- Every signature this product holds is a member of staff typing the member's
-- name into a box.
--
-- studio-web/app/compliance/page.tsx has one control that writes to
-- `gym_agreement_signatures`, and it is a <select> of the roster beside a text
-- input labelled "The name they signed with", filled in by whoever is at the
-- desk. There is no member-side path anywhere in the repository: nothing the
-- member opens, nothing the member taps, no row any member's own session has
-- ever written. Part 185 built the table for both — `witnessed_by` is
-- documented there as "NULL for a signature taken in the app by the member
-- themselves" — and the app half was never dispatched.
--
-- So the document a gym would produce after an injury reads "Sara Ahmed signed
-- our liability waiver on 4 March", and what actually happened is that a
-- part-time receptionist typed those eleven characters. The row cannot say
-- which, because nothing on it distinguishes the two.
--
-- ── Why this is a labelling defect and not a worthless record ─────────────
--
-- A signature taken at a desk is not nothing. A gym that sat somebody down with
-- the waiver on a clipboard and keyed the result in has done most of what the
-- law asks; what it has is a STAFF ATTESTATION that the member agreed, which is
-- a real and ordinary business record. What it is not is the member's own act,
-- and the two carry very different weight in front of anybody who asks.
--
-- The defect is that the schema cannot tell them apart, so the screen calls
-- both "signed" and the gym believes it holds the stronger one. The fix is
-- therefore two columns and a trigger, not a rewrite:
--
--   signed_by     the account whose session actually wrote the row. Set HERE,
--                 from auth.uid(), never from anything a caller sends.
--   attribution   'member' when those are the same person, 'staff' when they
--                 are not, and 'unknown' for every row written before this
--                 part existed.
--
-- ── Why 'unknown' exists, and why the backfill does not guess ─────────────
--
-- The tempting backfill is `attribution = 'staff'` for everything, on the
-- reasoning that no member-side path existed so no member can have signed. That
-- reasoning is about the APP, and the table is reachable by anything holding a
-- session: part 185 has shipped `gym_agreement_sig_own_i` since the day it
-- landed, so a member-attributed row is possible in principle and this part
-- cannot tell whether one exists.
--
-- So the backfill claims only what the row already says. `witnessed_by` names a
-- member of staff who took it, and only the console ever set it, so those rows
-- are 'staff' on the evidence of their own contents. Everything else is
-- 'unknown' — written before anybody was recording this, and this part will not
-- invent an answer to make a screen tidier. `signed_by` stays NULL on every
-- backfilled row for the same reason: nothing recorded it at the time.
--
-- Nothing is relabelled UPWARDS. No existing row becomes 'member'.
--
-- ── Why a trigger and not a column the client fills in ────────────────────
--
-- Because the whole point is that the client cannot be believed about this. An
-- `attribution` the console sets is the same defect one level up: the desk
-- would send 'member' and the row would say the member signed. The value is
-- derived in the database from auth.uid(), which is the one fact a session
-- cannot lie about, and the RLS policy below refuses the owner's insert
-- outright when the member_id is their own — so staff cannot write a
-- member-attributed signature by any route, trigger or no trigger.
--
-- ── Why version_signed is validated rather than trusted ───────────────────
--
-- It is denormalised on purpose (part 185: "a signature has to be legible from
-- its own row") and it arrived from the caller unchecked, so a stale screen
-- could pin a signature to a version number the agreement never had. Each
-- version is its OWN agreement row, so the correct value is never in doubt —
-- it is read off the agreement being signed and a mismatch is refused rather
-- than silently corrected, because a mismatch means the screen was showing
-- something that is no longer true and the person should be asked again.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. what the row now records about who wrote it ──────────────────────────

alter table public.gym_agreement_signatures
  add column if not exists signed_by uuid references public.profiles(id) on delete set null;

-- Default 'unknown' rather than 'staff', so that a row arriving by any route the
-- trigger below does not cover reads as unrecorded instead of as an assertion
-- nobody made. The trigger overwrites it on every insert, so the default is
-- never what a live row ends up holding — it is the safe answer if this part is
-- ever half-applied.
alter table public.gym_agreement_signatures
  add column if not exists attribution text not null default 'unknown';

comment on column public.gym_agreement_signatures.signed_by is
  'The account whose session wrote this row, from auth.uid(). NULL on rows written before supabase/parts/520, where nothing recorded it.';

comment on column public.gym_agreement_signatures.attribution is
  'member = the member''s own authenticated session wrote this. staff = somebody at the desk recorded it on their behalf. unknown = written before this was recorded and no honest answer exists. It is derived in the database, never sent by a caller.';

-- ── 2. the backfill, which claims only what the rows already say ────────────

update public.gym_agreement_signatures
   set attribution = 'staff'
 where attribution = 'unknown'
   and witnessed_by is not null;

-- ── 3. what a row is allowed to say ─────────────────────────────────────────
--
-- 'member' is the claim with consequences, so it is the one the constraint is
-- about: it may only stand where the member's own account wrote the row, and a
-- signature the member gave themselves has no witness by definition — a
-- witnessed_by beside 'member' would be a member of staff attesting to
-- something they were not present for.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'gym_signature_attribution_is_earned'
       and conrelid = 'public.gym_agreement_signatures'::regclass
  ) then
    alter table public.gym_agreement_signatures
      add constraint gym_signature_attribution_is_earned check (
        attribution in ('member', 'staff', 'unknown')
        and (attribution <> 'member'
             or (signed_by is not null and signed_by = member_id and witnessed_by is null))
      );
  end if;
end $$;

-- ── 4. who wrote it, decided by the database ────────────────────────────────

/**
 * Stamp the writer onto the row, and say plainly which of the two things it is.
 *
 * `signed_by` is assigned rather than validated: whatever a caller sends is
 * discarded, because a column that can be sent is a column that can be forged
 * and this one exists precisely to be unforgeable. auth.uid() is NULL for
 * service_role, and a signature written by a back-end job is not somebody
 * signing, so that case is refused rather than recorded as staff — there is no
 * member of staff to name.
 *
 * `attribution` follows from it and is never taken from the caller either. The
 * console does not send either column and does not need to know they exist.
 */
create or replace function public.gym_signature_attribution()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  a record;
begin
  if actor is null then
    raise exception
      'A signature has to be written by somebody signed in: this row has no session behind it, so there is nobody it could be attributed to.'
      using errcode = 'P0001';
  end if;

  select id, tenant_id, version into a
    from public.gym_agreements
   where id = new.agreement_id;
  if a.id is null then
    raise exception 'That agreement does not exist, so there is nothing this signature could be against.'
      using errcode = 'P0001';
  end if;
  if a.tenant_id is distinct from new.tenant_id then
    raise exception 'That agreement belongs to a different gym.' using errcode = 'P0001';
  end if;

  -- The version is not negotiable. Each version is its own agreement row, so
  -- the right answer is on the row being signed; a caller disagreeing means the
  -- screen was showing a version that has since been superseded, and the person
  -- in front of it should be shown the current wording rather than have this
  -- one quietly corrected underneath them.
  if new.version_signed is distinct from a.version then
    raise exception
      'That signature is against version % and the agreement it names is version %. The wording on screen is out of date — reload it and ask again, because the version pinned to a signature is what makes it evidence of anything.',
      new.version_signed, a.version
      using errcode = 'P0001';
  end if;

  new.signed_by := actor;

  if new.member_id is not null and new.member_id = actor then
    if new.witnessed_by is not null then
      raise exception
        'This is the member signing for themselves, so there is no witness to name. A witness is who took the signature at the desk when somebody else did.'
        using errcode = 'P0001';
    end if;
    new.attribution := 'member';
  else
    new.attribution := 'staff';
    -- Somebody recorded this on another person's behalf, and the row has to
    -- name them. The console already passes it; this is what makes it true of
    -- every route, so that 'staff' always answers "which member of staff".
    if new.witnessed_by is null then new.witnessed_by := actor; end if;
  end if;

  return new;
end $$;

revoke all on function public.gym_signature_attribution() from public, anon, authenticated;

drop trigger if exists trg_gym_signature_attribution on public.gym_agreement_signatures;
create trigger trg_gym_signature_attribution
  before insert on public.gym_agreement_signatures
  for each row execute function public.gym_signature_attribution();

-- ── 5. and it stays what it was ─────────────────────────────────────────────

/**
 * Refuse to edit the evidence.
 *
 * Part 185 gave the owner `for all` on this table, which includes UPDATE — so
 * every guarantee above could be undone one second later by setting attribution
 * to 'member' on a row a receptionist typed. That is the exact failure this
 * part exists to prevent, arriving through the back door.
 *
 * `note` is left writable: it is the owner's own annotation of the record and
 * carries no claim about who signed. Everything that IS such a claim is frozen.
 */
create or replace function public.gym_signatures_freeze()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.attribution     is distinct from old.attribution
  or new.signed_by       is distinct from old.signed_by
  or new.member_id       is distinct from old.member_id
  or new.agreement_id    is distinct from old.agreement_id
  or new.signed_name     is distinct from old.signed_name
  or new.signed_at       is distinct from old.signed_at
  or new.version_signed  is distinct from old.version_signed
  or new.witnessed_by    is distinct from old.witnessed_by
  or new.guardian_name   is distinct from old.guardian_name
  or new.guardian_relationship is distinct from old.guardian_relationship
  then
    raise exception
      'A signature cannot be edited. It is the record of what one person agreed to at one moment, and a record that can be changed afterwards is not evidence of anything. Add a note, or take a new signature.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.gym_signatures_freeze() from public, anon, authenticated;

drop trigger if exists trg_gym_signatures_freeze on public.gym_agreement_signatures;
create trigger trg_gym_signatures_freeze
  before update on public.gym_agreement_signatures
  for each row execute function public.gym_signatures_freeze();

-- ── 6. access ───────────────────────────────────────────────────────────────
--
-- Part 185's `gym_agreement_sig_owner` was one `for all` policy, which let an
-- owner insert a row naming themselves as the member — a member-attributed
-- signature written by staff, which is the thing that must be impossible. It is
-- split into four so the INSERT can be narrowed on its own, and the other three
-- keep exactly the reach they had.
--
-- Policies for the same command are OR'd, so this can only be done by replacing
-- the wide one. An owner who is also a member of their own gym still signs
-- their own waiver — through the member policy below, from their own session,
-- which is the whole distinction.
drop policy if exists gym_agreement_sig_owner on public.gym_agreement_signatures;

drop policy if exists gym_agreement_sig_owner_r on public.gym_agreement_signatures;
create policy gym_agreement_sig_owner_r on public.gym_agreement_signatures
  for select using (is_owner_of(tenant_id));

drop policy if exists gym_agreement_sig_owner_i on public.gym_agreement_signatures;
create policy gym_agreement_sig_owner_i on public.gym_agreement_signatures
  for insert with check (
    is_owner_of(tenant_id)
    and member_id is distinct from (select auth.uid())
  );

drop policy if exists gym_agreement_sig_owner_u on public.gym_agreement_signatures;
create policy gym_agreement_sig_owner_u on public.gym_agreement_signatures
  for update using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_agreement_sig_owner_d on public.gym_agreement_signatures;
create policy gym_agreement_sig_owner_d on public.gym_agreement_signatures
  for delete using (is_owner_of(tenant_id));

-- The member signs their own, and only what the gym is actually asking for now.
--
-- Part 185's version checked the agreement's tenant and stopped there, so a
-- member could sign a RETIRED version — which produces a row that satisfies
-- nothing on the compliance screen, since `outstandingFor` matches on the live
-- one, and leaves somebody believing they have signed. `active` is the fix and
-- it belongs here rather than in the app: the app is what would be out of date.
drop policy if exists gym_agreement_sig_own_i on public.gym_agreement_signatures;
create policy gym_agreement_sig_own_i on public.gym_agreement_signatures
  for insert with check (
    member_id = (select auth.uid())
    and tenant_id = my_tenant()
    and exists (select 1 from public.gym_agreements a
                 where a.id = agreement_id
                   and a.tenant_id = gym_agreement_signatures.tenant_id
                   and a.active));

comment on table public.gym_agreement_signatures is
  'Evidence that one person agreed to one version of one document at one moment, and a column saying whether that person was the member or a member of staff recording it for them. Nothing cascades into this table and nothing about a row may be edited afterwards: it is precisely what a gym is required to be able to produce, and a record that can be changed later is not evidence of anything.';
