-- ── The private notes a coach keeps on a client ────────────────────────────
--
-- The sheet in app/(trainer)/dashboard.tsx is headed "Private Notes (only
-- You)", and until this part both halves of that title were false.
--
-- It was not private, because there was nothing to be private FROM: the whole
-- feature was eighteen lines of `useState` in src/ui/coachNotes.tsx keyed by
-- client id, so a note never left the phone's memory. And it was not a note,
-- because it did not survive the app being closed. A coach typed "shoulder
-- still bothering her, drop overhead press for a fortnight", tapped Save, saw
-- it appear under the client's name, and it was gone the next time they opened
-- the app — with no error, no warning, and a Save button that had behaved
-- exactly as if it had worked. The one thing a private note is for is being
-- read back later, which was the one thing it could not do.
--
-- ── Why the coach id is not simply trusted from the client ──────────────────
--
-- `coach_id` defaults to auth.uid() AND is checked against it by the policy
-- below. The default is a convenience; the WITH CHECK is the rule. Without the
-- check a coach could insert a row attributed to another coach — harmless on
-- its own, but this table is read by `coach_id`, so it is a way to put words
-- into another coach's private notes about their own client.
--
-- ── Why client_id is text, and has no foreign key ──────────────────────────
--
-- A row in the coach's roster is one of two different things (see
-- src/ui/roster.tsx): a `profiles` row, for a client with an account, or a
-- `coach_clients` row, for somebody the coach typed in by hand and who has
-- never signed in. Both are uuids, they live in different tables, and no single
-- foreign key can name both — so a FK here would have to pick one and reject
-- half the roster.
--
-- text rather than uuid for a second reason: `addClient` puts the new client on
-- screen under a temporary local id (`c1`, `c2`, …) for the round trip before
-- the insert returns the real one. A uuid column turns a note written in that
-- window into a 22P02 and loses it — which is the exact failure this part
-- exists to end, reintroduced by the type system. A note against a local id is
-- orphaned rather than lost, and orphaned is recoverable.
create table if not exists public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  client_id text not null,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now()
);

-- The read is always "this coach's notes", newest first. The client is a filter
-- applied in the app rather than in the query — a coach's whole note set is
-- small and is loaded once, the same shape `coach_feedback` uses.
create index if not exists coach_notes_coach_idx
  on public.coach_notes (coach_id, created_at desc);

alter table public.coach_notes enable row level security;

-- One policy, and it is the title of the sheet: only the coach who wrote the
-- note may see it, change it or delete it. Not the client it is about, not
-- another coach, and not the owner of a gym the coach works at — a private note
-- about a person is the coach's own record and nothing in the operating record
-- needs it.
--
-- `(select auth.uid())` rather than a bare call so Postgres evaluates it once
-- per statement instead of once per row, which is the form every recent policy
-- in this schema uses.
drop policy if exists coach_notes_own on public.coach_notes;
create policy coach_notes_own on public.coach_notes
  for all
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- RLS NARROWS a grant; it does not confer one. A policy with no matching grant
-- is inert — every statement is refused with 42501 before any policy is
-- consulted, and the table would have behaved exactly as if the policy were
-- `using (false)`.
--
-- The REVOKE is not decoration. This project carries Supabase's stock default
-- privileges, which grant every new table in `public` to `anon` as well as to
-- `authenticated` — so simply not naming `anon` in a GRANT does not keep it
-- out, and the table came into existence with anon holding
-- SELECT/INSERT/UPDATE/DELETE on it. Confirmed against the live database, not
-- assumed. The policy still refuses a signed-out caller (auth.uid() is null, so
-- no row matches and no insert satisfies the check), which is why this is depth
-- rather than the only line of defence — but a table of private notes should
-- not be relying on a single expression, and a future policy edit that widens
-- `using` would otherwise widen it to the whole internet.
revoke all on public.coach_notes from anon;
grant select, insert, update, delete on public.coach_notes to authenticated;

comment on table public.coach_notes is
  'A coach''s private notes about a client. Readable only by their author — the client never sees them, and neither does a gym owner.';
comment on column public.coach_notes.client_id is
  'Either a profiles.id (a client with an account) or a coach_clients.id (one the coach typed in). Text because no single FK can name both.';
