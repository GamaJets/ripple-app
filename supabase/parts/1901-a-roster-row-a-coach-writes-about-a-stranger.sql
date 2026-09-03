-- ═══════════════════════════════════════════════════════════════════════════
-- A roster row a coach writes about a stranger, and the profile it opens.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- `coach_clients` carries two different kinds of row and always has:
--
--   · a name a coach TYPED IN — somebody with no Repple account at all. The
--     table's `id` is `uuid default gen_random_uuid()` precisely so these rows
--     get an id the phone never had to invent. `src/ui/roster.tsx:450` inserts
--     one with no `id` at all.
--
--   · a REAL client, linked by `link_coaching()`, whose `id` is that person's
--     `auth.users` id. `studio-web/app/coach/page.tsx:823` upserts this half
--     after the RPC has run.
--
-- Because of the first kind, `coach_clients.id` has no foreign key and no
-- trigger, and both write policies constrain only the other column:
--
--     cc_own                    with check (trainer_id = auth.uid())
--     coach_clients_trainer_rw  for all using (trainer_id = auth.uid())
--
-- Nothing on the write side asks whether the person named by `id` has anything
-- to do with the coach doing the writing. And on the read side:
--
--     profiles_trainer_r_clients
--       my_role() = 'trainer'
--       and exists (select 1 from coach_clients
--                    where trainer_id = auth.uid() and id = profiles.id)
--
-- So the row that authorises reading a stranger's profile is a row the reader
-- issues to themselves. This is the plainest shape of broken access control
-- there is: a permission check against a fact the caller controls.
--
-- ── WHAT SOMEBODY COULD ACTUALLY DO ──────────────────────────────────────
--
-- Anybody signed in with `profiles.role = 'trainer'` — which is every coach on
-- the platform, at every gym, and anybody who signs up on the coach app — can
-- run two ordinary PostgREST calls with no special tooling:
--
--     POST /rest/v1/coach_clients   { "id": "<victim uuid>",
--                                     "trainer_id": "<self>",
--                                     "name": "x" }
--     GET  /rest/v1/profiles?id=eq.<victim uuid>
--
-- and read that person's `full_name`, `avatar`, `role`, `tenant_id` and
-- `deletion_requested_at`. The victim can be a member, a receptionist, an owner
-- or a coach at ANY gym on the platform. `tenant_id` is the part that matters
-- most for a white-label product: it says which gym a named person belongs to,
-- to a reader at a competing gym who is supposed to be unable to see that the
-- person exists.
--
-- Two things bound it, and neither is a control anybody designed:
--
--   · The attacker must already hold the victim's uuid. Uuids are not
--     guessable, but they are not secret either — `trainers_public_directory_r`
--     hands out every listed coach's id to any signed-in user, and ids travel
--     through class rosters, invite links and shared reports.
--
--   · `coach_clients_pkey` is `primary key (id)`, so a victim who already has a
--     roster row cannot be claimed: the insert collides, and the upsert branch
--     fails `cc_own`'s using clause because the existing row belongs to their
--     real coach. Everybody without a roster row is exposed, which today is 18
--     of the 20 profiles in this database.
--
-- What it does NOT reach, checked one by one: `clients` (the health record) is
-- gated on `clients.trainer_id`, which only definer functions set; `messages`,
-- `my_coach()` and `can_use_message_thread()` all read `clients` too, so the
-- forged row grants no thread and no impersonation; `progress_photos` needs an
-- explicit share plus `coaching_link_active()`. The disclosure is the profile
-- row and it stops there.
--
-- ── LIVE OR LATENT ───────────────────────────────────────────────────────
--
-- LIVE. Not a shape that becomes reachable after some future state change —
-- reachable right now by any account with the coach role, against 18 of the 20
-- profiles that exist. Established by reading the two write policies, the read
-- policy, `pg_constraint` on `coach_clients` (one pkey, one FK on `trainer_id`,
-- none on `id`) and `pg_trigger` (no triggers on the table at all). It was NOT
-- established by performing the insert: this lane's database access is read
-- only and no forged row was written.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- The write is where the defect is, so that is where the check goes. A roster
-- row naming a person who HAS a Repple account must be corroborated by a
-- relationship the coach did not invent. `coach_roster_row_is_earned()` says
-- when that holds, and it admits exactly the three cases the product creates:
--
--   1. No `profiles` row for that id — a name the coach typed in. This is the
--      common case and the reason the column is unconstrained; such a row
--      discloses nothing, because there is no profile behind it to read.
--
--   2. A `clients` row already pointing at this coach — what `link_coaching()`
--      writes one statement before the roster upsert.
--
--   3. A `coach_requests` row from that client to this coach — the same
--      condition `link_coaching()` itself accepts, and the same one
--      `profiles_requesting_client_r` already trusts for a profile read. It is
--      here so that accepting a directory request cannot fail on ordering.
--
-- The helper is SECURITY DEFINER, like `is_my_client()` and `is_owner_of()`
-- beside it, for the ordinary reason: `profiles` has a policy that selects from
-- `coach_clients`, so a `coach_clients` policy that selected from `profiles`
-- under RLS would recurse (42P17) — the failure part 28 is named after.
--
-- `coach_clients_trainer_rw` is dropped rather than amended. It is a
-- character-for-character duplicate of `cc_own` — same command, same roles,
-- same predicate written in the other order — and two permissive FOR ALL
-- policies are OR'd, so tightening one while the other stands would change
-- nothing at all. Dropping it also retires 24 `multiple_permissive_policies`
-- advisories on this table.
--
-- `profiles_trainer_r_clients` is then narrowed as well, and this half is belt
-- and braces rather than the fix: with the write closed the roster row can no
-- longer be forged, but a read policy whose whole basis is a row the reader can
-- write should not be the only thing standing there. It gains `is_my_client()`,
-- which is the corroboration `profiles_trainer_read` beside it already makes
-- inline. `is_my_client()` is SECURITY INVOKER, so the `clients` read inside it
-- is subject to `clients_trainer_read` — which is `trainer_id = auth.uid()`, the
-- same condition, so the answer is unchanged — and it cannot recurse, because no
-- `clients` policy reads `profiles`.
-- Verified against the live catalogue on 4 Sep 2026: of the 2 roster rows that
-- have a profile behind them, 0 lack a matching `clients` row, so this removes
-- no read that anybody has today.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · It does not add a foreign key from `coach_clients.id` to `profiles.id`.
--     That would delete the hand-typed client, which is a first-class product
--     feature with six screens behind it.
--
--   · It does not touch the USING clause of `cc_own`. A coach keeps full read,
--     update and delete of every row already on their roster, including any row
--     that predates this part and would not pass the new check — an old row is
--     not made unreadable or undeletable by a rule about new ones.
--
--   · It does not change `link_coaching()`, which is SECURITY DEFINER and
--     therefore never saw these policies in the first place. Every legitimate
--     link continues to be written by it, unaffected.
--
--   · It does not narrow `profiles_requesting_client_r`. A pending request is a
--     deliberate, client-initiated disclosure and is out of scope here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The helper ───────────────────────────────────────────────────────────

