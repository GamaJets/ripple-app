-- ─────────────────────────────────────────────────────────────────────────
-- Sending a progress photo to your coach — the consent model.
--
-- 45-progress-photos.sql closed coach access at BOTH layers and wrote down
-- why: a progress photo is typically taken in underwear, alone, in a bathroom,
-- and a coach seeing one without the client choosing it is a different act from
-- a coach seeing a body-fat percentage. It ended with the shape this file has
-- to fill in:
--
--     "When per-photo sharing ships, it wants … a SELECT policy gated on it,
--      AND a matching storage.objects policy — the row and the file have to be
--      granted separately, which is the whole shape of this file."
--
-- This is that file. Nothing here widens the default: with no rows in
-- `progress_photo_shares`, both policies below are false for every coach and
-- every photo, and `progress_photos_owner` remains the only access that exists.
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
--
-- It is NOT a `shared_with_coach boolean` on `progress_photos`, which is what
-- part 45 sketched. A boolean says "my coach may see this", and "my coach" is
-- whoever holds that job today. Change coach and every photo you ever sent the
-- last one is handed to the new one, silently, because the column never named
-- anybody. Consent was given to a PERSON, so the grant records that person.
--
-- It is NOT a setting, a preference, or anything you can turn on. There is no
-- row shape here that means "all of them" or "from now on". One row is one
-- photo sent to one coach. Sharing today's photo cannot share tomorrow's,
-- because tomorrow's photo does not have a row and nothing will write one for
-- it. That is requirement 1 enforced by the data model rather than by care.
--
-- ── THE FOUR PROPERTIES, AND WHERE EACH ONE LIVES ────────────────────────
--
-- 1 · PER PHOTO.       primary key (photo_id, coach_id). See above.
-- 2 · REVOCABLE.       Unsharing DELETES the grant row. Both policies read the
--                      grant, so the row and the file go dark together, at the
--                      same instant, from one delete. (The one honest caveat:
--                      a signed URL already minted stays valid until it
--                      expires. src/lib/photoShare.ts mints coach URLs with a
--                      five-minute TTL for exactly this reason, and the app
--                      says so rather than claiming instant erasure.)
-- 3 · VISIBLE.         The client reads their own grants (policy `pps_client`)
--                      and the Progress screen labels every photo with what it
--                      finds. A grant that exists is a photo the coach can
--                      open; there is no third state.
-- 4 · ENDS WITH THE    Two mechanisms, deliberately:
--     RELATIONSHIP.      (a) every grant is re-checked against a LIVE coaching
--                            link on every read — `coaching_link_active()`;
--                        (b) triggers DELETE the grants outright when the link
--                            is ended or the client's trainer changes.
--                      (a) alone would be enough for access. (b) exists so the
--                      client's list in requirement 3 stops listing grants that
--                      no longer grant anything. Re-hiring the same coach does
--                      NOT bring the old grants back: the rows are gone, and
--                      the client sends again if they still want to.
--
-- ── WHY "ACTIVE LINK" MEANS BOTH LINKS, NOT EITHER ───────────────────────
--
-- This project records a coach↔client link in TWO places. 06-account-
-- provisioning.sql's `link_coaching()` writes both in one statement:
--
--     insert into coaching_relationships … status = 'active';
--     update clients set trainer_id = p_coach where id = p_client;
--
-- and nothing in the repo un-links today — grep finds no writer of
-- status='ended' and none of `trainer_id = null`. So the shape of the future
-- unlink is unknown, and it may well write only one of the two.
--
-- `coaching_link_active()` therefore requires BOTH, with AND. Ending the
-- relationship by EITHER mechanism ends photo access. The failure mode of AND
-- is that a half-linked pair cannot share — visible immediately, and the app
-- says "no coach linked" rather than lying. The failure mode of OR is that a
-- coach who was let go keeps seeing the photos. For this feature those are not
-- comparable, so this fails closed.
--
-- ── SECURITY DEFINER, AND THE BUG THAT IS NOT IN HERE ────────────────────
--
-- Four functions below are `security definer`. NONE of them tests
-- `current_user`. Inside a definer function `current_user` is the function's
-- OWNER, so a `current_user` guard never fires and reads as protection while
-- providing none — that exact bug shipped in this project today.
--
-- What they use instead is `auth.uid()`, which is a different thing entirely:
-- it reads the request's JWT claim out of a GUC, so it is the CALLER either
-- way and is unaffected by SECURITY DEFINER. That is the only reason the
-- predicates below can be definer at all.
--
-- The two trigger functions test no identity of any kind. They decide purely
-- from OLD and NEW — "this link stopped being active", "this client's trainer
-- changed" — which is a fact about the row, not a claim about who is speaking.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 0 · Assertions — a policy on a table with RLS off is inert
-- ═════════════════════════════════════════════════════════════════════════
--
-- Asserted rather than assumed, the same way 45 does. If any of these were
-- false, everything below would LOOK like a restriction and be none.

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — photos_obj_read_shared would be inert.';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'progress_photos' and c.relrowsecurity
  ) then
    raise exception 'public.progress_photos does not have RLS enabled — progress_photos_shared_read would be inert.';
  end if;

  -- progress_photos must NOT force RLS on its owner. The object-level
  -- predicate below resolves a storage object name back to its photo row as
  -- the table owner; under FORCE ROW LEVEL SECURITY that lookup would return
  -- nothing and a coach would get a row they can read with a file they cannot
  -- — a broken image, which is exactly the split this file exists to prevent.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'progress_photos' and c.relforcerowsecurity
  ) then
    raise exception 'public.progress_photos has FORCE ROW LEVEL SECURITY — progress_photo_object_shared_with_viewer() cannot resolve a path and shared files would 403 while shared rows read fine.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The grant
