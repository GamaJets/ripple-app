-- ─────────────────────────────────────────────────────────────────────────
-- Make "delete my account" actually delete the account.
--
-- request_account_deletion() has existed since 02-domain-schema.sql and does
-- one thing:
--
--   update profiles set deletion_requested_at = now() where id = auth.uid();
--
-- Nothing anywhere reads that column. Grepped the whole repo: written in one
-- place, read in zero. So a member tapped the button, got a success response,
-- and their data stayed indefinitely with nobody even notified. That is worse
-- than not offering deletion at all — it is a promise the software does not
-- keep, and Google Play is about to require a public page describing it.
--
-- WHY A TRUE DELETE IS POSSIBLE HERE. profiles.id references auth.users(id) on
-- delete cascade, so removing the auth user removes the person's data by
-- construction rather than by a hand-maintained list of DELETE statements that
-- would drift the first time somebody adds a table.
--
-- HOW FAR IT REACHES. 118 tables in `public`, plus 11 inside Supabase's own
-- `auth` schema — 129 in all. Counted from the live catalogue, 14 September
-- 2026, by the query below. That is the transitive closure of `on delete
-- cascade` from `auth.users`: every table a row can be destroyed in by
-- deleting that one row, which is the figure the public deletion page and the
-- owner's confirmation dialog put in front of a member before an irreversible
-- act.
--
--   with recursive reach(oid) as (
--     select 'auth.users'::regclass::oid
--     union
--     select c.conrelid from pg_constraint c
--       join reach r on c.confrelid = r.oid
--      where c.contype = 'f' and c.confdeltype = 'c')
--   select n.nspname, count(*) from reach r
--     join pg_class t on t.oid = r.oid
--     join pg_namespace n on n.oid = t.relnamespace
--    where r.oid <> 'auth.users'::regclass::oid
--    group by n.nspname;        -- 14 Sep 2026: auth 11, public 118
--
-- FROM pg_constraint, NOT FROM setup.sql. The live catalogue is the only
-- source that can answer this. A parse of the bundle sees the `references …
-- on delete cascade` written at `create table` and cannot see the later
-- `alter table … drop constraint … add constraint … on delete set null`
-- that part 184 applies to three of them, so it over-counts: part 2370's header
-- records the file parse giving 125 against the live 118, for exactly this
-- reason, and both parts were measured on the same day against the same
-- project. The `do $$` block at the foot of this file re-measures against
-- whatever database setup.sql is being applied to, and says so when the figure
-- has moved.
--
-- WHAT THIS PARAGRAPH USED TO SAY. Until 14 September 2026 it read "26 tables
-- cascade directly from profiles — 39 once the cascade is followed all the way
-- down", with no date beside it and no query under it. The 39 was taken when
-- this schema was about a quarter of its present size and was never re-taken:
-- the true figure is three times it. Both screens that tell a member what
-- deletion destroys had copied that number out of this comment —
-- studio-web/app/deletions/page.tsx and app/(owner)/deletions.tsx — so one
-- unmeasured figure in a SQL comment became a false promise on two
-- irreversible confirmations. It is recorded here rather than quietly
-- overwritten because the next reader needs to know the number moved, not just
-- what it is now. A figure in this file is therefore three things: the number,
-- the date it was measured, and the query that measures it.
--
-- THE DIRECT FAN-OUT from profiles, same catalogue, same day: 76 columns
-- across 68 tables cascade, and 81 columns across 59 tables are `on delete set
-- null` — those rows survive with the person detached, which is right for
-- payments, door-log visits and guest passes a gym must keep for tax and legal
-- reasons. (This comment previously said 29 columns / 26 tables and 17 columns
-- / 13 tables, measured the same way on a much smaller schema.)
--
--   select confdeltype, count(*) as cols, count(distinct conrelid) as tables
--   from pg_constraint
--   where contype='f' and confrelid='public.profiles'::regclass
--   group by confdeltype;   -- 14 Sep 2026: c 76 cols / 68 tables, n 81 / 59
--
-- INVOICES, PAYMENTS AND MEMBERSHIPS SURVIVE, AND THIS COMMENT HAS NOW CLAIMED
-- IT BOTH WAYS. The first version said the financial record survived. A
-- correction replaced that with "INVOICES AND MEMBERSHIPS ARE NOT IN THAT
-- SURVIVING SET … deleting a member takes their invoices and memberships with
-- them", and told a gym with a tax obligation to retain invoices that this
-- deletes them. That was true when it was written and it is not true now:
-- part 184 (`184-an-erasure-that-does-not-unbalance-the-books.sql`) drops
-- `gym_invoices_member_id_fkey`, `gym_payments_member_id_fkey` and
-- `memberships_member_id_fkey` and recreates all three as `on delete set
-- null`, behind a BEFORE DELETE trigger on profiles —
-- `trg_profiles_retain_financial_record` — which copies the name onto
-- `gym_invoices.billed_name`, `gym_payments.payer_name` and
-- `memberships.member_label` while the profile row can still be read. Verified
-- live on 14 September 2026: all three constraints read confdeltype 'n', and
-- the trigger is on the table.
--
--   select conname, conrelid::regclass::text, confdeltype from pg_constraint
--   where contype='f' and confrelid='public.profiles'::regclass
--     and conrelid in ('public.gym_invoices'::regclass,
--                      'public.gym_payments'::regclass,
--                      'public.memberships'::regclass);  -- 14 Sep 2026: all 'n'
--
-- So the money stays, with the person detached from it and the billed name
-- kept beside it, by design. The public deletion page and the owner's
-- confirmation dialog tell people what survives; both must say the financial
-- record does, and neither may go back to promising it is destroyed.
--
-- The cascade is the design. This file adds who may pull the trigger, a record
-- that it happened, and a way for a gym to see what is waiting.
-- ─────────────────────────────────────────────────────────────────────────


