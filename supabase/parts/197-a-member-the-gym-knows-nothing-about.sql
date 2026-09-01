-- ── The gym's own record of a person ────────────────────────────────────────
--
-- Grep this schema for a member's phone number, their next of kin, a note the
-- desk wrote about them, or the fact that they use an inhaler, and there is
-- nothing. `profiles` carries id, role, tenant, full_name and avatar.
-- `memberships` carries a plan, two dates, a status and a `note` that is
-- attached to the CONTRACT rather than the person — so it is lost the moment a
-- member upgrades and the old membership is closed.
--
-- Every gym in the world keeps this record. They keep it on paper at the desk,
-- or in the spreadsheet this console is meant to replace, and the reason they
-- keep it is not administrative:
--
--   · somebody collapses on the floor and the desk has four minutes to find a
--     phone number for a person nobody at work that evening knows;
--   · a member has a condition the floor needs to know about before they are
--     pushed through a benchmark session;
--   · the owner rings twenty lapsed pass holders and has no way to write down
--     which four said "call me in March" (roadmap E4 — that list is currently a
--     dead end with no contact, no logging and no note).
--
-- ── One row per person per gym, not per membership ─────────────────────────
--
-- The primary key is (tenant_id, member_id). A person who lets a membership
-- lapse and rejoins in June is one person the gym knows things about, and the
-- emergency contact taken in January is still the right number in June. Keying
-- this on `memberships` would throw it away at exactly the moment the record
-- becomes hardest to recollect.
--
-- It also means this row exists for people who are NOT members: the pass holder
-- with an account who never joined, who is the entire subject of /passes.
--
-- ── What this is not ───────────────────────────────────────────────────────
--
-- Not the client's own health record. `injuries` and `injury_documents` (parts
-- 90, 91, 96) are the CLIENT's, written by the client, and part 91's rule
-- stands untouched: a coach sees the extracted injury, never the file. Nothing
-- here reads, writes or widens any of that.
--
-- `medical_note` is the opposite direction: it is what the GYM wrote down at
-- the desk, from what the member told the desk, for the people standing on the
-- floor. It is operational, and it is why staff can read this table.
--
-- ── Who can read it, and the choice that was actually hard ─────────────────
--
-- Staff read; the owner writes.
--
-- The tempting shape is owner-only — this row holds a phone number and a health
-- note, /members is owner-only, and narrower is usually righter. It is wrong
-- here, and the reason is the first bullet above. The trainer alone at the desk
-- at nine on a Sunday is precisely the person who needs the next-of-kin number,
-- and a record only the owner can read is a record that is not there when it is
-- needed. PostgreSQL policies choose ROWS, not columns, so "staff may read the
-- emergency contact but not the note" is not expressible here without splitting
-- the row across two tables — which would put the emergency contact one join
-- away from the desk to protect a sentence the desk wrote down itself.
--
-- Writing stays with the owner. A note about a member is a thing the gym is
-- accountable for having written, and `updated_by` records who.

create table if not exists public.gym_member_records (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- on delete cascade, and deliberately so — unlike gym_payments.member_id,
  -- which is `set null` because the cash is the gym's statutory record. None of
  -- this is: it is personal data the gym holds ABOUT a person, and an erasure
  -- request should take every column below with it. (Roadmap G1 is the unresolved
  -- half of that same question for the money tables. This one is not in doubt.)
  member_id uuid not null references public.profiles(id) on delete cascade,

  -- What the gym can reach them on. `profiles` has neither, and auth.users.email
  -- is not readable from the client under any policy in this schema — so today
  -- an owner looking at a member has no way to contact them at all.
  phone text,
  email text,

  emergency_name text,
  emergency_phone text,

  -- Free text on purpose. A closed list of conditions would be a medical
  -- taxonomy written by a gym CRM, and every gym would immediately need the
  -- entry it does not have.
  medical_note text,

  -- The desk's own note about this person. Not the membership's note: this one
  -- survives a plan change, which is when it is most likely to be needed.
  note text,

  -- Short labels the gym sorts by — 'student', 'corporate', 'do not call'.
  -- An array rather than a join table because nothing here needs a tag to be an
  -- object with its own name, colour and history; the day one does, this becomes
  -- a foreign key and the array is the migration.
  tags text[] not null default '{}',

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,

  primary key (tenant_id, member_id)
);

-- The roster read is "every record in this gym", which the primary key's
-- leading column already serves. The other direction — one person across gyms —
-- is not a query this product makes.
create index if not exists idx_gym_member_records_member
  on public.gym_member_records(member_id);

-- ── row-level security ──────────────────────────────────────────────────────
-- Enabled before any policy, because a policy on a table without RLS is inert
-- and Supabase's default grants to anon and authenticated apply in full — the
-- exact hole 38-tenant-isolation.sql was written to close on four other tables.
alter table public.gym_member_records enable row level security;

-- The owner of THIS gym, not merely an owner. `is_owner_of` is SECURITY
-- DEFINER, so a policy calling it does not re-enter the table it protects
-- (28-fix-profiles-recursion.sql).
drop policy if exists gmr_owner on public.gym_member_records;
create policy gmr_owner on public.gym_member_records
  for all using (public.is_owner_of(tenant_id))
  with check (public.is_owner_of(tenant_id));

-- Staff read, for the reason argued above. Scoped through my_tenant() rather
-- than left unscoped, so a row whose tenant is somehow null is invisible to
-- this rather than visible to everyone: unscoped fails closed.
drop policy if exists gmr_staff_r on public.gym_member_records;
create policy gmr_staff_r on public.gym_member_records
  for select using (tenant_id = public.my_tenant() and public.my_role() in ('trainer', 'owner'));

-- The member reads their own. They are entitled to it under any subject-access
-- regime worth the name, and a gym-held record a member cannot see is the thing
-- a subject-access request is for. SELECT only — a member correcting their own
-- emergency contact is a good idea and a different feature, with a different
-- screen and a write path that does not also let them edit the desk's note
-- about them.
drop policy if exists gmr_self_r on public.gym_member_records;
create policy gmr_self_r on public.gym_member_records
  for select using (member_id = (select auth.uid()));

comment on table public.gym_member_records is
  'What the GYM knows about a person: contact, next of kin, an operational medical note and the desk''s own note. One row per person per gym, keyed on the person rather than on a membership so it survives a lapse and a rejoin. Staff read (the desk needs the next-of-kin number at nine on a Sunday); the owner writes. Not the client''s own health record — injuries / injury_documents are the client''s and are untouched by this.';
