-- ── The intervention loop ───────────────────────────────────────────────────
--
-- Phase 4. Retention already SURFACES who is drifting, in three places: the
-- Studio retention roll-up, the Studio members screen and the coach's client
-- book. All three read the same model — `assessDrift` in clientDrift.ts, a
-- break in a person's OWN pattern rather than a level — so they name the same
-- member. What none of them could do was close the loop.
--
-- There was nowhere to record that anybody was contacted. So the gym surfaced
-- the same person every Monday, two staff rang them in the same week, and no
-- one could ever say whether anything the gym does makes a difference. This
-- table is the missing half.
--
-- Additive only. Nothing here alters an existing table.
--
-- ── WHAT THIS TABLE IS NOT, AND WHY THAT IS THE DESIGN ──────────────────────
--
-- 1. IT IS NOT ATTENDANCE. A phone call is not a training session. Nothing in
--    this table is ever read as a sign of life: `activityFor` in gymRetention
--    .ts builds its events from visits, ticked-off class bookings and delivered
--    one-to-ones, and this table is deliberately not one of the four parts a
--    `RetentionRecord` carries. If logging a call nudged a member's drift
--    verdict toward healthy, the loop would report its own activity back to the
--    gym as retention — the tool would get better at looking useful in exactly
--    the moment it stopped being useful. src/lib/interventions.ts takes a
--    finished `Drift` as INPUT and never contributes to one.
--
-- 2. IT IS NOT A SCOREBOARD. There is no `worked boolean` column, and there
--    will not be one, because nobody at the desk can know. A member who came
--    back may have come back anyway; a member who left may have left despite a
--    good call. What the record can honestly carry is what was TRIED (below)
--    and what FOLLOWED (computed, in interventions.ts, from the member's own
--    attendance either side of the contact — a sequence, never a cause). The
--    one column that comes close, `outcome`, is about the CONVERSATION — did
--    anybody actually pick up — and is not about whether the member returned.
--
-- 3. IT IS NOT A REMINDER LIST. `at` is when the contact HAPPENED. A row for a
--    call somebody intends to make on Thursday is a plan, and a plan recorded
--    as a contact would start the measurement window on a day nothing occurred.
--    The trigger below refuses a future `at` outright.
--
-- ── WHY `at` AND `created_at` ARE BOTH HERE ─────────────────────────────────
--
-- `at` is when the person was contacted; `created_at` is when somebody typed it
-- in. They differ whenever a call is written up later, which is most of them.
-- Every window in interventions.ts hangs off `at`, and keeping `created_at`
-- separate means a backfilled fortnight of calls is visible as a backfill
-- rather than looking like a fortnight of diligent same-day logging.
--
-- ── MEMBER ACCESS: DELIBERATELY NONE, AND THAT IS NOT SETTLED ───────────────
--
-- There is no member SELECT policy below. `gym_visits` has one, on the stated
-- grounds that "when did I actually come in" is the member's record too — this
-- is a different kind of row. These are staff notes ABOUT a person ("said the
-- 6am is too early, offered the 7:15"), and a note the subject can read is a
-- note that stops being written honestly, which would empty the one column
-- that keeps a second caller from repeating the first one's call.
--
-- That is a product decision, not a legal one, and it should be flagged rather
-- than quietly inherited: this is personal data about an identified person, so
-- a subject access request covers it whatever the policy says. `src/lib/gdpr.ts`
-- builds the member's own export and does NOT include this table. Somebody has
-- to decide whether it should — this comment exists so that decision is made on
-- purpose instead of by omission.

create table if not exists member_interventions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Cascade, matching `memberships`: when a member's account is deleted the
  -- notes somebody wrote about them go with it. An intervention row that
  -- outlived its subject would be a retained note about a deleted person.
  member_id uuid not null references profiles(id) on delete cascade,

  -- When the contact happened. Not defaulted to now() on purpose: a value
  -- somebody had to supply is a value somebody had to think about, and the
  -- application sends the real time. See the trigger for the future guard.
  at timestamptz not null,

  -- HOW. Closed enough to count, loose enough to be true. 'other' exists so
  -- nobody files a conversation in the car park under 'call'.
  channel text not null
    check (channel in ('call','text','email','whatsapp','app_message','in_person','other')),

  -- WHO. `on delete set null` rather than cascade: a trainer leaving must not
  -- erase the record that the call was made. `by_name` is denormalised for
  -- exactly that moment — once the profile is gone, the id is a dead uuid and
  -- the name written down at the time is the only thing left that answers
  -- "has anybody already spoken to her?".
  by_id uuid references profiles(id) on delete set null,
  by_name text,

  -- WHAT CAME OF THE CONTACT ITSELF — not of the member. 'reached' means a
  -- human answered, nothing more. The default is 'unknown' rather than
  -- 'reached' because a row nobody finished filling in must not assert that
  -- somebody was spoken to.
  --
  -- 'bounced' earns its place: a dead number or a hard-bouncing address is a
  -- finding about the gym's own records, and it is invisible if it is filed
  -- under 'no_answer'.
  outcome text not null default 'unknown'
    check (outcome in ('reached','replied','no_answer','left_message','bounced','declined','unknown')),

  -- WHAT WAS SAID. The whole reason two people do not make the same call.
  note text,

  created_at timestamptz not null default now()
);

