-- ═══════════════════════════════════════════════════════════════════════════
-- White-label for a coach, not just a gym.
--
-- `tenants.name` and `tenants.brand_color` are a GYM's branding, and the roadmap
-- says an independent coach has no equivalent. Before adding anything, the
-- obvious cheaper answer was tested — a solo coach already has a tenant, so
-- perhaps this is only a matter of letting them write it. It is not, and the
-- three measurements that rule it out are recorded here because every one of
-- them is a fact about the live database that a reader would otherwise have to
-- take on trust.
--
--
-- ── 1 · A solo coach DOES have a tenant. It is unwritable by them. ─────────
--
-- `provision_profile()` (part 06, extended by 101) creates `<Name>'s space` for
-- every profile that arrives with no tenant_id, and `handle_new_user()` (part
-- 07) inserts `profiles` naming only id, role and full_name — so tenant_id is
-- always null on insert and the tenant-creating branch always fires. Measured
-- live: 20 profiles, 54 tenants, and ZERO tenants holding more than one
-- profile. Every one of the seven coaches sits alone in a personal tenant.
--
-- (An earlier note in this project said the signup trigger places new profiles
-- into EXISTING tenants. It does not, and nothing in the live data supports it:
-- the only writer that moves a profile between tenants is
-- `redeem_member_invite()` in part 37, which is a gym admitting a member.)
--
-- But that tenant is not theirs to change. `is_owner_of(t)` requires
-- `profiles.role = 'owner'`; a coach's role is 'trainer'. `tenants_owner_rw` is
-- the ONLY write policy on `tenants`, so every UPDATE a coach aims at their own
-- tenant row matches zero rows — and a PostgREST write matching zero rows is
-- not an error (src/lib/wroteRows.ts). Exposing the owner's Brand screen to the
-- coach app would therefore have produced a screen that accepts a colour,
-- reports success and changes nothing.
--
--
-- ── 2 · Even if it were writable, it would reach nobody. ──────────────────
--
-- This is the measurement that decides the whole item. A coached client does
-- NOT share their coach's tenant. Checked against the one live coaching
-- relationship: coach tenant c382286c…, client tenant 4a718f6f…, different
-- rows. A client is provisioned into a personal tenant of their own and only
-- ever leaves it by redeeming a GYM's member invite.
--
-- So `profiles.tenant_id` is the gym-membership axis, and a coach's tenant is a
-- permanently one-occupant room. Branding it brands the coach's own app for the
-- coach. The client's app would never read it, because the client is not in it.
--
--
-- ── 3 · So the brand belongs on the RELATIONSHIP, not on a tenant. ────────
--
-- What actually connects a coach to the clients who should see their branding
-- is `clients.trainer_id` plus an ACTIVE `coaching_relationships` row — the
-- same pair `my_coach()` (part 67) and `my_coach_profile()` (part 130) already
-- use to carry the coach's name, face and tagline to exactly those clients and
-- to nobody else. That is the carrier. This part adds two columns to the row
-- the coach already owns, and one function that answers over the same gate.
--
-- No new table, no new tenant kind, no `tenants.owner_id` widening, and no
-- change to how a gym is branded.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── The two columns ────────────────────────────────────────────────────────
--
-- Both nullable with NO default, and part 150 is the reason to be explicit
-- about it: seven money columns carried a default currency nobody had chosen,
-- and every screen spent it as though somebody had. A coach who has not picked
-- a colour has not picked a colour, and the app must be able to say so rather
-- than draw a teal it can then find in the record and assume was intended.
alter table public.trainers add column if not exists brand_color text;
alter table public.trainers add column if not exists brand_name  text;

-- What a coach TRADES AS, when that is not their own name.
--
-- The gym's equivalent is `tenants.name`. NULL here is not a missing value to
-- be filled in: it means this coach coaches under their own name, which is
-- already the name their clients see through `my_coach()`. So the app does not
-- substitute anything for a null — it shows the person's name, exactly as it
-- does today, and the coach has simply not claimed a separate one.
comment on column public.trainers.brand_name is
  'What this coach trades as, when it is not their own name. NULL means they use their own name — not a value to be defaulted.';

comment on column public.trainers.brand_color is
  'The coach''s accent colour, #rgb or #rrggbb. NULL means they have chosen none. Shape is checked here; whether it is LEGIBLE is decided by the app that draws it — see the note on the constraint below.';

