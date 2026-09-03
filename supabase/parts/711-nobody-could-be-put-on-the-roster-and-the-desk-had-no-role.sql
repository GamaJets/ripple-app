-- ═══════════════════════════════════════════════════════════════════════════
-- Nobody could be put on the roster, and the person on the desk had no role.
--
-- Two halves of one gap, and the schema states the first half itself. Part 38
-- installs `guard_profile_identity`, which refuses a profile changing its own
-- role, with this message:
--
--     'A profile cannot change its own role. Ask the gym owner to change it
--      for you.'
--
-- There is no function by which the gym owner can. `profiles_owner_tenant_r`
-- lets an owner READ every profile in their tenant and there is no owner UPDATE
-- policy at all, `trainers` has no owner INSERT — studio-web/app/staff/page.tsx
-- says so out loud, in the section about coaches who are owed money and have no
-- roster row: "a roster row is created when the coach accepts the gym's join
-- code, not from here: the owner cannot insert one, and a button that the
-- database would refuse is worse than this sentence."
--
-- So the only way onto a gym's staff is for the person to accept a join code,
-- and there is NO way off. Not a soft one, not a hard one. A coach who leaves
-- keeps their role, their tenant and — this is the part that matters — every
-- client on their book, and `is_my_client()` reads `clients.trainer_id` with no
-- tenant test anywhere in it. Their access to those members' workouts,
-- measurements, check-ins, scans, food logs and private conversation with their
-- coach survives their employment by exactly as long as nobody notices.
--
-- ── And the desk is not a coach ──────────────────────────────────────────
--
-- `profiles.role` has held three values since part 01: owner, trainer, client.
-- Everything a gym's front desk does — taking somebody through the door,
-- looking up a next-of-kin number, selling a day pass — is policed by
-- `my_role() in ('trainer','owner')`. The gym's receptionist is therefore
-- either given 'trainer', which hands them the coaching side of the product and
-- a roster row and a place in payroll, or given nothing and the door is worked
-- from somebody else's login. Both of those happen and neither is a decision
-- anybody made.
--
-- `gym_shifts` has had a 'desk' role since the rota was built. The rota could
-- say somebody was on the desk; the permission model had never heard of it.
--
-- ── WHAT THIS PART DECIDES ───────────────────────────────────────────────
--
-- 1. `receptionist` becomes a fourth value of `profiles.role`.
--
--    It is worth being precise about what that does on its own: NOTHING. Every
--    policy in this schema that admits staff spells the roles out —
--    `my_role() in ('trainer','owner')` — so a new value reaches no table by
--    default and a receptionist created today can read the gym's own row (that
--    is `tenants_read`, which is role-agnostic) and their own profile and
--    nothing else at all. That is the right default and it is why the role can
--    be added before every screen that should honour it exists.
--
--    Two policies are widened here, and only two. They are listed below with
--    the reason each one is the desk's job, and the far longer list of what is
--    deliberately NOT widened is beside them.
--
-- 2. A grant is a WRITTEN ACT. `grant_staff_role` is the only way onto a gym's
--    staff from the console, it may only be called by that gym's owner, and it
--    writes a row in `staff_grants` in the same transaction as the change it
--    records. That is not bookkeeping for its own sake. Putting somebody on a
--    gym's staff hands them the next-of-kin details and the operational medical
--    note of every member of that gym — `gym_member_records`, part 197, whose
--    own comment describes it as what the desk needs "at nine on a Sunday". A
--    grant of that has to have a name and a date against it, and it has to
--    still have one after the person who made it has left.
--
-- 3. A revocation that would only half-remove somebody REFUSES.
--
--    This is the decision in this file most likely to be argued with, so the
--    reasoning is written out. `revoke_staff_role` clears `profiles.tenant_id`,
--    which is what makes every `tenant_id = my_tenant()` policy stop matching —
--    and `is_my_client()` is not one of those policies. It is
--
--        exists (select 1 from clients where id = c and trainer_id = auth.uid())
--
--    with no tenant in it, so a coach who still has clients pointed at them
--    keeps a complete read of those people's health history AFTER being removed
--    from the gym. A revocation that leaves that in place is worse than no
--    revocation, because the owner has been told the person is gone.
--
--    Unpicking the book here instead was the other option and it is refused:
--    `end_coaching` (part 68) is how a coaching relationship ends, it writes
--    both halves atomically and it is the client's decision as much as the
--    gym's. Silently ending eleven people's coaching as a side effect of a
--    staff change would be this function inventing eleven decisions. So it
--    raises, it says how many clients and it names `end_coaching` — the owner
--    reassigns or ends them, and comes back.
--
-- ── WHAT THIS PART DOES NOT DO ───────────────────────────────────────────
--
-- It does not let anybody grant `owner`. A function by which an owner can make
-- a second owner is a function by which a compromised owner account can make
-- itself permanent, and the second owner can then remove the first. Ownership
-- is granted where ownership is decided — part 290 makes the same call about
-- `owner_sites` and gives the same reason.
--
-- It does not widen anything in the web console. Every page there gates on
-- `me.role !== 'owner'` or `!== 'owner' && !== 'trainer'`, and the `Role` union
-- in studio-web/lib/supabase.ts still lists three values, so a receptionist
-- signing into the console today is refused by every screen including the door.
-- The database is the authority and the database is what this changes; the
-- screens are named in the footer so the next person does not have to find
-- them. A grant made today is real, recorded and enforced — it simply has no
-- console surface for its holder yet, which is a smaller and much more visible
-- gap than a role that half-works.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · a fourth role ────────────────────────────────────────────────────
--
-- Both names dropped, because the original is the inline `check (role in (…))`
-- from part 01 and carries Postgres's generated name, while a database built
-- from these parts more than once already carries the explicit one.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_known;
alter table public.profiles add constraint profiles_role_known
  check (role in ('owner', 'trainer', 'client', 'receptionist'));