-- The two directions this is read: one gym's recent interventions (the Studio
-- panel, and the quietening pass over the surfaced list), and one member's
-- history (the row detail, and every follow-up window, which walks a member's
-- contacts in order to find where the next one truncates the last).
create index if not exists idx_member_interventions_tenant
  on member_interventions(tenant_id, at desc);
create index if not exists idx_member_interventions_member
  on member_interventions(member_id, at desc);

-- NOT ENFORCED, deliberately: a uniqueness rule on (member_id, at). Two staff
-- genuinely can contact the same member on the same day — that is the duplicate
-- effort this table exists to make visible, and a constraint would hide it by
-- refusing the second row. interventions.ts surfaces it instead: a second
-- contact inside the first one's judgement window makes that window
-- unjudgeable, and says so.


-- ── the integrity trigger ───────────────────────────────────────────────────
--
-- NOT `security definer`, and that is the point rather than an oversight.
--
-- 38-tenant-isolation.sql's `guard_profile_identity` tests `current_user` to
-- tell an app request ('authenticated'/'anon') from a definer function running
-- as its owner. That test only works because the function is an ORDINARY one:
-- inside a `security definer` function `current_user` is the function's OWNER,
-- so the same guard would compare 'postgres' against 'authenticated', never
-- fire, and read like protection while providing none. That bug shipped in this
-- codebase, so it is written down where the next trigger gets copied from.
--
-- This function does not need to know who the caller is at all. Every rule
-- below is about the ROW, and authorisation lives in the policies underneath.
-- It stays an invoker function so that it cannot acquire a privilege it has no
-- use for.
create or replace function public.guard_member_intervention()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A contact cannot have happened in the future. A few minutes of slack for a
  -- browser clock that is ahead of the database; beyond that it is a plan, a
  -- typo, or a timezone bug, and all three would open a measurement window over
  -- days that have not happened yet.
  if new.at > now() + interval '5 minutes' then
    raise exception 'An intervention is a record of a contact that happened, not one that is planned. "%" is in the future.', new.at
      using errcode = '22007';
  end if;

  if TG_OP = 'UPDATE' then
    -- `at` and `member_id` are the two columns every follow-up window hangs
    -- off. Letting them move re-dates conclusions that were already drawn and
    -- reported, silently. Correcting the note or the outcome is ordinary
    -- write-up; moving the contact to a different person or a different week is
    -- rewriting history, and the way to do that is to delete the row and log
    -- the real one — which leaves the deletion where an owner can see it.
    if new.member_id is distinct from old.member_id then
      raise exception 'An intervention cannot be moved to a different member. Delete it and log the one that actually happened.'
        using errcode = '42501';
    end if;
    if new.at is distinct from old.at then
      raise exception 'When a contact happened is not editable — every "did it work?" window is measured from it. Delete it and log the one that actually happened.'
        using errcode = '42501';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'An intervention cannot be moved between gyms.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists guard_member_intervention_t on public.member_interventions;
