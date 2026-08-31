-- ─────────────────────────────────────────────────────────────────────────
-- Which BRAND does a gym belong to?
--
-- The codebase has two axes and they have never met. `src/lib/brands.ts` is a
-- BUILD-time axis: EXPO_PUBLIC_BRAND picks a brand, and the bundle id, the
-- store listing, the icon and the join-link origin follow from it. `tenants` is
-- the RUN-time model: a row per gym, with a name, a colour, a plan, a fee and
-- (since part 99) a currency. Nothing in the second one records which of the
-- first it came from. docs/WHITE-LABEL.md §8 calls this the deepest structural
-- gap and it is right: the provisioning trigger in part 06 creates
-- `<Name>'s space` on every signup and CANNOT know which app the person was
-- holding, because the client never told it.
--
-- This part makes the client tell it, records the answer, and stops the answer
-- being edited afterwards by the people it is about.
--
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
--
-- This is NOT isolation, and it must not be described as security.
--
-- Every brand shares ONE Supabase project. One database, one PostgREST, one
-- anon key — and that anon key ships inside every app bundle, where anybody who
-- wants it can read it out of the binary. A person holding it can talk to this
-- database directly, with curl, with no app in the loop at all. Every guard
-- below is then irrelevant to them: the app-side check is code they are not
-- running, and the two functions here are ones they can simply not call.
--
-- What the guards below actually achieve is narrower and still worth having:
--
--   • the brand a tenant was created under is RECORDED, so the question can be
--     asked at all — today it cannot be asked, by anyone, at any layer;
--   • an ordinary signed-in session cannot CHANGE that record (the trigger),
--     so a gym owner cannot walk their own gym into another brand;
--   • the app can find out the answer for its own user (my_tenant_brand) even
--     though RLS does not let most users read `tenants` at all, and refuse to
--     carry on. That refusal is a HONEST-USER guard: it stops the wrong app
--     showing the wrong gym's data to somebody who did not intend it. It stops
--     nobody who does intend it.
--
-- Genuine isolation is one Supabase project per brand: separate database,
-- separate keys, separate auth. Nothing short of that keeps Brand A's rows out
-- of reach of somebody with Brand B's bundle. When a second brand is a real
-- customer rather than the worked example in brands.ts, that is the decision to
-- make, and this part is not a substitute for making it.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1 · The column ─────────────────────────────────────────────────────────
--
-- NULLABLE, and null means "nobody has stated which brand this gym belongs to"
-- — not a guess, and not a default. Part 99 argued this for `currency` and the
-- argument is the same one, only sharper: a `default 'repple'` on this column
-- would silently claim every future tenant for Repple, including one created by
-- a brand that simply had not wired its signup up yet, and the claim would LOOK
-- deliberate. A wrong brand recorded confidently is worse than no brand
-- recorded, because the guard below acts on it.
--
-- Named `brand`, next to the older `brand_color`, and the two are unrelated:
-- `brand_color` is one gym owner's accent colour, this is which white-label
-- product the gym is a customer of. The collision is unfortunate and the
-- alternative — `white_label_brand`, `brand_key` — reads worse everywhere it is
-- used. brands.ts calls it a brand and so does this.
--
-- No foreign key, because there is no brands table and there should not be one:
-- the registry is `BRANDS` in src/lib/brands.ts, it is compiled into each app,
-- and a build knows brands the database has never heard of. The check below
-- therefore validates the SHAPE of an id, not its membership. An id that no
-- build recognises is not rejected here — it is rejected by the app, which
-- treats "a brand I do not know" as a mismatch like any other.
alter table public.tenants
  add column if not exists brand text;

alter table public.tenants drop constraint if exists tenants_brand_is_id;
alter table public.tenants add constraint tenants_brand_is_id
  check (brand is null or brand ~ '^[a-z][a-z0-9_-]{0,31}$');

-- Existing rows ARE Repple, stated rather than defaulted. This is a fact about
-- the world on the day this was written, not a fallback: `BRANDS` has exactly
-- one entry with a real bundle id in a real store, every account in this
-- database was created by one of those three apps, and no second brand's binary
-- has ever existed. Verified against the live database first: 19 tenants, all
-- of them predating the brand axis.
--
-- The date is in the statement because that fact expires. Every part in this
-- folder is written to survive being re-run, and a re-run of a bare `where
-- brand is null` a year from now would sweep up the tenants a second brand had
-- deliberately left unstated and hand them to Repple — silently, and looking
-- deliberate. So the backfill claims only what was already there. Anything
-- created afterwards has an app to speak for it, and if it says nothing it
-- stays null, which is the answer that cannot be wrong.
update public.tenants set brand = 'repple'
 where brand is null and created_at < timestamptz '2026-09-01';

comment on column public.tenants.brand is
  'Which white-label brand (src/lib/brands.ts BRANDS key) this gym belongs to. '
  'NULL means nobody has stated one — never assume, and never treat it as a mismatch. '
  'Set once by provision_profile() from signup metadata; not editable from a client session.';