comment on column public.profiles.role is
  'owner · trainer · client · receptionist. A receptionist works the gym''s door and its member records and is NOT a coach: they have no trainers row, no book, no place in payroll and no session of their own. Every staff policy in this schema names its roles explicitly, so this value reaches only what parts 32 and 197 were widened to admit here — adding a role grants nothing by itself. Changed only through grant_staff_role / revoke_staff_role; guard_profile_identity (part 38) refuses a profile changing its own.';

-- Signing up AS a receptionist is possible in the same way signing up as an
-- owner is, and it is harmless for the same reason part 38 gives: every new
-- profile gets its own fresh tenant, so somebody who does it is the
-- receptionist of their own empty gym. The danger was never the role, it was
-- moving an existing profile into somebody else's tenant, and that is still
-- refused for everybody except the definer functions below.

-- ── 2 · what a grant is, written down ────────────────────────────────────

-- ── how this survives an erasure, and why it is built this way ───────────
--
-- The obvious shape for an audit table is `on delete restrict` on both people,
-- so the record cannot be destroyed by deleting an account. It is wrong here
-- and part 184 is why: `profiles` rows are genuinely deleted by the erasure
-- flow, a member may run that flow themselves, and a RESTRICT anywhere in this
-- schema would turn "erase my account" into a foreign-key violation the person
-- cannot act on. An access log that blocks a subject access request is not a
-- compliance feature.
--
-- So this takes part 184's own shape instead, without a word changed: SNAPSHOT
-- THE NAME, then let the key null itself. `profiles_retain_financial_record`
-- copies `full_name` onto invoices, payments and memberships immediately before
-- a profile is deleted precisely so the record stays legible when the link
-- goes, and the two name columns below do the same job at write time rather
-- than at delete time — there is nothing here worth a second BEFORE DELETE
-- trigger, and a name captured when the grant was made is the more truthful
-- one anyway: it is who they were called when somebody let them in.
--
-- The consequence, said plainly: after an erasure this row still says a person
-- by that name was made a receptionist here on that date by that owner, and no
-- longer says which account they were. That is the right side of the trade —
-- the alternative is a gym unable to prove who granted access to its members'
-- medical notes, and a member unable to delete their account.
create table if not exists public.staff_grants (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  -- The person the access was granted to. Nullable ONLY because an erasure
  -- nulls it; grant_staff_role never writes a null.
  subject_id   uuid references public.profiles(id) on delete set null,
  subject_name text,
  -- The person who made the grant, and who they were called at the time.
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text,
  -- 'trainer' or 'receptionist'. Never 'owner' — see the header — and never
  -- 'client', which is not a grant of anything.
  role         text not null check (role in ('trainer', 'receptionist')),
  granted_at   timestamptz not null default now(),
  -- Set when the access was taken away again. The row is never deleted and
  -- never rewritten into a different shape: "was on the staff from March to
  -- September" is the fact somebody will eventually need, and it is not
  -- reconstructible from a row that has been tidied up.
  --
  -- `revoked_at` alone is what says a grant has ended. There is deliberately no
  -- CHECK tying it to `revoked_by`: a CHECK is re-validated on UPDATE, and
  -- `on delete set null` IS an update — so a pairing constraint would make
  -- erasing the owner who ended somebody's access fail, which is the exact
  -- failure this whole block is written to avoid.
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null,
  revoked_by_name text,
  note         text
);