-- Shape only, and case-insensitive because a person types a hex the way they
-- read it. `brandColorOf()` in src/lib/gymSettings.ts normalises to lower case
-- on the way in; this catches everything that does not come through it.
--
-- #RRGGBBAA is refused rather than truncated: the theme's parser handles three
-- and six digits, and a silently-dropped alpha channel is a different colour
-- from the one the coach chose.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainers'::regclass and conname = 'trainers_brand_color_hex'
  ) then
    alter table public.trainers add constraint trainers_brand_color_hex
      check (brand_color is null or brand_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$');
  end if;
end $$;

-- ── Why LEGIBILITY is not a check constraint ──────────────────────────────
--
-- It is tempting: `brandInkFor()` measures WCAG contrast, roughly 4% of colours
-- are too mid-toned for either black or white to clear 4.5:1, and a coach must
-- not be able to make an unreadable app. A luminance function in SQL would let
-- the database refuse those outright.
--
-- It is refused for the reason part 101 gives about `profiles.brand`: two
-- copies of one fact drift, and the copy that drifts is the one nobody runs.
-- The number that matters is the contrast between this colour and the ink the
-- APP decides to draw on it, and that decision lives in `readableInkOn()` in
-- src/lib/a11y.ts. A second implementation of WCAG relative luminance here
-- would be a second rule, tested separately, that can disagree with the one
-- actually rendering the button.
--
-- So the enforcement is where the drawing is, and it is in two places on
-- purpose: `parseCoachBrandColor()` refuses the hex at the point the coach
-- types it, with the measured ratio in the refusal; and `coachBrandColorOf()`
-- refuses it AGAIN at render, so a value written by some other route — curl
-- with the anon key, a future importer — still cannot produce an illegible
-- screen. It simply does not apply, and the app keeps its own colour.


-- ── The grants, which are the part that would have failed silently ────────
--
-- `trainers` does not grant SELECT/INSERT/UPDATE at table level. Measured live:
-- `authenticated=dm/postgres` — DELETE and MAINTAIN only — with every readable
-- column granted individually, and `join_code` deliberately granted nothing
-- (parts 131 and 152). That is the inverse of the situation part 38 and part
-- 101 warn about, and it has the inverse consequence: a column added to this
-- table is invisible AND unwritable to `authenticated` until it is named here.
--
-- Without these two lines the coach's Brand screen would have compiled, run,
-- issued its UPDATE, matched zero rows, raised nothing, and shown a colour that
-- lived on one phone. Which is the same failure the owner's Brand screen was
-- built to end.
--
-- Supabase grants to `anon` and `authenticated` separately, and `anon` is given
-- nothing here. It has no column SELECT grants on this table at all, so it
-- cannot read a coach's branding, and it should not be able to: an unauthenticated
-- caller has no coach.
grant select (brand_color), update (brand_color) on public.trainers to authenticated;
grant select (brand_name),  update (brand_name)  on public.trainers to authenticated;

-- A note on who can then READ it, so it is not a surprise later.
-- `trainers_public_directory_r` is `using (listed = true)`, so any signed-in
-- user can read the whole readable column list of a coach who has opted into
-- the directory — branding included. That is correct and intended: a listed
-- coach is advertising, and their colour and trading name are the advert.
-- An UNLISTED coach's branding is reachable only by their own assigned clients
-- (`trainers_assigned_client_r`), their gym's owner, and their tenant peers.


-- ── What the client app asks ──────────────────────────────────────────────
--
-- One function, and it answers only about the caller.
--
-- Not folded into `my_coach_profile()`, which is the my-coach SCREEN's read: it
-- returns bio, specialties and offers, and the chrome question has to be
-- answerable on any screen without dragging a profile along. The one field the
-- two share is the coach's name, and they read it from the same
-- `profiles.full_name`, so they cannot disagree about it.
--
-- Returns jsonb rather than a row for the reason `my_tenant_brand()` gives:
-- three outcomes that a nullable column would collapse into one null — no
-- session, no coach, and a coach who has chosen no colour — stay distinguishable
-- at the client, and src/ui/loadStatus.ts exists because that collapse is how
-- this app tells somebody a thing is absent when it merely could not be read.
--
-- `in_gym` is the precedence input, and it is derived rather than declared.
-- There is no column saying whether a tenant is a gym or a personal workspace,
-- and inventing one would need a backfill judgement over 54 rows. What is true
-- without inventing anything: a personal tenant has exactly one occupant, and a
-- gym has staff. So "somebody else is in my tenant" IS "I am in a gym", it is
-- measurable now, and it needs no migration. It is computed here because RLS on
-- `profiles` is `id = auth.uid()` — a client cannot count their own tenant's
-- occupants, and would read zero and conclude they are independent.
--
-- The relationship test is `my_coach_profile()`'s, character for character.
-- When coaching ends, `end_coaching()` clears `clients.trainer_id` and this
-- stops naming the coach — the branding goes when the relationship goes.
create or replace function public.my_coach_brand()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select jsonb_build_object(
    'signed_in', auth.uid() is not null,
    'in_gym', exists (
       select 1 from public.profiles peer
        where peer.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))
          and peer.id <> (select auth.uid())
    ),
    'coach_id', (select c.trainer_id from public.clients c where c.id = (select auth.uid())),
    'coach_name', (
      select nullif(btrim(p.full_name), '')
        from public.clients c join public.profiles p on p.id = c.trainer_id
       where c.id = (select auth.uid())
         and exists (select 1 from public.coaching_relationships r
                      where r.client_id = c.id and r.coach_id = c.trainer_id and r.status = 'active')
    ),
    'brand_name', (
      select nullif(btrim(t.brand_name), '')
        from public.clients c join public.trainers t on t.id = c.trainer_id
       where c.id = (select auth.uid())
         and exists (select 1 from public.coaching_relationships r
                      where r.client_id = c.id and r.coach_id = c.trainer_id and r.status = 'active')
    ),
    'brand_color', (
      select t.brand_color
        from public.clients c join public.trainers t on t.id = c.trainer_id
       where c.id = (select auth.uid())
         and exists (select 1 from public.coaching_relationships r
                      where r.client_id = c.id and r.coach_id = c.trainer_id and r.status = 'active')
    )
  );
$fn$;

-- Deliberately NOT returned: `session_fee`, `join_code`, `listed`, `tenant_id`
-- — part 130's list, for part 130's reasons. A join code is what attaches
-- somebody to a coach, and a branding read is not a reason to hand one over.
--
-- Revoked from `public` AND from `anon` by name. Postgres grants EXECUTE to
-- PUBLIC on every new function and `anon` resolves through that grant, so
-- naming only `anon` would leave it standing and naming only `public` would
-- leave anon's own grant standing. Both are named — this is how `log_gym_event`
-- became an unauthenticated cross-tenant write.
revoke all on function public.my_coach_brand() from public, anon;
grant execute on function public.my_coach_brand() to authenticated;
