-- ═════════════════════════════════════════════════════════════════════════
-- One owner, one gym — the part of it that can be built without touching a
-- policy that already works.
--
-- Today `is_owner_of(t)` is "this caller's profile says role = 'owner' and
-- profiles.tenant_id = t", `my_tenant()` is one uuid, and every read in the
-- product is scoped through one or the other. An operator with two sites
-- therefore has two accounts, and each account sees exactly one site. That is
-- inconvenient and it is also the single property this schema has spent parts
-- 38, 39, 106 and 252 establishing: an owner sees one gym's data and no
-- other's.
--
-- ── WHAT THIS PART REFUSES TO DO ────────────────────────────────────────
--
-- It does not touch `is_owner_of`, `my_tenant`, `my_role`, `tenant_of_user`
-- or any existing policy. Not one.
--
-- The tempting change is four words long: make `is_owner_of` also consult a
-- membership table. It is also the largest single widening anybody could make
-- to this database. Counted in the generated bundle as this part was written,
-- `is_owner_of` is named by 64 distinct policies across 56 TABLES — members,
-- payments, invoices, payroll, paperwork, crash logs, coach rosters — and
-- every one of them would silently start returning a second gym's rows the
-- moment that function changed, with no line in any policy having been edited
-- and nothing in `pg_policies` to show for it. The reviewer of that diff reads
-- four words; the effect is fifty-six tables. The direction of travel in this schema is the opposite
-- one — part 39 narrowed nine policies that asked "is this caller AN owner"
-- instead of "the owner of THIS row", and part 106 narrowed a tenth — and a
-- part that widens `is_owner_of` reverses all of it at once.
--
-- So the reader set is UNCHANGED by this file. An owner recorded below
-- against a second gym gets, from this part, exactly one new thing: the fact
-- that the second gym exists, and its name. No row of its data. The console
-- is expected to SAY so rather than to pretend otherwise — see
-- src/lib/ownedSites.ts, which words it.
--
-- What actually lets somebody read a second site is a separate decision with
-- a human at a keyboard, and the two candidate designs are written down at the
-- bottom of this file so that whoever makes it is not starting from scratch.
--
-- ── WHY AN EXPLICIT TABLE, AGAIN ────────────────────────────────────────
--
-- The same argument part 252 makes for `platform_admins`, and it applies here
-- with more force rather than less: THE PLATFORM LETS PEOPLE SIGN UP AS AN
-- OWNER. `profiles.role` is a value a stranger chooses about themselves, and
-- `profiles.tenant_id` is written by the invite flow. Neither is a safe place
-- to record "this person owns these gyms". A table with no INSERT policy for
-- anybody cannot be reached by signing up: a row can only be written by the
-- service role, which is to say by whoever owns the project.
--
-- It ships EMPTY. An empty table means every account resolves to exactly the
-- one gym it resolves to today, so a single-site owner cannot tell this part
-- was applied.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1 · the membership ──────────────────────────────────────────────────
--
-- "This person owns this gym." One row per pair. Not a column on `profiles`,
-- which holds one tenant and is the spine several other things follow (part 37
-- rewrites it when a member changes gyms), and not a column on `tenants`,
-- which would make a gym hold one owner.
create table if not exists public.owner_sites (
  -- The account. `profiles` rather than `auth.users`, matching `platform_admins`
  -- and the rest of this schema, so a deleted account takes its memberships
  -- with it instead of leaving rows pointing at nobody.
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- The gym. A SITE IS A TENANT — that is the decision this whole part rests
  -- on and it is argued in section 4 below.
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- Why this person is on this gym, in words, for whoever reads the table in
  -- two years. Not an audit trail and not pretending to be one — same as the
  -- `note` on `platform_admins`.
  note       text,
  added_at   timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- "Who owns this gym" is the other direction and the primary key cannot answer
-- it. Small table, but it is the query a support person types.
create index if not exists idx_owner_sites_tenant on public.owner_sites(tenant_id);

alter table public.owner_sites enable row level security;

-- ── the ONLY policy on this table ───────────────────────────────────────
--
-- A person may read their OWN memberships, and that is the whole of it. There
-- is deliberately:
--
--   · no INSERT policy, so no authenticated account can add itself to a gym.
--     This is the property that makes the table safe, and it is the same
--     property `platform_admins` has and for the same reason;
--   · no UPDATE and no DELETE policy, so nobody can quietly hand themselves a
--     second site or remove somebody else from one;
--   · no read of anybody ELSE's rows. "Which gyms does that person own" is not
--     a question one owner needs answered from a browser.
--
-- The service role bypasses all of this, which is how a row gets in.
drop policy if exists owner_sites_self on public.owner_sites;
create policy owner_sites_self on public.owner_sites for select
  using (user_id = auth.uid());

-- ── 2 · what the console is allowed to know ─────────────────────────────
--
-- The console needs to answer two questions and no more than two: "might this
-- account have more than one gym", and "what is the one I am showing called".
--
-- It cannot answer the second from `tenants` alone. `tenants_read` is
-- `id = my_tenant()` (part 38), so an owner recorded against a second gym can
-- read the membership row and gets a bare uuid — the name is behind a policy
-- that is correctly scoped to one tenant.
--
-- The answer is NOT to add a policy to `tenants`. A new permissive policy
-- there would hand the whole row over — brand, plan, session_fee, currency —
-- for a question that needs a name. So this is a function returning exactly
-- two fields, on the `my_tenant_brand()` precedent from part 101: jsonb rather
-- than a row set, SECURITY DEFINER with a pinned search_path so it does not
-- depend on the caller being able to read the tables it reads, and STABLE
-- because the answer cannot change within a statement.
--
-- ── what is in the answer ──
--
--   id       the tenant
--   name     `tenants.name`, or null if the gym never set one
--   current  true for THE ONE THIS SESSION CAN ACTUALLY READ — the tenant
--            `is_owner_of` says yes to, which is `profiles.tenant_id` when the
--            profile's role is 'owner'. Exactly one entry can carry it, and on
--            an account with no owner role none does.
--
-- `current` is the honest half of this whole part. Every other entry in the
-- list is a gym this account is recorded against and can read NOTHING of, and
-- the flag is what lets the console say that in words rather than render a
-- picker whose second option silently shows an empty gym.
--
-- The profile's own tenant is included whether or not `owner_sites` holds a
-- row for it, so a single-site owner with an empty table gets a one-element
-- list — the same one gym the console already shows, and no picker.
--
-- A non-owner gets `[]` from the profile arm: the test here is `role = 'owner'
-- and tenant_id is not null`, which is `is_owner_of` written out, and a
-- trainer does not own the gym they work at.
create or replace function public.my_sites()
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with mine as (
    -- The gym this session is actually scoped to. `is_owner_of` spelled out
    -- rather than called, because it takes the tenant as an argument and the
    -- question here is which tenant that is.
    -- `readable` rather than `current`: the jsonb KEY below is 'current',
    -- which is what the console reads, but `current` is a keyword Postgres
    -- reserves in enough contexts that using it as a column alias is a coin
    -- flip nobody needs to take in a file that is pasted into a SQL editor.
    select p.tenant_id as tenant_id, true as readable
      from public.profiles p
     where p.id = auth.uid() and p.role = 'owner' and p.tenant_id is not null
    union
    -- Every gym the service role has recorded this person against. No role
    -- test: the row IS the record, written by somebody with a SQL console, and
    -- it grants no data either way.
    select os.tenant_id, false
      from public.owner_sites os
     where os.user_id = auth.uid()
  ),
  folded as (
    -- A person whose profile tenant also has an `owner_sites` row appears
    -- twice above; `bool_or` keeps the readable one rather than whichever the
    -- union happened to emit.
    select tenant_id, bool_or(readable) as readable
      from mine group by tenant_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', f.tenant_id, 'name', t.name, 'current', f.readable)
      -- Readable first, then by name, then by id so the order is total and two
      -- gyms with the same name cannot swap places between reads.
      order by f.readable desc, lower(coalesce(t.name, '')), f.tenant_id
    ),
    '[]'::jsonb)
    from folded f
    left join public.tenants t on t.id = f.tenant_id;