-- A database built from these parts before this comment existed carries the
-- earlier, narrower shape. Both name columns and the wider keys are added
-- rather than assumed, and the old pairing constraint is dropped, so a re-run
-- converges on the shape above.
alter table public.staff_grants add column if not exists subject_name    text;
alter table public.staff_grants add column if not exists actor_name      text;
alter table public.staff_grants add column if not exists revoked_by_name text;
alter table public.staff_grants drop constraint if exists staff_grants_revoked_together;

create index if not exists idx_staff_grants_tenant
  on public.staff_grants (tenant_id, granted_at desc);
-- The question the console actually asks: is this person currently staff here.
create index if not exists idx_staff_grants_live
  on public.staff_grants (tenant_id, subject_id) where revoked_at is null;

comment on table public.staff_grants is
  'Who put whom on this gym''s staff, when, as what, and who took it away again. Written only by grant_staff_role and revoke_staff_role, in the same transaction as the change itself, because putting somebody on a gym''s staff hands them every member''s next-of-kin details and operational medical note (gym_member_records, part 197) and an access grant of that kind needs a name against it. Rows are never deleted and never rewritten: "was staff from March to September" is the fact somebody eventually needs. Both people''s names are snapshotted at write time and their ids are ON DELETE SET NULL, so an account erasure leaves the record legible instead of being blocked by it — part 184''s shape.';
comment on column public.staff_grants.subject_id is
  'ON DELETE SET NULL, with the name snapshotted beside it — part 184''s shape. A RESTRICT here would make an account erasure fail with a foreign-key violation the person cannot act on, and an access log that blocks a subject access request is not a compliance feature. After an erasure the row still says who was granted what, when and by whom, and no longer says which account they were.';
comment on column public.staff_grants.subject_name is
  'What they were called when the grant was made. Written by grant_staff_role, never updated afterwards: a name at the moment somebody was let in is the fact this row is evidence of, and it is what remains legible once the profile has been erased.';

alter table public.staff_grants enable row level security;

-- The gym's owner reads their own gym's grants. `is_owner_of` is SECURITY
-- DEFINER, so this does not re-enter anything (part 28).
drop policy if exists staff_grants_owner_r on public.staff_grants;
create policy staff_grants_owner_r on public.staff_grants
  for select using (public.is_owner_of(tenant_id));

