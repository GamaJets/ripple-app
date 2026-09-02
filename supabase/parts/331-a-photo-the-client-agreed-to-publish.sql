-- ─────────────────────────────────────────────────────────────────────────
-- "My coach may look at this" and "my coach may post this" are two different
-- sentences, and this is the second one.
--
-- ── The distinction, which is the whole part ─────────────────────────────
--
-- Part 47 gives a client one act: send ONE photo to ONE coach. It is per photo,
-- revocable, visible, and it dies with the coaching relationship. It says what
-- it says — that this coach may OPEN this picture — and nothing more.
--
-- A coach may not put a client's progress photo on a public card because they
-- can see it. A progress photo is typically taken in underwear, alone, in a
-- bathroom (part 45's words). Being allowed to look at one in a coaching
-- context is not being allowed to post it to Instagram under a business name,
-- and no amount of the first adds up to the second.
--
-- So publication is its OWN grant, written by the client, addressed to the same
-- coach, about the same one photo. `src/lib/shareAsset.ts` will not put an image
-- on a card without one, and `src/ui/photoPublish.ts` builds the coach's picker
-- FROM this table rather than from the photos they can see — so there is no
-- code path from "visible to the coach" to "on a public card". That is the
-- distinction made structurally rather than remembered.
--
-- ── Why it is a child of the share grant ─────────────────────────────────
--
-- The primary key of `progress_photo_shares` is (photo_id, coach_id), and that
-- pair is this table's FOREIGN KEY. Three things fall out of it and each was
-- otherwise a rule somebody would have had to keep:
--
--   1. You cannot agree to publication of a photo you have not sent. The row
--      cannot exist without its parent.
--   2. TAKING THE PHOTO BACK TAKES THE PERMISSION BACK. Part 47's revocation
--      is a DELETE of the share row; this cascades with it, in the same
--      statement, with nothing to remember. A client who withdraws a photo has
--      withdrawn everything they said about it.
--   3. The two unlink triggers in part 47 already delete share rows when the
--      coaching link ends or the client's trainer changes. Those deletes
--      cascade here too, so publication permission ends with the relationship
--      by the mechanism that was already there rather than by a second copy of
--      it that could drift.
--
-- And, as with part 47: re-sending the same photo to the same coach later does
-- NOT bring this back. A new share row is a new parent with no children.
--
-- ── What this grant does NOT do ──────────────────────────────────────────
--
-- It grants no access to anything. The coach could already open the file (part
-- 47, both layers). There is no storage policy in this part and there must not
-- be one: this table is a record of PERMISSION, and adding a file grant to it
-- would blur the exact line it exists to draw.
--
-- It is also not a setting, a preference or a default, for part 47's reasons.
-- One row is one photo, one coach, one use.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 0 · Assertions
-- ═════════════════════════════════════════════════════════════════════════
--
-- The parent table and its primary key have to exist before the foreign key
-- below can be declared, and `coaching_link_active()` has to exist before the
-- policies can call it. All three come from part 47, which sorts first — this
-- says so out loud rather than failing on a missing relation halfway through.
do $$
begin
  if to_regclass('public.progress_photo_shares') is null then
    raise exception 'public.progress_photo_shares is missing — part 47 must be applied before part 331.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'coaching_link_active'
  ) then
    raise exception 'public.coaching_link_active() is missing — part 47 must be applied before part 331.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The table
-- ═════════════════════════════════════════════════════════════════════════
--
-- `client_id` is carried rather than joined for. It is what `ppg_client` is
-- keyed on, and a policy that had to reach through `progress_photo_shares` to
-- find out whose grant this is would be a policy whose USING clause depends on
-- another table's RLS.
--
-- No `revoked_at`, no soft delete: a permission that has been taken back is
-- DELETED, exactly as part 47 argues. A retained row saying "they used to
-- agree" is a record nobody asked for about a decision somebody reversed.
create table if not exists public.progress_photo_publish_grants (
  photo_id   uuid        not null,
  coach_id   uuid        not null,
  client_id  uuid        not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (photo_id, coach_id),
  constraint ppg_needs_a_share
    foreign key (photo_id, coach_id)
    references public.progress_photo_shares (photo_id, coach_id) on delete cascade
);

comment on table public.progress_photo_publish_grants is
  'One client, one photo, one coach: permission to use that photo in something the coach publishes. '
  'A child of progress_photo_shares, so withdrawing the photo withdraws this. Grants no access — see part 331.';

-- The client's "what did I agree could be posted" read, and the coach's "which
-- of this client''s photos may I use" read.
create index if not exists idx_ppg_client on public.progress_photo_publish_grants (client_id, granted_at desc);
create index if not exists idx_ppg_coach  on public.progress_photo_publish_grants (coach_id, client_id, granted_at desc);

-- RLS on BEFORE any policy exists, so the halfway state is closed rather than
-- open. Part 47's own ordering, for its own reason.
alter table public.progress_photo_publish_grants enable row level security;

-- Supabase's default privileges hand new public tables to anon as well as
-- authenticated. anon has no auth.uid(), so every policy below is false for it
-- anyway; removing the grant means that is true for two reasons (part 120).
revoke all on public.progress_photo_publish_grants from anon;
grant select, insert, delete on public.progress_photo_publish_grants to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Policies
-- ═════════════════════════════════════════════════════════════════════════
--
-- The client owns their permissions: list, give, take back. No UPDATE is
-- granted at all — there is nothing about a permission to amend, and an
-- updatable one is a permission whose subject could be moved.
--
-- The WITH CHECK carries the same four clauses as `pps_client` in part 47, and
-- for the same four reasons: you cannot file a permission as somebody else, you
-- cannot hand out another member's photo, you cannot address a stranger, and
-- you cannot grant to yourself. The `exists` on `progress_photos` is evaluated
-- under that table's own RLS, so it passes only for a row the caller already
-- owns.
drop policy if exists ppg_client on public.progress_photo_publish_grants;
create policy ppg_client on public.progress_photo_publish_grants for all to authenticated
  using (client_id = (select auth.uid()))
  with check (
    client_id = (select auth.uid())
    and coach_id <> (select auth.uid())
    and exists (
      select 1 from public.progress_photos p
       where p.id = progress_photo_publish_grants.photo_id
         and p.client_id = (select auth.uid())
    )
    and public.coaching_link_active(progress_photo_publish_grants.client_id,
                                    progress_photo_publish_grants.coach_id)
  );

-- The coach may read permissions addressed to them, and only while they are
-- still the coach. SELECT only, and that is the load-bearing half of this
-- table: a coach can neither create a permission nor delete one, so there is no
-- way for the person who benefits from it to write it, and no way for them to
-- clear the record that they were given it.
--
-- `coaching_link_active()` is re-checked on every read, so a coach who was let
-- go reads nothing here from the instant either link is broken — even in the
-- window before the part 47 triggers have removed the rows.
drop policy if exists ppg_coach_read on public.progress_photo_publish_grants;
create policy ppg_coach_read on public.progress_photo_publish_grants for select to authenticated
  using (
    coach_id = (select auth.uid())
    and public.coaching_link_active(progress_photo_publish_grants.client_id,
                                    progress_photo_publish_grants.coach_id)
  );

-- ── DELIBERATELY ABSENT ──────────────────────────────────────────────────
-- Any policy at all on storage.objects, and any coach-side write. Dropped
-- rather than merely not created, so applying this part removes either if a
-- later hand adds one.
drop policy if exists ppg_coach_write on public.progress_photo_publish_grants;
drop policy if exists ppg_obj_read on storage.objects;