$function$;

revoke all on function public.my_sites() from public, anon;
grant  execute on function public.my_sites() to authenticated;

-- ── 3 · what this part does NOT add ─────────────────────────────────────
--
-- No policy anywhere reads `owner_sites`, and nothing in this file mentions
-- `is_owner_of`, `my_tenant`, `my_role` or `tenant_of_user`. That is checkable
-- and it is meant to be checked: `grep -n owner_sites supabase/setup.sql`
-- should show this file and nothing else.

comment on table public.owner_sites is
  'Which gyms a person owns, when that is more than the one on their profile. An explicit table and NOT a profiles column, because the platform lets people sign up as an owner — the same argument platform_admins is built on. It has no INSERT, UPDATE or DELETE policy for anybody: a row can only be written by the service role. It ships empty. GRANTING A ROW HERE GRANTS NO DATA: no policy in this schema reads this table, is_owner_of is unchanged, and an owner recorded against a second gym can read that gym''s name and nothing else. Widening that is a separate decision — see the part file.';
comment on column public.owner_sites.tenant_id is
  'The gym. A site is a tenant of its own; see the note on gym_classes.branch for why a branch column was not the answer.';
comment on column public.owner_sites.note is
  'Why this person owns this gym, for whoever reads this table in two years. Not an audit trail.';
comment on function public.my_sites() is
  'The gyms the caller is recorded as owning, as [{id, name, current}] — where `current` marks the ONE this session can actually read, the tenant is_owner_of() says yes to. Two fields per gym and no more: tenants_read is correctly scoped to one tenant, and the fix for a name behind it is a function that returns the name, not a policy that returns the row. Returns [] for a non-owner, and exactly one entry for an ordinary single-site owner.';

