-- ═══════════════════════════════════════════════════════════════════════════
-- A coach fixes week three of the bootcamp and cannot tell who has the fix.
--
-- `program_groups.program` holds ONE programme and no memory of the ones before
-- it. Assigning to a group is a fan-out into each member's own
-- `assigned_programs` row — part 134 argues that at length and none of it has
-- changed — and `memberState` in src/lib/groupProgram.ts tells the coach who is
-- on the group's programme by comparing fingerprints.
--
-- With one stored programme that comparison has exactly two answers: on it, or
-- not on it. So a member still training last month's version of the bootcamp
-- and a member whose Thursday was rewritten around their shoulder both read
-- 'diverged'. That is true and it is useless, because those two need OPPOSITE
-- actions: the first needs one tap, and the second must not be touched at all.
--
-- ── What this part does NOT do, and why ───────────────────────────────────
--
-- It does not make the group own the plan. Part 134 gives three reasons and
-- every one of them still holds:
--
--   · everything downstream of a programme is keyed per client already — the
--     Train tab, logged sets, adherence, the injury acknowledgement of a
--     specific movement for a specific person — so a group-owned plan must be
--     reconciled on every read, in a CLIENT APP THAT IS ALREADY ON PHONES and
--     has never heard of a group;
--   · divergence is the job, not the exception, and under a group-owned plan
--     the per-client edit becomes an override table, which is a second source
--     of truth for one question;
--   · silently rewriting the session somebody is doing this evening is the
--     exact failure `guardOverwrite` exists to prevent.
--
-- It also does not stamp a version number onto the member row when the fan-out
-- writes. That is the tempting version and it is bookkeeping about a write: the
-- builder lets a coach edit ONE client's copy afterwards, and the stamp would go
-- on claiming version 3 for somebody now on something bespoke. Part 134 chose
-- derivation over bookkeeping for precisely this reason — "who has it" is
-- answered by comparing each member's actual row against the group's programme
-- rather than by a record that can drift away from the truth it describes.
--
-- ── What it does ──────────────────────────────────────────────────────────
--
-- Keeps the group's PAST programmes, so there is something to compare against.
-- One table, append-only, written when the coach changes the group's programme.
-- `versionOf` then reports which stored version a member's actual assignment
-- fingerprints as, recomputed from the truth every time, and a member who is on
-- none of them is bespoke rather than out of date.
--
-- ── Why the version number is assigned in the database ────────────────────
--
-- Two coaches do not share a group, so the contended case is one coach with the
-- screen open on two devices — rare, and the failure is not rare enough to
-- ignore: two clients of `max(version) + 1` computed in JavaScript produce two
-- rows numbered 3, and the group then has two version 3s that fingerprint
-- differently. `snapshot_group_program` takes an advisory lock on the group and
-- allocates inside it, the same shape `issue_coach_invoice` in part 138 uses
-- for invoice numbers and for the same reason: a number a person will read back
-- to somebody has to be unique.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.program_group_versions (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.program_groups(id) on delete cascade,
  -- 1-based and allocated under a lock. Unique per group, which is what makes
  -- "they are on version 2" a sentence with one meaning.
  version    integer     not null check (version >= 1),
  -- The programme AS IT WAS at that version, in full. Not a diff: a diff is
  -- only readable against a version that itself exists, and the whole reason
  -- this table is here is that the previous version did not.
  program    jsonb       not null,
  created_at timestamptz not null default now(),
  unique (group_id, version)
);

-- The only read: one group's versions, newest first.
create index if not exists program_group_versions_group_idx
  on public.program_group_versions (group_id, version desc);

comment on table public.program_group_versions is
  'Every programme a group has been given, kept so "which version is this member on" can be DERIVED from their actual assignment rather than stamped on them at fan-out time and left to go stale.';

alter table public.program_group_versions enable row level security;

-- ── Access ────────────────────────────────────────────────────────────────
--
-- The owning coach and nobody else, matching `program_groups` exactly. A group
-- is the coach's own filing — part 134 says why there is no client-read policy
-- on it — and the history of what that filing said is no more the client's
-- business than the filing itself. What the client is entitled to see is what
-- THEY were assigned, and that is `assigned_programs` and, since part 176,
-- `assigned_program_history`, both of which carry a client-read policy.
--
-- USING is group ownership alone, with no `is_my_client()` anywhere: this table
-- names no client. The asymmetry part 134 needed on the membership table has no
-- analogue here.
drop policy if exists program_group_versions_coach_rw on public.program_group_versions;
create policy program_group_versions_coach_rw on public.program_group_versions
  for select
  to authenticated
  using (
    exists (select 1 from public.program_groups g
             where g.id = group_id and g.coach_id = (select auth.uid()))
  );

