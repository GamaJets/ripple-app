-- ── A coach writes the bootcamp programme once ─────────────────────────────
--
-- A coach running a bootcamp of eight people was writing the same programme
-- eight times, because `assigned_programs` is keyed one row per client and the
-- builder assigns to exactly one of them. The library's bulk assign (the sheet
-- in app/(trainer)/templates.tsx) sends one template to a tick-list, which is
-- the same eight writes with fewer taps, and then forgets who was in the list —
-- so "who is on the bootcamp programme" is a question nothing could answer the
-- next morning.
--
-- ── What this stores, and the thing it deliberately does NOT store ─────────
--
-- A group owns the LIST. It does not own the PLAN any client is training.
--
-- The obvious alternative was a group that owns the programme, with clients
-- pointing at it — one row of content for eight people, no duplication, an
-- edit that reaches everybody at once. It was rejected, and the reason is the
-- read path rather than the write path:
--
--   · Everything downstream of a training programme is per-client and already
--     keyed that way — the client's Train tab, logged sets, adherence, the
--     progression maths, the injury acknowledgement of a specific movement for
--     a specific person. A group-owned programme would have to be reconciled
--     against those on every read, in the client app as well as the coach's,
--     and a reconciliation that runs on every read is a reconciliation that
--     will be wrong somewhere.
--
--   · Divergence is not the exception here, it is the job. A client turns up
--     with a shoulder on the Wednesday and gets a different row on the
--     Thursday. Under a group-owned plan that is an override table — a second
--     source of truth for the same question, and the moment there are two, the
--     client's Train tab has to pick one and every screen has to agree about
--     which.
--
--   · The client app is shipped. `assigned_programs` is what it reads. A group
--     that owned the plan would need the client app taught about groups to
--     show anybody anything, and this goes out over the air tonight.
--
-- So assignment stays a fan-out: one programme, written into each member's own
-- `assigned_programs` row, exactly as if the coach had typed it eight times.
-- Nothing downstream changes, one client's copy can be edited in the builder
-- without touching anybody else's, and "who has it" is answered by comparing
-- each member's actual row against the group's programme rather than by
-- bookkeeping that can drift away from the truth it describes.
--
-- The cost is honest and is worth naming: editing the group's programme does
-- NOT retroactively change what anybody is on. It changes what the next assign
-- sends, and the group screen then shows the members as being on something
-- different — which is a true statement about their training, and the coach
-- decides who gets the new version. A group-owned plan would have made that
-- silent, and silently rewriting the session somebody is doing this evening is
-- the failure the overwrite guard exists to prevent.
--
-- ── Why there is no RPC here ────────────────────────────────────────────────
--
-- A `assign_group_program(group_id)` function would have been one call instead
-- of eight, and it would have had to be SECURITY DEFINER to be worth writing.
-- Every one of the writes it would perform is already permitted to the coach
-- by the `assigned_programs` policies from part 69, which check
-- `is_my_client()` per row — so a definer function would buy a round trip and
-- take on the entire pinned-search_path / revoke-from-anon-as-well-as-public
-- burden that opened a real hole in part 105. It would also do the fan-out
-- server-side, where the per-client injury gate cannot be consulted. The gate
-- is a coach-facing refusal made against what the coach has read; it belongs
-- in front of the writes, not behind them.
--
-- ── Access ────────────────────────────────────────────────────────────────
--
-- The coach owns both tables and is the only party to either. A group is the
-- coach's own filing, not content addressed to a client: the client sees their
-- programme on their Train tab exactly as before and has nothing to gain from
-- learning they were in a list of eight. So there is no client-read policy
-- here, unlike `injury_acknowledgements` (part 79) where the client is
-- entitled to see that what they disclosed was read.
--
-- auth.uid(), never current_user: under PostgREST every signed-in request runs
-- as the shared `authenticated` role, so current_user is the same string for
-- every person on the platform and a policy built on it grants everything to
-- everyone.

create table if not exists public.program_groups (
  id         uuid        primary key default gen_random_uuid(),
  coach_id   uuid        not null references public.profiles(id) on delete cascade,
  name       text        not null,
  -- The programme AS THE GROUP DEFINES IT, and not as anybody is training it.
  -- Nullable: a coach names the group and picks its programme in either order,
  -- and a group with no programme yet is a real state the screen has to hold
  -- rather than a half-written row.
  --
  -- A snapshot rather than a reference to `program_templates`: a template the
  -- coach later edits must not silently redefine what a named group of people
  -- is understood to be doing.
  program    jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_program_groups_coach
  on public.program_groups(coach_id, created_at desc);

create table if not exists public.program_group_members (
  group_id  uuid        not null references public.program_groups(id) on delete cascade,
  client_id uuid        not null references public.profiles(id)       on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (group_id, client_id)
);
-- Answers "which groups is this person in", which is what the builder asks
-- before it lets a coach edit one member's copy.
create index if not exists idx_program_group_members_client
  on public.program_group_members(client_id);

alter table public.program_groups        enable row level security;
alter table public.program_group_members enable row level security;

drop policy if exists program_groups_coach_rw on public.program_groups;
create policy program_groups_coach_rw on public.program_groups
  for all
  to authenticated
  using      (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- ── Why the two clauses are not the same ──────────────────────────────────
--
-- USING is group ownership alone. WITH CHECK is group ownership AND
-- `is_my_client()`.
--
-- The asymmetry is deliberate and is the opposite way round from part 69. A
-- coach may only ADD somebody who is their client right now — a group is not a
-- place to accumulate the ids of people you do not coach. But a membership row
-- is the coach's own filing, so when a client leaves them the row must stay
-- READABLE and DELETABLE by the coach who wrote it. Had `is_my_client()` been
-- in the USING clause as well, ending the relationship would have made that
-- row invisible and undeletable — a name silently dropped from a group the
-- coach can still see, and a row nobody can ever tidy up.
drop policy if exists program_group_members_coach_rw on public.program_group_members;
create policy program_group_members_coach_rw on public.program_group_members
  for all
  to authenticated
  using (
    exists (select 1 from public.program_groups g
             where g.id = group_id and g.coach_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.program_groups g
             where g.id = group_id and g.coach_id = (select auth.uid()))
    and public.is_my_client(client_id)
  );

-- RLS narrows a GRANT; it does not confer access, and a GRANT nobody wrote is
-- not an absence of one. Supabase's stock default privileges hand `anon` the
-- full DML set on every table created in this schema (see part 119), so both
-- of these arrived reachable by the publishable key with only the policies
-- above standing between a stranger and the coach's filing. The policies do
-- hold — every one of them resolves through auth.uid(), which is null for
-- `anon` — but a privilege that is only ever refused is a privilege to remove.
revoke all on public.program_groups        from anon;
revoke all on public.program_group_members from anon;
grant select, insert, update, delete on public.program_groups        to authenticated;
grant select, insert, update, delete on public.program_group_members to authenticated;