-- ── the queue ──────────────────────────────────────────────────────────────
--
-- deletion_requested_at already exists. This adds the other half: when it was
-- actioned, and by whom, so a gym can show its own compliance record after the
-- profile itself is gone.

create table if not exists public.deletion_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  -- Deliberately NOT a foreign key to profiles. The whole point is that the
  -- profile no longer exists once this row is written; a reference would either
  -- block the delete or null itself and destroy the audit trail.
  subject_id uuid not null,
  subject_label text,
  requested_at timestamptz,
  actioned_at timestamptz not null default now(),
  actioned_by uuid references auth.users(id) on delete set null,
  note text
);

create index if not exists idx_deletion_log_tenant
  on public.deletion_log(tenant_id, actioned_at desc);

alter table public.deletion_log enable row level security;

drop policy if exists deletion_log_owner on public.deletion_log;
create policy deletion_log_owner on public.deletion_log for select
  using (is_owner_of(tenant_id));


-- ── what a gym can see ─────────────────────────────────────────────────────
--
-- Pending requests for this gym only. A view rather than a policy on profiles,
-- because the owner needs the request date and a name to act on, and nothing
-- more — this is not a general window onto member records.

create or replace view public.pending_deletions
with (security_invoker = true) as
  select p.id            as subject_id,
         p.tenant_id,
         p.full_name,
         p.role,
         p.deletion_requested_at,
         -- How long the gym has left. The public page promises 30 days.
         greatest(0, 30 - extract(day from (now() - p.deletion_requested_at))::int) as days_remaining
  from public.profiles p
  where p.deletion_requested_at is not null;

grant select on public.pending_deletions to authenticated;


-- ── withdrawing ────────────────────────────────────────────────────────────
--
-- The public page promises a grace period during which a request can be taken
-- back. Without this the promise is unkeepable: nothing could clear the flag.

create or replace function public.withdraw_account_deletion()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update profiles set deletion_requested_at = null where id = auth.uid();
end $$;

revoke execute on function public.withdraw_account_deletion() from public, anon;
grant execute on function public.withdraw_account_deletion() to authenticated;


-- ── actioning it ───────────────────────────────────────────────────────────
--
-- Deletes the auth user, which cascades. Restricted to the owner of the gym
-- the person belongs to, and only for someone who actually asked — a gym
-- cannot use this to remove a member who has not requested it, which would be
-- a deletion tool wearing a compliance label.
--
-- The log row is written BEFORE the delete. Afterwards the profile is gone and
-- there is nothing left to read a name or a tenant from.