-- RLS narrows a GRANT and does not confer one; Supabase's stock default
-- privileges hand `anon` the full DML set on every table created in this schema
-- (part 119), so this arrived reachable by the publishable key. SELECT only,
-- to `authenticated` only — the writes go through the function below, which is
-- what makes "append-only" a property of the database rather than a habit.
revoke all on public.program_group_versions from anon, authenticated;
grant select on public.program_group_versions to authenticated;

-- ── Recording a version ───────────────────────────────────────────────────
--
-- Dropped before it is recreated. `create or replace` with a different argument
-- list makes an OVERLOAD, and PostgREST resolving one name against two
-- candidates is a 300 at the moment a coach taps Change Programme.
drop function if exists public.snapshot_group_program(uuid, jsonb);

create or replace function public.snapshot_group_program(p_group_id uuid, p_program jsonb)
returns public.program_group_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n   integer;
  last_program jsonb;
  out_row public.program_group_versions;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_program is null then
    raise exception 'a version has to carry a programme';
  end if;

  -- Ownership checked HERE rather than left to RLS, because this function is
  -- SECURITY DEFINER and therefore runs with the policies of its owner. Part
  -- 105 opened a real hole exactly this way. A definer function that takes an
  -- id from the caller must re-ask the question the policy would have asked.
  if not exists (
    select 1 from public.program_groups g
     where g.id = p_group_id and g.coach_id = uid
  ) then
    raise exception 'that group is not one of yours';
  end if;

  -- One coach, two devices. Two clients computing max(version) + 1 in
  -- JavaScript both write 3, and the group then has two version 3s that
  -- fingerprint differently — after which "they are on version 3" means two
  -- things. The lock is on the GROUP so it never contends across groups.
  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text, 177));

  select v.program into last_program
  from public.program_group_versions v
  where v.group_id = p_group_id
  order by v.version desc
  limit 1;

  -- An unchanged programme writes no version. A coach who opens the picker and
  -- chooses the same template again would otherwise mint version 4 identical to
  -- version 3, and every member reading as "behind" until it was re-fanned to
  -- them — a screenful of people needing an action that would change nothing.
  --
  -- `is not distinct from` rather than `=`: jsonb `=` null is null, so a group
  -- whose first programme this is would fall through the comparison and be
  -- silently skipped.
  if last_program is not distinct from p_program then
    select * into out_row
    from public.program_group_versions v
    where v.group_id = p_group_id
    order by v.version desc
    limit 1;
    return out_row;
  end if;

  select coalesce(max(v.version), 0) + 1 into n
  from public.program_group_versions v
  where v.group_id = p_group_id;

  insert into public.program_group_versions (group_id, version, program)
  values (p_group_id, n, p_program)
  returning * into out_row;

  -- The group's live programme and its newest version are one fact, so they are
  -- written together. Doing it here rather than in a second round trip from the
  -- app is what stops a version existing that the group is not on — which would
  -- make every member read as behind a version nobody was ever sent.
  update public.program_groups g
     set program = p_program, updated_at = now()
   where g.id = p_group_id and g.coach_id = uid;

  return out_row;
end $$;

revoke all on function public.snapshot_group_program(uuid, jsonb) from public, anon;
grant execute on function public.snapshot_group_program(uuid, jsonb) to authenticated;

-- ── Backfilling the version a group is already on ─────────────────────────
--
-- Every group that already has a programme becomes version 1 of itself, so the
-- screens have something to compare against from the moment this runs rather
-- than reporting every member of every existing group as bespoke until the
-- coach next edits the plan.
--
-- Guarded on there being no version yet, so re-running this file cannot mint a
-- second version 1 — which the unique constraint would refuse anyway, but a
-- migration that ERRORS on its second run is a migration nobody dares re-run.
insert into public.program_group_versions (group_id, version, program)
select g.id, 1, g.program
from public.program_groups g
where g.program is not null
  and not exists (select 1 from public.program_group_versions v where v.group_id = g.id);