-- ═════════════════════════════════════════════════════════════════════════
--
-- One row = one photo, sent to one coach, by its owner. There is no revoked_at
-- and no soft delete: a grant that has been taken back is DELETED. A retained
-- row filtered by `revoked_at is null` would put that predicate in every policy
-- and every query on this table, and this feature is one forgotten predicate
-- away from showing somebody's body to a person they took it back from. The
-- audit trail is not worth that; `shared_at` on the live row is.
--
-- client_id is denormalised from progress_photos.client_id so the policies and
-- the predicates never have to join back to a table whose own RLS is the thing
-- being decided. It is kept honest by the WITH CHECK on `pps_client`, which
-- refuses any insert whose photo is not actually the caller's.

create table if not exists public.progress_photo_shares (
  photo_id  uuid        not null references public.progress_photos(id) on delete cascade,
  coach_id  uuid        not null references public.profiles(id)        on delete cascade,
  client_id uuid        not null references public.profiles(id)        on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (photo_id, coach_id)
);

-- The client's "what can my coach see" read, and the coach's "what did this
-- client send me" read.
create index if not exists idx_pps_client on public.progress_photo_shares (client_id, shared_at desc);
create index if not exists idx_pps_coach  on public.progress_photo_shares (coach_id, client_id, shared_at desc);

-- The object-level predicate resolves storage.objects.name back to a photo
-- row. Without this that is a sequential scan of progress_photos for every
-- object the storage policy is asked about.
create index if not exists idx_progress_photos_image_path on public.progress_photos (image_path);

-- RLS on BEFORE any policy exists. Between this statement and the two policies
-- below the table is closed to everyone, which is the safe direction to be
-- caught halfway through.
alter table public.progress_photo_shares enable row level security;

-- Supabase's default privileges hand new public tables to anon as well as
-- authenticated. anon has no auth.uid() so every policy below is false for it
-- anyway; taking the grant away too means that is true for two reasons.
revoke all on public.progress_photo_shares from anon;
grant select, insert, delete on public.progress_photo_shares to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Is the coaching relationship live?
-- ═════════════════════════════════════════════════════════════════════════
--
-- The single definition of requirement 4, used by every policy in this file so
-- that "the coach was let go" cannot mean one thing to the row and another to
-- the file. BOTH links required — see the header.
--
-- Definer because it must answer for a (client, coach) pair from whichever of
-- the two sides is asking, and `clients` and `coaching_relationships` each
-- expose only one side to each party. The `auth.uid() in (…)` line is what
-- stops that becoming an oracle: this answers only about a relationship the
-- caller is themselves part of. That test is on auth.uid(), NOT current_user,
-- which inside a definer function would be the owner and would always fail.

