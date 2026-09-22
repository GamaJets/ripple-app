-- ── The note about a member was one line, and it overwrote itself ──────────
--
-- `gym_member_records.note` (part 197) is a single text column with no author,
-- no date and no history, and the form on /members wrote it in place. So:
--
--     March   the desk types "complained about the 6am — moved to the 7"
--     June    somebody types "renewing in June" into the same box
--
-- and the March line is gone. No undo, no trace that it changed, nothing that
-- says a note ever existed. That is the record an owner opens when a member
-- disputes something, and it is the one thing on the member's file that keeps
-- the least.
--
-- Every gym keeps this as a running list, because a note IS a sequence of
-- things that were true on a date. A note with no date is not evidence and a
-- note with no author cannot be asked about.
--
-- ── Append-only, and enforced here rather than by a screen ────────────────
--
-- There is no UPDATE and no DELETE grant on this table for anybody. Not for the
-- trainer, not for the owner who wrote the row.
--
-- The reason is the same one part 187 gives for `gym_export_runs`: a record the
-- audited party can edit is worth less than no record at all, because its
-- CONTENT is then only ever "what somebody was willing to leave there". A note
-- written in error is answered by another note saying so, which is what a
-- paper day-book does and what every member of staff already understands.
--
-- The cost is real and it is accepted: a typo is permanent, and a note written
-- against the wrong member cannot be taken back — only contradicted. That is
-- worse for tidiness and better for the dispute this table exists for. Erasure
-- is not affected: `member_id` cascades, so deleting the person deletes every
-- note about them, exactly as part 197 argues for the record itself.
--
-- ── The old line is not migrated ──────────────────────────────────────────
--
-- `gym_member_records.note` is left alone: not copied, not cleared. Copying it
-- would invent an author and a date for a line that has neither, and clearing
-- it would destroy the only note most gyms have while this part is being
-- applied. The console shows it at the bottom of the list, labelled "written
-- before notes were kept". The column stays; nothing writes it any more.
--
-- Additive and idempotent.

create table if not exists public.gym_member_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- on delete cascade, for the reason part 197 gives about the member record
  -- itself: this is personal data the gym holds ABOUT a person, and an erasure
  -- request should take it with them. Not `set null` — an orphan note about
  -- somebody nobody can name is a liability with no use.
  member_id uuid not null references public.profiles(id) on delete cascade,

  body text not null check (length(btrim(body)) between 1 and 2000),

  written_at timestamptz not null default now(),
  -- `set null`, unlike member_id: a member of staff leaving the gym must not
  -- delete the notes they wrote about members who are still there. The note
  -- then reads as written by an account that has gone, which is true and is a
  -- different sentence from "nobody wrote it".
  --
  -- The default is auth.uid() so a caller that omits it still cannot file a
  -- note under somebody else's name; the console sends it explicitly because a
  -- stated value needs no default to be right.
  written_by uuid default auth.uid() references public.profiles(id) on delete set null
);

-- The console's read is "this member's notes, newest first", and it is the only
-- read there is.
create index if not exists idx_gym_member_notes_member
  on public.gym_member_notes (tenant_id, member_id, written_at desc);

comment on table public.gym_member_notes is
  'The running list of what the desk wrote about a member: one row per note, each carrying its author and the moment it was written. Replaces the single overwriting line in gym_member_records.note, which is left in place and shown as an unattributed entry. Append-only — no UPDATE and no DELETE for anybody, because a note its author can quietly rewrite is worth nothing in the dispute it exists for.';

alter table public.gym_member_notes enable row level security;

-- The owner of THIS gym writes and reads. `is_owner_of` is SECURITY DEFINER, so
-- a policy calling it does not re-enter profiles (28-fix-profiles-recursion).
drop policy if exists gmn_owner on public.gym_member_notes;
create policy gmn_owner on public.gym_member_notes
  for all using (public.is_owner_of(tenant_id))
  with check (public.is_owner_of(tenant_id));

-- Staff read, exactly as they read the member record these notes came out of
-- (part 197 argues that at length: the trainer alone at the desk on a Sunday is
-- the person who needs it). Writing stays with the owner, because a note about
-- a member is something the gym is accountable for having written.
drop policy if exists gmn_staff_r on public.gym_member_notes;
create policy gmn_staff_r on public.gym_member_notes
  for select using (tenant_id = public.my_tenant() and public.my_role() in ('trainer', 'owner'));

-- Deliberately NO gmn_self_r. The member reads their own gym_member_record
-- under part 197 and is entitled to; the desk's running notes about them are a
-- different thing, and a subject-access request for them is a request a person
-- makes and an owner answers with the export path, not a live feed the subject
-- watches while it is being written. That is a decision, not an oversight, and
-- reversing it is one policy.

-- Append-only, stated as grants rather than left to a policy. `for all` above
-- would otherwise permit an owner to UPDATE their own rows.
revoke all on public.gym_member_notes from anon, authenticated, public;
grant select, insert on public.gym_member_notes to authenticated;
grant all on public.gym_member_notes to service_role;