-- ── 2 · Why NOT on `profiles` too ──────────────────────────────────────────
--
-- Deliberately not added there, and this is a decision rather than an omission.
--
-- A profile has exactly one tenant (`profiles.tenant_id`), so `profiles.brand`
-- would be derivable from `tenants.brand` at every moment — a second copy of an
-- answer that already exists. Two copies of one fact drift, and the drift here
-- would be silent and consequential: the guard has to compare the app's brand
-- against ONE thing, and with two columns it would have to first decide which
-- of them is lying. There is no answer to that question that is not arbitrary.
--
-- The drift is not hypothetical either. Part 37's member invites MOVE a profile
-- from its personal tenant into a gym's tenant. A `profiles.brand` stamped at
-- signup would then still say what app the person downloaded first, while the
-- gym they are actually in says something else. The question the guard asks is
-- "whose data is about to be shown" — that is a property of the GYM, so it
-- lives on the gym.
--
-- What would justify a column on `profiles` is a different question: "which
-- app did this person sign up in", as an audit fact, kept even after they move
-- gyms. That is a reporting want, not a correctness one, and `auth.users`
-- already holds it — raw_user_meta_data->>'brand' survives untouched. Nothing
-- has needed it yet.


-- ── 3 · Signup records the brand ───────────────────────────────────────────
--
-- How a signup actually reaches a tenant, verified against the live database
-- rather than inferred from the files:
--
--   insert into auth.users
--     → on_auth_user_created  → handle_new_user()    [part 07]
--         inserts public.profiles, reading raw_user_meta_data->>'role' and
--         ->>'full_name' — the metadata the app passed to supabase.auth.signUp
--     → on_profile_created    → provision_profile()  [part 06]
--         creates `<Name>'s space` when profiles.tenant_id is null
--
-- So the metadata IS available; it just never travelled the second hop, because
-- provision_profile() is a trigger on `profiles` and `profiles` does not carry
-- it. Two ways to close that: widen `profiles` to relay the value, or have
-- provision_profile() read auth.users itself. The second is taken, because the
-- first is exactly the `profiles.brand` column argued against above — a column
-- whose only purpose is to be a courier would still be a column that can
-- disagree with the tenant.
--
-- provision_profile() is SECURITY DEFINER owned by postgres, so it may select
-- from auth.users; and the auth.users row is already inserted, in this same
-- transaction, by the time the nested profiles trigger runs.
--
-- ONLY the tenant-creating branch changes. Everything else below is the live
-- definition transcribed unaltered — the clients/trainers rows, the coalesce
-- for the name, the on-conflict — because this function provisions every
-- account Repple has and a tidy-up here is a production change nobody asked
-- for.
create or replace function public.provision_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid; b text;
begin
  tid := new.tenant_id;
  if tid is null then
    -- What the app said it was at signup. NULL when it said nothing: an older
    -- build, or a path that carries no metadata (OAuth — see claim_tenant_brand
    -- below). Null is recorded as null; a signup that did not state a brand
    -- does not get one invented for it.
    select nullif(trim(u.raw_user_meta_data->>'brand'), '') into b
      from auth.users u where u.id = new.id;
    if b is not null and b !~ '^[a-z][a-z0-9_-]{0,31}$' then b := null; end if;
    insert into tenants (name, brand) values (coalesce(new.full_name,'My') || '''s space', b) returning id into tid;
    update profiles set tenant_id = tid where id = new.id;
  end if;
  if coalesce(new.role,'client') = 'client' then
    insert into clients (id, tenant_id) values (new.id, tid) on conflict (id) do nothing;
  elsif new.role = 'trainer' then
    insert into trainers (id, tenant_id) values (new.id, tid) on conflict (id) do nothing;
  end if;
  return new;
end $$;


-- ── 4 · The brand cannot be edited from a client session ───────────────────
--
-- This is the one piece of real server-side enforcement in the part, and it is
-- worth being precise about what it enforces.
--
-- `tenants_owner_rw` is `for all using (is_owner_of(id)) with check
-- (is_owner_of(id))`, and RLS cannot restrict WHICH COLUMNS an update touches —
-- the same hole part 38 found on `profiles`. So without this, any gym owner
-- could run `update tenants set brand = 'someone_else' where id = <their gym>`
-- and walk their gym, their members and their whole operating record into
-- another brand's app. The app-side guard would then wave them through, because
-- the record it consults would agree with them.
--
-- A trigger rather than a column grant, following part 38: revoking UPDATE on a
-- single column does nothing while the table-level grant stands (checked on the
-- live database — `tenants` is granted `arwdDxtm` to authenticated at TABLE
-- level, with no per-column ACLs at all, which is also why the new column is
-- writable by default and why this trigger is needed at all). Dropping the
-- table grant and re-granting the other columns one by one would work, and
-- would silently make every column added after today unwritable. Not worth it.
--
-- current_user is 'authenticated' or 'anon' for a request from an app, and
-- 'postgres' inside a SECURITY DEFINER function — so provision_profile() and
-- claim_tenant_brand() pass straight through, and a direct UPDATE from a phone
-- does not. service_role is deliberately NOT blocked: that key belongs to
-- whoever runs the platform, a brand migration is a real operation, and a guard
-- the operator cannot get past is a guard that gets dropped in an incident.
--
-- Note this blocks null → value too, not just value → value. Filling in a blank
-- from a client session is the same move as changing one: it is how an
-- unstamped tenant would be laundered into a brand it does not belong to.
-- claim_tenant_brand() below is the narrow, checked way to do that.
create or replace function public.guard_tenant_brand()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and new.brand is distinct from old.brand then
    raise exception 'A gym cannot change which brand it belongs to.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_tenant_brand_t on public.tenants;
create trigger guard_tenant_brand_t
  before update on public.tenants
  for each row execute function public.guard_tenant_brand();


-- ── 5 · Letting the app ask ────────────────────────────────────────────────
--
-- The app cannot answer this by reading `tenants`, and that is not obvious, so:
-- checked against the live policies, the three SELECT paths on `tenants` are
-- is_owner_of(id), being a trainer of it, or being a coach's client within it.
-- A plain member sitting in their own personal tenant is none of the three.
-- Confirmed against live rows — for five sampled client profiles, all three
-- tests are false for their OWN tenant. So `select brand from tenants where id
-- = <mine>` returns ZERO ROWS for most users, with no error, which is precisely
-- the failure mode src/ui/loadStatus.ts exists to stamp out: "the gym has no
-- brand" and "you may not read the gym" arriving as the same empty answer, and
-- the guard reading it as permission to continue.
--
-- Hence a SECURITY DEFINER function. It answers about the CALLER and nobody
-- else, which is why it can safely see past RLS.
--
-- Returns jsonb rather than a bare text so the three distinguishable outcomes
-- stay distinguishable at the client: no session, a session with no tenant, and
-- a tenant whose brand is null. A single nullable text would collapse all three
-- into "null", and the caller would have to guess which — the same collapse
-- again, one layer up.
create or replace function public.my_tenant_brand()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'signed_in', auth.uid() is not null,
    'tenant_id', (select p.tenant_id from profiles p where p.id = auth.uid()),
    'brand',     (select t.brand from profiles p join tenants t on t.id = p.tenant_id
                   where p.id = auth.uid())
  );
$$;

-- Per part 38's note, learned against this database: revoking from `anon` alone
-- accomplishes nothing, because Postgres grants EXECUTE to PUBLIC on every new
-- function and that is the grant anon resolves through. Revoke names PUBLIC.
-- anon is not granted back: auth.uid() is null without a session, so there is
-- nothing for an anonymous caller to learn here anyway.
revoke execute on function public.my_tenant_brand() from public;
grant execute on function public.my_tenant_brand() to authenticated;


-- ── 6 · The signup path that cannot carry metadata ─────────────────────────
--
-- Email/password and phone OTP both hand `options.data` to supabase.auth, which
-- lands in raw_user_meta_data before handle_new_user() reads it. Apple and
-- Google do not: signInWithOAuth has no user-metadata argument at all, the
-- account is created by the provider callback, and by the time the app has a
-- session the tenant already exists unstamped. (Social sign-in is not wired up
-- in this build — src/ui/auth.tsx throws for both providers — so nothing is
-- broken today. This is here so that turning it on does not quietly create a
-- population of brandless tenants.)
--
-- So: one narrow repair, called by the app right after an account is created.
-- Deliberately hemmed in —
--
--   • only when the tenant's brand is NULL. It never overwrites, so it can
--     never move a gym between brands; that remains impossible from a session.
--   • only when the tenant has exactly ONE profile in it. A freshly provisioned
--     personal workspace has one occupant. A real gym has staff and members,
--     and must never be stamped by whichever member happened to open an app.
--   • only a well-formed id, same shape as the column check.
--
-- It is not more trustworthy than the signup metadata it stands in for: both
-- are the client asserting which app it is, and a client can assert anything.
-- What it cannot do is more than a fresh signup in that brand's app could do
-- anyway — claim an empty one-person tenant — which is why the assertion is
-- acceptable here and would not be on a shared tenant.
--
-- Returns the brand as it stands AFTER the attempt, so the caller can see what
-- happened rather than assume it worked.
create or replace function public.claim_tenant_brand(p_brand text)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare tid uuid; occupants int; b text;
begin
  b := nullif(trim(p_brand), '');
  if b is null or b !~ '^[a-z][a-z0-9_-]{0,31}$' then
    raise exception 'Not a brand id: %', coalesce(p_brand, '(null)') using errcode = '22023';
  end if;

  select p.tenant_id into tid from profiles p where p.id = auth.uid();
  if tid is null then return null; end if;

  select count(*) into occupants from profiles p where p.tenant_id = tid;
  if occupants = 1 then
    update tenants set brand = b where id = tid and brand is null;
  end if;

  return (select t.brand from tenants t where t.id = tid);
end $$;

revoke execute on function public.claim_tenant_brand(text) from public;
grant execute on function public.claim_tenant_brand(text) to authenticated;