-- And the subject reads their own. Somebody is entitled to know that they were
-- given access to a gym's records and when it was taken away; a log about a
-- person that the person may not see is a worse artefact than no log.
drop policy if exists staff_grants_self_r on public.staff_grants;
create policy staff_grants_self_r on public.staff_grants
  for select using (subject_id = (select auth.uid()));

-- There is deliberately NO insert, update or delete policy for anybody. The
-- only writers are the two SECURITY DEFINER functions below, which bypass RLS
-- and check the caller themselves. A table that records who granted access is
-- worthless if the grantee can write it, and an owner who could edit it could
-- make a grant look like it never happened.
drop policy if exists staff_grants_w on public.staff_grants;

-- ── 3 · making somebody staff ────────────────────────────────────────────
--
-- SECURITY DEFINER is required rather than convenient, exactly as it is for
-- `end_coaching` (part 68): `guard_profile_identity` refuses a role or tenant
-- change made by `authenticated`, and there is no owner UPDATE policy on
-- `profiles` for it to refuse in the first place. One function owned by the
-- database is the only place the profile write, the roster row and the audit
-- row can happen together.
--
-- The identity test is `auth.uid()` and never `current_user` — part 68's header
-- records `current_user` shipping in this project as a guard that provided
-- none, because inside a definer function it is the function's OWNER.
--
-- Atomic, and half of this would be the bug: a call that moved the profile and
-- then failed before writing `staff_grants` would produce exactly the state
-- this file exists to end — somebody with access to a gym's medical notes and
-- nothing anywhere saying who let them in. A plpgsql body runs inside the
-- caller's transaction and PostgREST wraps each request in one, so an exception
-- anywhere below aborts all of it. Nothing here commits and nothing here
-- swallows an exception.
create or replace function public.grant_staff_role(
  p_subject uuid,
  p_role    text,
  p_note    text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_tenant  uuid;
  v_actor   text;
  v_subject record;
  v_grant   uuid;
begin
  -- WHOSE gym, and what the person making the grant is called. Both taken from
  -- the caller rather than from an argument, so there is no gym id to supply
  -- and therefore no wrong one to supply, and no name to supply either.
  select p.tenant_id, p.full_name into v_tenant, v_actor
    from public.profiles p where p.id = auth.uid();

  if v_tenant is null or not public.is_owner_of(v_tenant) then
    raise exception 'Only the owner of a gym can put somebody on its staff.'
      using errcode = '42501';
  end if;

  if p_role not in ('trainer', 'receptionist') then
    raise exception 'A staff role is trainer or receptionist, not %', coalesce(p_role, 'nothing')
      using errcode = '22023',
            hint = 'Ownership is not granted from here — a function that makes a second owner is a function that makes a compromised account permanent.';
  end if;

  select p.id, p.role, p.tenant_id, p.full_name into v_subject
    from public.profiles p where p.id = p_subject;

  if v_subject.id is null then
    raise exception 'There is no account with that id, so there is nobody to put on the roster.'
      using errcode = '23503';
  end if;

  if v_subject.id = auth.uid() then
    raise exception 'You already own this gym. Granting yourself a staff role would take your own access away.'
      using errcode = '22023';
  end if;

  -- An owner is never demoted by this. Somebody else's ownership of somewhere
  -- else is not this owner's to end, and their ownership of HERE is not
  -- something a staff screen should be able to remove.
  if v_subject.role = 'owner' then
    raise exception 'That account owns a gym. Ownership is not changed from the staff roster.'
      using errcode = '42501';
  end if;

  -- Somebody else's staff or somebody else's member. Refused rather than
  -- moved: a person can be in one gym at a time in this schema, and quietly
  -- taking them out of another gym would remove that gym's access to its own
  -- coach with nothing there to say why.
  if v_subject.tenant_id is not null and v_subject.tenant_id <> v_tenant then
    raise exception 'That account already belongs to another gym. They have to leave it first.'
      using errcode = '42501';
  end if;

  update public.profiles
     set role = p_role, tenant_id = v_tenant
   where id = p_subject;

  -- A coach needs the roster row every per-coach figure is joined on; a
  -- receptionist must NOT have one. `trainers` is what puts somebody in the
  -- payroll, in the rota's staff picker and in the directory, and a person on
  -- the desk belongs in none of those.
  if p_role = 'trainer' then
    insert into public.trainers (id, tenant_id) values (p_subject, v_tenant)
    on conflict (id) do update set tenant_id = excluded.tenant_id;
  end if;

  -- One live grant per person per gym. Re-granting a role somebody already
  -- holds closes the old row and opens a new one, so a change of role reads as
  -- two dated facts rather than as one row that has always said whatever it
  -- says now.
  update public.staff_grants
     set revoked_at = now(), revoked_by = auth.uid(), revoked_by_name = v_actor,
         note = coalesce(note, '') || ' (superseded by a new grant)'
   where tenant_id = v_tenant and subject_id = p_subject and revoked_at is null;

  insert into public.staff_grants
    (tenant_id, subject_id, subject_name, actor_id, actor_name, role, note)
  values (v_tenant, p_subject, v_subject.full_name, auth.uid(), v_actor, p_role,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_grant;

  return jsonb_build_object(
    'grant_id', v_grant,
    'subject_id', p_subject,
    'role', p_role,
    'roster_row', p_role = 'trainer',
    'was', v_subject.role);
end $fn$;

revoke all on function public.grant_staff_role(uuid, text, text) from public, anon;
grant execute on function public.grant_staff_role(uuid, text, text) to authenticated;

comment on function public.grant_staff_role(uuid, text, text) is
  'Put somebody on this gym''s staff as a trainer or a receptionist. Callable only by the gym''s owner, into their own gym, and it writes the staff_grants row in the same transaction as the profile change — a grant of access to every member''s medical note and payment history has a name and a date against it or it does not happen. Refuses ownership, refuses a person who belongs to another gym, and refuses the caller themselves.';

-- ── 4 · taking it away, and refusing to do it by halves ──────────────────
create or replace function public.revoke_staff_role(
  p_subject uuid,
  p_note    text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_tenant  uuid;
  v_actor   text;
  v_subject record;
  v_clients int;
  v_rows    int;
begin
  select p.tenant_id, p.full_name into v_tenant, v_actor
    from public.profiles p where p.id = auth.uid();

  if v_tenant is null or not public.is_owner_of(v_tenant) then
    raise exception 'Only the owner of a gym can take somebody off its staff.'
      using errcode = '42501';
  end if;

  select p.id, p.role, p.tenant_id, p.full_name into v_subject
    from public.profiles p where p.id = p_subject;

  if v_subject.id is null or v_subject.tenant_id is distinct from v_tenant then
    raise exception 'That account is not on this gym''s staff.'
      using errcode = '42501';
  end if;

  if v_subject.id = auth.uid() or v_subject.role = 'owner' then
    raise exception 'An owner is not removed from the staff roster. A gym with nobody who can administer it cannot be repaired from inside the product.'
      using errcode = '42501';
  end if;

  if v_subject.role not in ('trainer', 'receptionist') then
    raise exception 'That account is a member of this gym rather than staff, so there is no staff access to take away.'
      using errcode = '22023';
  end if;

  -- THE REFUSAL. See the header: `is_my_client()` has no tenant in it, so a
  -- coach with clients still pointed at them keeps a complete read of those
  -- people's health history after this function has said they are gone. The
  -- book is unpicked by `end_coaching` (part 68), which writes both halves and
  -- is a decision about a coaching relationship rather than a side effect of a
  -- staff change.
  select count(*) into v_clients from public.clients c
   where c.trainer_id = p_subject and c.tenant_id = v_tenant;

  if v_clients > 0 then
    raise exception
      'That coach still has % client(s) on their book. Removing them from the staff would NOT remove their access to those clients'' training and health record, because that access follows the book and not the gym. Reassign or end those relationships first.', v_clients
      using errcode = '42501',
            hint = 'end_coaching(coach, client) ends one relationship; reassigning a client to another coach also clears it.';
  end if;

  -- Clearing the tenant is what actually removes the access: every staff policy
  -- in this schema is `tenant_id = my_tenant()` and `my_tenant()` is now null,
  -- and `is_owner_of` was already false. The ROLE is deliberately left alone —
  -- rewriting somebody to 'client' would be a false statement about who they
  -- are and would hand them the member half of the product at this gym they no
  -- longer belong to.
  update public.profiles set tenant_id = null where id = p_subject;
  get diagnostics v_rows = row_count;

  -- The roster row is KEPT, and this is the same call `gym_shifts` makes about
  -- a pulled shift: a coach who left and delivered forty sessions is not the
  -- same thing as a coach who never existed, and deleting the `trainers` row
  -- would set `clients.trainer_id` to null underneath the history and strand
  -- every per-coach figure that joins on it. It is inert without the tenant on
  -- the profile — `trainers_peer_r` is `my_role() = 'trainer' and tenant_id =
  -- my_tenant()`, which is now false.

  update public.staff_grants
     set revoked_at = now(), revoked_by = auth.uid(), revoked_by_name = v_actor,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where tenant_id = v_tenant and subject_id = p_subject and revoked_at is null;

  -- No live grant to close is not an error: the person may have been made staff
  -- by a join code before this part existed. The revocation is still recorded,
  -- as its own row, so the removal has a date on it either way.
  if not found then
    insert into public.staff_grants
      (tenant_id, subject_id, subject_name, actor_id, actor_name, role,
       granted_at, revoked_at, revoked_by, revoked_by_name, note)
    values (v_tenant, p_subject, v_subject.full_name, auth.uid(), v_actor, v_subject.role,
            now(), now(), auth.uid(), v_actor,
            coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                     'Removed. There was no recorded grant — they joined before staff_grants existed.'));
  end if;

  return jsonb_build_object(
    'subject_id', p_subject,
    'was', v_subject.role,
    'profile_rows', v_rows,
    'clients_on_book', v_clients);
end $fn$;

revoke all on function public.revoke_staff_role(uuid, text) from public, anon;
grant execute on function public.revoke_staff_role(uuid, text) to authenticated;

comment on function public.revoke_staff_role(uuid, text) is
  'Take somebody off this gym''s staff. Callable only by the gym''s owner. Clears profiles.tenant_id, which is what every tenant-scoped policy tests; keeps the trainers row, because a coach who left is not a coach who never existed; and RAISES rather than half-removing a coach who still has clients on their book — that access follows clients.trainer_id and would survive this call, so it is refused and end_coaching is named.';

-- ── 5 · the two things the desk is for ───────────────────────────────────
--
-- Widened, and only these two. Both were already open to every trainer in the
-- gym, so a receptionist joining them is not a new disclosure of anything — it
-- is the same access given to the person whose actual job it is, instead of to
-- a coach who was given it because 'trainer' was the only role there was.

-- The door. `gym_visits` is the front desk's table: taking somebody in, marking
-- them out, and the anonymous head count. Part 32's own comment on these three
-- policies is "Staff work the door; they may record visits without being an
-- owner", which is a sentence about the desk written before the desk had a
-- role.
drop policy if exists gym_visits_staff_rw on public.gym_visits;
create policy gym_visits_staff_rw on public.gym_visits
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner', 'receptionist'));

drop policy if exists gym_visits_staff_w on public.gym_visits;
create policy gym_visits_staff_w on public.gym_visits
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer', 'owner', 'receptionist'));

drop policy if exists gym_visits_staff_u on public.gym_visits;
create policy gym_visits_staff_u on public.gym_visits
  for update using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner', 'receptionist'))
  with check (tenant_id = my_tenant() and my_role() in ('trainer', 'owner', 'receptionist'));

-- The member record. SELECT only, which is what part 197 already gives a
-- trainer, and its reason is the desk's reason word for word: "the desk needs
-- the next-of-kin number at nine on a Sunday". The write stays the owner's.
--
-- This is the grant that makes `staff_grants` worth having. It is the emergency
-- contact, the operational medical note and the desk's own note about every
-- member of the gym, and the person who hands it over should be recorded
-- handing it over.
drop policy if exists gmr_staff_r on public.gym_member_records;
create policy gmr_staff_r on public.gym_member_records
  for select using (tenant_id = public.my_tenant()
                    and public.my_role() in ('trainer', 'owner', 'receptionist'));

-- ═════════════════════════════════════════════════════════════════════════
-- WHAT EACH ROLE CAN REACH, AFTER THIS PART
--
-- Every row below is what the POLICIES say, not what a screen says. The
-- console's own gates are narrower and are listed at the foot.
--
--                                     owner  trainer  receptionist  client
--   the gym's own row (tenants)         rw     r        r             r
--     — name, brand, currency, TIMEZONE, plan and session_fee. `tenants_read`
--       is `id = my_tenant()` and names no role, so the gym's headline session
--       fee is visible to everybody inside the gym and always has been. "No pay
--       rates" below means no PER-PERSON pay, which is the thing a receptionist
--       must not see and does not.
--   door log (gym_visits)               rw     rw       rw            own only
--   member records (gym_member_records) rw     r        r             own only
--   passes, drop-ins (gym_passes)       rw     rw       —             own only
--   equipment register                  rw     rw       —             —
--   gym documents                       all    building —             —
--                                              paperwork only (part 390)
--   the rota (gym_shifts) and its
--     per-shift rate                    rw     see part —             —
--                                              its own
--   payroll, settlements, coach
--     earnings, session rates           rw     own only —             —
--   coach_clients, subscriptions,
--     invoices, connect accounts,
--     app errors                        r      —        —             —
--   a member's training and health
--     record                            —      own book —             own
--                                              only
--   staff_grants                        r      —        own rows      own rows
--                                              (own rows)
--
-- The receptionist column is two entries wide on purpose. Everything else in
-- this schema names its roles explicitly, so the role reaches nothing that is
-- not written above — and the next person who wants to widen it has to write a
-- line in a file like this one saying which table and why.
--
-- WHAT RECORDS A GRANT: `staff_grants`, one row per grant, holding the gym, the
-- person, the role, the owner who made it, the moment, and — when it ends — the
-- moment and the owner who ended it. It is written by `grant_staff_role` and
-- `revoke_staff_role` in the same transaction as the access change itself, and
-- it has no write policy for anybody, including the owner whose gym it is.
--
-- ── STILL TO DO, AND NAMED SO IT IS NOT DISCOVERED ──────────────────────
--
-- A receptionist cannot use the web console. Every page gates on `me.role`, and
-- the `Role` union in studio-web/lib/supabase.ts is still the original three:
--
--   · studio-web/lib/supabase.ts       `Role` needs the fourth value.
--   · studio-web/app/door/page.tsx     gates `!== 'owner' && !== 'trainer'`
--                                      twice — this is the screen the role
--                                      exists for.
--   · studio-web/app/members/page.tsx  owner-only today; the member RECORD is
--                                      what the desk needs, and the money on
--                                      that screen is what it must not have.
--   · studio-web/components/Shell.tsx  the rail decides what is offered.
--
-- Until those change, a grant made here is enforced and recorded and its holder
-- has no screen. That is deliberately the way round it is: a role the database
-- honours and the console has not caught up with is a visible gap, and a
-- console that offers a receptionist screens the database will refuse is the
-- failure part 530 spends forty lines declining to ship.
-- ═════════════════════════════════════════════════════════════════════════