create or replace function public.action_account_deletion(p_subject uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  subj_tenant uuid;
  subj_name text;
  subj_requested timestamptz;
begin
  select tenant_id, full_name, deletion_requested_at
    into subj_tenant, subj_name, subj_requested
  from profiles where id = p_subject;

  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  if subj_requested is null then
    raise exception 'That member has not asked to be deleted.' using errcode = '42501';
  end if;

  if not is_owner_of(subj_tenant) then
    raise exception 'Only the owner of that gym can action this.' using errcode = '42501';
  end if;

  insert into deletion_log (tenant_id, subject_id, subject_label, requested_at, actioned_by)
  values (subj_tenant, p_subject, subj_name, subj_requested, auth.uid());

  -- Cascades. 118 tables in `public` and 11 in `auth`, 129 in all, counted
  -- from the live catalogue on 14 September 2026 — this line said 39 until
  -- that date, a count taken on a schema a quarter of this size. 81 columns
  -- across 59 tables are `on delete set null` instead, so payments, visits
  -- and passes survive with the person detached — and so do invoices,
  -- payments and memberships, which this line used to say were destroyed.
  -- The query, the provenance and the correction are in the header.
  delete from auth.users where id = p_subject;
end $$;

revoke execute on function public.action_account_deletion(uuid) from public, anon;
grant execute on function public.action_account_deletion(uuid) to authenticated;


-- ── does the figure at the top of this file still hold? ────────────────────
--
-- The number above governs an irreversible confirmation on two screens, and a
-- number in prose goes stale silently: this one was wrong by a factor of three
-- for however long it took somebody to re-measure by hand. So it is measured,
-- rather than only asserted, against the catalogue of whatever database
-- setup.sql is being applied to — the only source that can answer it. No gate
-- under scripts/ can: they run offline in CI with no credentials by design, and
-- parsing setup.sql gives the wrong answer for the reason the header states.
--
-- A WARNING, NOT AN EXCEPTION. setup.sql is pasted whole into the SQL editor.
-- Aborting the run because somebody legitimately added a cascading table would
-- break the paste and teach the next person to delete this block.
--
-- IT ONLY SPEAKS WHEN THE COUNT IS HIGHER THAN THE FIGURE, and that asymmetry
-- is the honest shape rather than a convenience. This part is 41 of several
-- hundred: on a FIRST paste it runs when most of the schema does not exist yet,
-- so a count below 118 means "the bundle is still being applied" and cannot be
-- told apart from "cascades were removed". On a re-run against a built
-- database — which is how setup.sql is normally used — every table is already
-- there and a count above the figure is drift, unambiguously. What this block
-- therefore cannot catch is the opposite drift — the written figure becoming
-- too HIGH because cascading foreign keys were dropped or turned into `set
-- null`. That direction still needs the query in the header, run by a person.

-- THE LIST IN THE WARNING BELOW NAMED THREE FILES UNTIL 14 SEPTEMBER 2026, and
-- there were never three. It named this part, studio-web/app/deletions/page.tsx
-- and app/(owner)/deletions.tsx — the three somebody happened to be editing the
-- day this block was written. A warning that names a subset is worse than one
-- that names nothing: it reads as the complete list, so the six it omitted
-- would have been left stating a superseded figure by a person who had done
-- exactly what the message told them to do. That is the shape of the original
-- defect this whole file exists for — one unmeasured number copied onto five
-- surfaces, each out of a different file's comment.
--
-- The list is now every carrier, and it is not a guess: check O of
-- scripts/check-site-claims.mjs walks web, app, src, studio-web,
-- supabase/parts and docs for the canonical phrasings and holds each hit
-- against the threshold in this block. Nine files match today. Lane 111
-- measured eight on 14 September 2026; web/delete-account.html became the
-- ninth the same day, when the figure it stated in words ("sixty-six directly,
-- and a hundred and six") was re-measured and rewritten in the canonical form
-- so that this gate can see it — a figure spelled out in words was invisible
-- to check O and had drifted unnoticed for exactly that reason.
--
-- IF THE COUNT IN THE MESSAGE AND THE COUNT check O REPORTS EVER DISAGREE, the
-- gate is right and this comment is stale. Re-run `npm run check:site-claims`;
-- its closing line reports how many files state the figure.

do $$
declare
  n_public int;
  n_auth int;
begin
  if to_regclass('auth.users') is null then
    return;  -- no auth schema to close over; nothing to say.
  end if;

  with recursive reach(oid) as (
    select to_regclass('auth.users')::oid
    union
    select c.conrelid
      from pg_constraint c
      join reach r on c.confrelid = r.oid
     where c.contype = 'f' and c.confdeltype = 'c'
  )
  select count(*) filter (where n.nspname = 'public'),
         count(*) filter (where n.nspname = 'auth')
    into n_public, n_auth
    from reach r
    join pg_class t on t.oid = r.oid
    join pg_namespace n on n.oid = t.relnamespace
   where r.oid <> to_regclass('auth.users')::oid;

  if n_public > 118 or n_auth > 11 then
    raise warning 'account deletion now reaches % tables in public and % in auth. Nine files still say 118 and 11, measured 14 September 2026: supabase/parts/41-account-deletion.sql (its header, and the comment on the delete itself), supabase/parts/1120-the-files-an-erasure-left-behind.sql, supabase/parts/2370-a-permanent-record-of-deleting-nobody.sql, web/security.html, web/studio.html, web/delete-account.html, app/(owner)/deletions.tsx, src/ui/notifications.tsx and studio-web/app/deletions/page.tsx. Re-run both queries in part 41''s header against the live catalogue, update all nine, move the date on each, and move the threshold in this block last. Run `npm run check:site-claims` — check O enumerates the carriers and fails while any of them disagrees.',
      n_public, n_auth;
  end if;
end $$;