create trigger guard_member_intervention_t
  before insert or update on public.member_interventions
  for each row execute function public.guard_member_intervention();


-- ── row-level security ──────────────────────────────────────────────────────
--
-- Enabled BEFORE any policy is written. A policy on a table with RLS off is
-- inert: Postgres never consults it and Supabase's default grants to anon and
-- authenticated apply in full — the exact shape that left four tables
-- world-writable until 38-tenant-isolation.sql. The anon key ships inside the
-- mobile bundle, so "inert" here would mean these notes were public.
--
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it protects (28-fix-profiles-recursion.sql).
alter table member_interventions enable row level security;

-- The owner's table: they read the whole gym's loop and they are the only role
-- that may correct or remove a row.
--
-- Note that this `for all` does NOT carry the `by_id = auth.uid()` check the
-- trainer insert below does, and RLS takes the most permissive matching policy
-- — so an owner may file a contact under another name. That is deliberate and
-- narrow: the person at the desk on a Saturday often has no account of their
-- own, and the owner writing up "Priya rang her" is the only way that call gets
-- recorded at all. It is stated here so it is a decision rather than a gap
-- somebody finds later.
drop policy if exists member_interventions_owner on member_interventions;
create policy member_interventions_owner on member_interventions
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Trainers READ the whole gym's interventions. This is the point of the table:
-- a trainer about to ring a client has to be able to see that the desk rang
-- them on Tuesday. Scoped to their own gym via my_tenant(), never to "is a
-- trainer somewhere" — the mistake 39-owner-policy-scope.sql exists to undo.
drop policy if exists member_interventions_staff_r on member_interventions;
create policy member_interventions_staff_r on member_interventions
  for select using (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

-- Trainers LOG their own. `by_id = auth.uid()` is enforced in the check rather
-- than trusted from the client: without it a trainer could file a call under a
-- colleague's name, and "who has already tried" — the one thing that stops the
-- second call — would be unreliable exactly where it matters.
drop policy if exists member_interventions_staff_w on member_interventions;
create policy member_interventions_staff_w on member_interventions
  for insert with check (
    tenant_id = my_tenant()
    and my_role() in ('trainer','owner')
    and by_id = (select auth.uid())
  );

-- Supabase's default privileges hand SELECT/INSERT/UPDATE/DELETE on every new
-- public table to BOTH `anon` and `authenticated` — verified on this table in a
-- rolled-back transaction, not assumed. RLS above is what actually stops an
-- anonymous caller, and it does: none of the three policies can be satisfied
-- without a signed-in profile. This revoke is belt and braces on top of it.
--
-- It is worth having because the anon key is compiled into the shipped mobile
-- app, and because these rows are free-text staff notes about named people —
-- the highest-consequence thing on this page to get wrong. Nothing in any of
-- the three apps reads this table as `anon`.
--
-- Note that the sibling tables (gym_visits, memberships, …) do NOT carry this
-- and rely on RLS alone. That is not an inconsistency to copy back over them
-- blindly; it is one table taking a second lock because of what it holds.
revoke all on table public.member_interventions from anon;

-- No trainer UPDATE and no trainer DELETE, deliberately. A log its own author
-- can rewrite or remove is not a record — the value of "somebody already called
-- her on Tuesday" is that it cannot quietly stop being true. Owners can, and an
-- owner editing their gym's own record is the accountable case.

-- No member policy. See the header: this is a product decision with a subject
-- access consequence that has not been settled.

-- No functions are added here beyond the trigger function, which is reached by
-- the trigger rather than called, so nothing needs the revoke-from-PUBLIC
-- treatment 40-function-grants.sql applies. If a callable function is ever
-- added to this file, re-run that part: Postgres grants EXECUTE to PUBLIC by
-- default on every new function and `anon` resolves through PUBLIC, so
-- `revoke ... from anon` alone accomplishes nothing — it must name PUBLIC and
-- grant back to `authenticated` explicitly.