-- ── 4 · A SITE IS A TENANT. A branch is not. ────────────────────────────
--
-- This is the load-bearing call and it is expensive to undo, so it is written
-- down where somebody about to undo it will read it.
--
-- `gym_classes.branch` has existed since part 02 and looks like the beginning
-- of a multi-site model. It is not, and it must not be made into one.
--
-- THE CASE FOR branch-as-a-column, honestly stated: one login, one set of
-- membership plans, one price list, one roll-up for free, and an operator who
-- thinks of two rooms in one town as one business gets what they expect.
--
-- WHY IT LOSES:
--
--   1. It is a column on ONE table. `gym_visits`, `memberships`,
--      `gym_payments`, `gym_invoices`, `sessions`, `gym_equipment`, `gym_shifts`
--      and `gym_month_closes` have no branch and never had. Making branch the site
--      key means adding it to all of them AND adding `and branch = $1` to every
--      read in `src/lib` and every screen in `studio-web`. Isolation would then
--      live in roughly thirty screens' worth of remembering to filter, instead
--      of in the database. The first read anybody forgets is a blended figure
--      presented as one site's — which is the exact defect this work exists to
--      prevent, arriving by the door we opened for it.
--
--   2. Tenant-scoped things are already site-scoped things. `tenants.currency`
--      (part 150: there is no default currency), `session_fee`,
--      `session_pay_policy`, the brand, the join code, the membership plan
--      list, the gym invoice sequence and the month close are all per tenant —
--      and every one of them is per SITE in a real two-site operator. Two sites
--      in two countries do not share a currency; two sites anywhere do not
--      share an invoice sequence or a month-end close. A branch column would
--      have to grow a second copy of each of those settings, at which point a
--      branch IS a tenant with a worse name.
--
--   3. RLS already isolates tenants and has been narrowed four times to do it
--      properly. Site-as-tenant needs no new policy at all; the isolation is
--      the isolation that already exists and is already tested.
--
--   4. The cost of site-as-tenant is the roll-up and the login, and the
--      roll-up is a figure over two sites — which under this project's own
--      rules has to be labelled as covering two sites whichever way the schema
--      is drawn. So that cost is not avoided by the other design, only hidden.
--
-- WHAT `branch` IS, then: a free-text label for a place within one gym, the
-- same kind of thing as `room`. app/(trainer)/classes.tsx offers it as free
-- text with chips built from the gym's own past values, and app/(client)/
-- classes.tsx filters the timetable by it. Both are correct uses. What is NOT
-- correct is summing across it and calling the result the gym's: see
-- `branchSpan` in src/lib/ownedSites.ts, which is the guard for that.
comment on column public.gym_classes.branch is
  'A free-text label for a place WITHIN one gym — the same kind of thing as `room`, and offered to the trainer as free text with chips built from the gym''s own past values. It is NOT the multi-site key and must not be made into one: a site is a tenant of its own. The argument is in supabase/parts/290; the short form is that branch exists on this table alone, while currency, session fee, pay policy, invoice numbering and the month close are all per tenant and all per site, so a branch that carried a site would need a second copy of each of them. A figure summed across two branch values is not one branch''s figure — src/lib/ownedSites.ts branchSpan() is the guard.';

-- ── 5 · the decision this part deliberately leaves open ─────────────────
--
-- Letting one login READ two sites. Two designs, both of which someone has to
-- choose between with the live database in front of them:
--
--   (A) TEACH THE POLICIES ABOUT MEMBERSHIP. Either widen `is_owner_of` or add
--       a second owner-arm policy to every table. The first is the four-word
--       change argued against at the top of this file. The second is honest —
--       each widening is its own line in `pg_policies` — but it is sixty-odd
--       new policies across fifty-six tables, each of which is a place to get
--       it wrong once, and it permanently doubles the cost of every future
--       table.
--
--   (B) SWITCH WHICH SITE THE SESSION IS IN. A SECURITY DEFINER function that
--       checks `owner_sites` and then writes `profiles.tenant_id`. At any
--       instant the caller is the owner of exactly one tenant and every policy
--       stays exactly as narrow as it is today — the reader set at a point in
--       time is unchanged, which is why this is the safer-looking of the two.
--
--       It is not free, and these are the parts that need a human:
--
--        · `profiles.tenant_id` is the spine. Part 37 rewrites it when a MEMBER
--          moves gyms and part 39's `tenant_of_user` reads it. A switch is
--          therefore indistinguishable, in the row, from a move.
--        · `tenant_of_user` prefers `trainers.tenant_id` over the profile's. An
--          owner who also coaches has both, and switching one leaves the two
--          disagreeing — which decides who can read their coach roster.
--        · It is global and it persists. The phone app, a second browser tab
--          and any background job all move with it, and there is no session in
--          this design to hold "which site am I looking at" instead.
--        · Anything WRITTEN while switched belongs to the switched-to site.
--          That is correct, and it means a mis-switch writes a payment into the
--          wrong gym's books.
--
-- Neither is written here. What is written here is the record of who owns
-- what, which both designs need and neither can be built without.