create or replace function public.coaching_link_active(p_client uuid, p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (select auth.uid()) in (p_client, p_coach)
    and exists (
      select 1 from public.coaching_relationships r
       where r.client_id = p_client and r.coach_id = p_coach and r.status = 'active'
    )
    and exists (
      select 1 from public.clients c
       where c.id = p_client and c.trainer_id = p_coach
    );
$$;

revoke execute on function public.coaching_link_active(uuid, uuid) from public, anon;
grant execute on function public.coaching_link_active(uuid, uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The two predicates — one rule, expressed once
-- ═════════════════════════════════════════════════════════════════════════
--
-- Requirement 5 says the row and the file grant separately, and that opening
-- one without the other gives either a broken image or a file with no record
-- of it. They are separate GRANTS below — two policies on two tables in two
-- schemas — but they must never be able to disagree about WHO. So the file
-- predicate is defined in terms of the row predicate: an object is readable
-- if and only if the photo row that names it is readable. Not "the same
-- condition, written twice"; literally the same function, called.

-- Row-level: is this photo one the signed-in viewer was sent, by a client
-- whose coach they still are?
--
-- Reads the grant table directly as the owner rather than through
-- `pps_coach_read`. That is deliberate: it keeps the progress_photos policy
-- from depending on the progress_photo_shares policy, which is how RLS
-- recursion starts. Nothing here reads progress_photos, so nothing here can
-- re-enter the policy that calls it.
create or replace function public.progress_photo_shared_with_viewer(p_photo_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.progress_photo_shares s
     where s.photo_id = p_photo_id
       and s.coach_id = (select auth.uid())
       and public.coaching_link_active(s.client_id, s.coach_id)
  );
$$;

revoke execute on function public.progress_photo_shared_with_viewer(uuid) from public, anon;
grant execute on function public.progress_photo_shared_with_viewer(uuid) to authenticated;


-- Object-level: same question, asked with the storage key instead of the id,
-- because a policy on storage.objects has the name and nothing else.
create or replace function public.progress_photo_object_shared_with_viewer(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.progress_photos p
     where p.image_path = p_name
       and public.progress_photo_shared_with_viewer(p.id)
  );
$$;

revoke execute on function public.progress_photo_object_shared_with_viewer(text) from public, anon;
grant execute on function public.progress_photo_object_shared_with_viewer(text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Policies on the grant table
-- ═════════════════════════════════════════════════════════════════════════

-- The client owns their grants: they can list them, create them and take them
-- back. No UPDATE is granted at all — there is nothing about a grant to amend,
-- and an updatable grant is a grant whose subject could be moved.
--
-- The WITH CHECK is where the honesty of this table is enforced:
--   · client_id is the caller             — you cannot file a grant as someone else
--   · the photo is the caller's own       — you cannot hand out another member's photo
--   · the coach link is live              — you cannot send to a stranger
--   · coach_id is not the caller          — a self-grant is meaningless, and would
--                                           make your own row satisfy the coach policy
--
-- The `exists` on progress_photos is evaluated under that table's own RLS, so
-- it passes only for a row `progress_photos_owner` already lets the caller see.
-- Two independent reasons for the same answer.
drop policy if exists pps_client on public.progress_photo_shares;
create policy pps_client on public.progress_photo_shares for all to authenticated
  using (client_id = (select auth.uid()))
  with check (
    client_id = (select auth.uid())
    and coach_id <> (select auth.uid())
    and exists (
      select 1 from public.progress_photos p
       where p.id = progress_photo_shares.photo_id
         and p.client_id = (select auth.uid())
    )
    and public.coaching_link_active(progress_photo_shares.client_id, progress_photo_shares.coach_id)
  );

-- The coach may read grants addressed to them, and only while they are still
-- the coach. SELECT only: a coach can neither create a grant nor delete one.
-- Taking it back is the client's act alone, so there is no way for a coach to
-- clear the record that they were given access.
drop policy if exists pps_coach_read on public.progress_photo_shares;
create policy pps_coach_read on public.progress_photo_shares for select to authenticated
  using (
    coach_id = (select auth.uid())
    and public.coaching_link_active(progress_photo_shares.client_id, progress_photo_shares.coach_id)
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · LAYER ONE — the row
-- ═════════════════════════════════════════════════════════════════════════
--
-- Added ALONGSIDE `progress_photos_owner`, which is untouched. Permissive
-- policies OR together, so the owner still reaches every one of their rows by
-- the rule 45 wrote, and a coach reaches exactly the rows they were sent.
--
-- FOR SELECT and nothing else. A coach cannot edit or delete a photo they were
-- shown; the sender remains the only person who can change or remove it.
--
-- This does grant the whole row, weight_kg and body_fat_pct included. Those two
-- numbers are already visible to a linked coach through `scans_trainer_read`
-- (19-trainer-read-access.sql), so nothing new is disclosed — but RLS grants
-- rows, not columns, and it is worth having said so out loud.
drop policy if exists progress_photos_shared_read on public.progress_photos;
create policy progress_photos_shared_read on public.progress_photos for select to authenticated
  using (public.progress_photo_shared_with_viewer(progress_photos.id));

-- Still dropped, still on purpose. 45 removed the blanket
-- `progress_photos_trainer_read`; the point of this file is that a coach reads
-- photos because one was SENT, never because of who they are. Re-stated here
-- so that applying 47 cannot be read as the moment it came back.
drop policy if exists progress_photos_trainer_read on public.progress_photos;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · LAYER TWO — the file
-- ═════════════════════════════════════════════════════════════════════════
--
-- Without this, a coach gets a row carrying `image_path` and a 403 on the
-- bytes: a name for a photo they cannot see, which is worse than either
-- answer. Without §5 and with only this, a coach could fetch bytes with no row
-- to say whose they are or that they were ever given.
--
-- A SEPARATE policy rather than an edit to `photos_obj_read`: 45 owns that one,
-- own-folder access is a different rule with a different reason, and permissive
-- SELECT policies OR. Nobody loses their own folder if this is ever dropped,
-- and dropping this is a complete, single-statement retreat.
--
-- The `bucket_id` test comes first so the predicate is not called for objects
-- in `exercise-videos` or `scans`.
drop policy if exists photos_obj_read_shared on storage.objects;
create policy photos_obj_read_shared on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and public.progress_photo_object_shared_with_viewer(name)
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 7 · Ending the relationship ends the grants
-- ═════════════════════════════════════════════════════════════════════════
--
-- `coaching_link_active()` already means a former coach reads nothing, from
-- the instant either link stops. These triggers are the second half: they
-- remove the grant ROWS, so the client's "what can my coach see" list is not
-- carrying entries that no longer mean anything. Requirement 3 says no ambient
-- uncertainty, and a list of grants you have to know are dead is exactly that.
--
-- Definer, because the person ending the relationship is often the COACH, and
-- a coach has no right to delete rows the client owns — `pps_client` is keyed
-- on the client. The function tests NOTHING about who is calling: it reads OLD
-- and NEW and nothing else. There is no `current_user` in here, and there must
-- never be one — see the header.
--
-- Deliberately NOT granted to authenticated. It is reachable only as a trigger;
-- a direct call would fail on TG_OP anyway, and least privilege beats symmetry
-- with the house rule for a function nobody is meant to call.

create or replace function public.revoke_photo_shares_on_unlink()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_TABLE_NAME = 'clients' then
    -- The client's trainer changed. Every outstanding grant was addressed to
    -- the coach they had; none of them survives the change, and the incoming
    -- coach starts with nothing. Photos are not part of the handover.
    delete from public.progress_photo_shares where client_id = OLD.id;

  elsif TG_OP = 'DELETE' then
    delete from public.progress_photo_shares
     where client_id = OLD.client_id and coach_id = OLD.coach_id;

  elsif NEW.status <> 'active' then
    -- 'ended', and also 'pending' — a relationship put back to pending is not
    -- one that should still be showing somebody's body.
    delete from public.progress_photo_shares
     where client_id = NEW.client_id and coach_id = NEW.coach_id;
  end if;
  return null;
end $$;

revoke execute on function public.revoke_photo_shares_on_unlink() from public, anon, authenticated;

drop trigger if exists on_coaching_unlink_revoke_photo_shares on public.coaching_relationships;
create trigger on_coaching_unlink_revoke_photo_shares
  after update or delete on public.coaching_relationships
  for each row execute function public.revoke_photo_shares_on_unlink();

drop trigger if exists on_trainer_change_revoke_photo_shares on public.clients;
create trigger on_trainer_change_revoke_photo_shares
  after update of trainer_id on public.clients
  for each row when (NEW.trainer_id is distinct from OLD.trainer_id)
  execute function public.revoke_photo_shares_on_unlink();


-- ═════════════════════════════════════════════════════════════════════════
-- 8 · The purge queue still owns deletion
-- ═════════════════════════════════════════════════════════════════════════
--
-- Nothing above touches it, and that is checked rather than assumed.
--
-- `progress_photo_shares.photo_id … on delete cascade` means deleting a SHARED
-- photo deletes its grants as part of the same statement. The order is the
-- thing that matters: referential-integrity cascades run as the statement
-- proceeds, and `on_progress_photo_delete` is an AFTER DELETE row trigger on
-- progress_photos, so it fires for the photo row regardless of what the cascade
-- did to the child. The path still reaches `photo_purge`, and the file is still
-- purged — for a single delete and for the account-deletion cascade alike.
--
-- The share row is a GRANT, not a record of bytes, so unlike photo_purge it is
-- right for it to die with the photo, the client and the coach. It carries no
-- storage path and there is nothing about it that has to outlive anything.
--
-- The assertion below is the same class as §0: it fails loudly at apply time if
-- a future edit ever removes the trigger this feature quietly depends on.

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.progress_photos'::regclass
      and tgname = 'on_progress_photo_delete'
      and not tgisinternal
  ) then
    raise exception 'on_progress_photo_delete is missing from progress_photos — deleting a photo would leave its file in storage with nothing holding the path (see 45-progress-photos.sql).';
  end if;
end $$;