create or replace function public.coach_roster_row_is_earned(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_client is not null
     and (
       -- A name the coach typed in: nobody's account, nothing to disclose.
       not exists (select 1 from public.profiles p where p.id = p_client)
       -- The link `link_coaching()` writes, one statement earlier.
       or exists (select 1 from public.clients c
                   where c.id = p_client
                     and c.trainer_id = (select auth.uid()))
       -- A request that client sent this coach. `link_coaching()` accepts this
       -- and `profiles_requesting_client_r` already trusts it for a read.
       or exists (select 1 from public.coach_requests r
                   where r.client_id = p_client
                     and r.trainer_id = (select auth.uid()))
     );
$$;

grant execute on function public.coach_roster_row_is_earned(uuid) to authenticated;

-- ── The write side ───────────────────────────────────────────────────────
--
-- The duplicate goes first: while it stands, tightening `cc_own` accomplishes
-- nothing, because permissive policies are OR'd.

drop policy if exists coach_clients_trainer_rw on public.coach_clients;

drop policy if exists cc_own on public.coach_clients;
create policy cc_own on public.coach_clients
  for all
  using (trainer_id = (select auth.uid()))
  with check (
    trainer_id = (select auth.uid())
    and public.coach_roster_row_is_earned(id)
  );

-- ── The read side ────────────────────────────────────────────────────────
--
-- Same name, same command, same roles. It keeps its roster-row test and gains
-- the corroboration, so it is now a statement about a relationship rather than
-- about a row the reader wrote.

drop policy if exists profiles_trainer_r_clients on public.profiles;
create policy profiles_trainer_r_clients on public.profiles
  for select
  using (
    public.my_role() = 'trainer'
    and exists (select 1 from public.coach_clients cc
                 where cc.trainer_id = (select auth.uid())
                   and cc.id = profiles.id)
    and public.is_my_client(profiles.id)
  );
