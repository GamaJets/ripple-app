-- ── What a coach claims, and what a client says ────────────────────────────
--
-- The two questions anybody asks before handing a stranger their body and
-- their money: what are you qualified to do, and what do the people you have
-- already trained say about you. Neither existed. A `trainers` row carries a
-- bio, a tagline, specialties, offers and a fee, and `app/(client)/trainers.tsx`
-- said so in a comment — "Ratings and review counts are gone — there is no
-- review system to feed them."
--
-- Two tables, and a hole in front of both that had to be closed first.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 0. THE HOLE: both halves of "is this person my client" were client-writable
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The gate on a review has to be "you are, or were, this coach's client", and
-- the database already records that in `coaching_relationships`. It records it
-- in a table the client could WRITE.
--
--     cr_self  for all
--       using       (coach_id = auth.uid() or client_id = auth.uid())
--       with check  (coach_id = auth.uid() or client_id = auth.uid())
--
-- `for all`, and a WITH CHECK that only asks whether one of the two ids is
-- yours. So any signed-in account could insert a row naming any coach and
-- themselves, status 'active'. Proved live as a real client under `set local
-- role authenticated` with her own uid in request.jwt.claims — an account with
-- no connection whatsoever to the coach:
--
--     insert into coaching_relationships (coach_id, client_id, mode, status)
--     values (<a coach she has never met>, <herself>, 'online', 'active');
--     -- 1 row
--
-- That is bad on its own, and it is worse than it looks, because it also
-- defeats a defence this repo already relies on. Part 130 returns a coach's
-- private profile to their client and is careful to demand BOTH halves of the
-- link — `clients.trainer_id` AND an active `coaching_relationships` row —
-- precisely so that neither alone is enough. But `clients` carries
--
--     client_self  for all  using (id = auth.uid())
--
-- with no WITH CHECK of its own, so the USING expression is reused for writes
-- and a client may set their own `trainer_id` to anybody. Both halves are the
-- client's to write, so "both halves" is one forgery, not two. Proved live, in
-- one transaction, as a client with no coach, against a coach who is NOT in
-- the directory and whose profile she therefore has no way to read:
--
--     update clients set trainer_id = <Frank> where id = <herself>;
--     insert into coaching_relationships (…, <Frank>, <herself>, 'active');
--     select * from my_coach_profile();
--     -- → Frank's name, tagline and bio
--
-- So before a single review row exists, this part closes both.
--
-- ── 0a. coaching_relationships loses the pen ───────────────────────────────
--
-- Every legitimate write already goes through a SECURITY DEFINER function that
-- bypasses RLS: `link_coaching` (parts 06 and 38) on a coach accepting a
-- request or an invitation, `join_by_code` (part 55) on a client redeeming a
-- code, `end_coaching` (part 68) on either party leaving. Nothing in the client
-- app, the coach app or the Studio inserts, updates or deletes one of these
-- rows as the user — grepped, and the four call sites that name the table
-- (`src/ui/roster.tsx`, `src/lib/photoShare.ts`, `studio-web/app/coach/page.tsx`,
-- `studio-web/app/coach/roster/page.tsx`) are all `.select(`.
--
-- Same shape and same argument as part 136 §2, which narrowed
-- `class_bookings_self` a few hours ago for the same reason: a `for all` policy
-- that everything real bypasses is not a convenience, it is an unguarded write.
drop policy if exists cr_self on public.coaching_relationships;
create policy coaching_relationships_self_r on public.coaching_relationships
  for select using (coach_id = (select auth.uid()) or client_id = (select auth.uid()));

-- ── 0b. clients keeps the pen, except on the one column that is a link ──────
--
-- `clients` cannot be narrowed to SELECT the way `coaching_relationships` was:
-- the client app writes its own row constantly — goal, mode, units, targets,
-- water goal, day types. Only `trainer_id` is a claim about somebody else, and
-- nothing anywhere in the three apps or the Studio writes it directly (grepped
-- for `trainer_id` next to insert/update/upsert; every hit is a different
-- table — sessions, trainer_availability, gym_classes, coach_clients,
-- trainer_packages, programs).
--
-- A column-level revoke cannot express this: in PostgreSQL a table-wide UPDATE
-- grant supersedes a column revoke, and re-granting UPDATE column by column
-- would freeze the column list of a table three other screens are still adding
-- to (part 131 has the worked example and the failed first attempt). A guard
-- trigger states the rule instead of enumerating the exceptions.
--
-- The `current_user` test is the one from part 38 and part 101, and it is only
-- ever sound in a NON-definer trigger: inside a SECURITY DEFINER function
-- `current_user` is the function's OWNER, so `link_coaching` and `end_coaching`
-- pass straight through while a direct write from an app — which arrives as the
-- shared `authenticated` role under PostgREST — does not. Parts 45, 47 and 68
-- all warn that a `current_user` guard inside a definer function reads as
-- protection while providing none; this function is deliberately not definer.
create or replace function public.guard_client_trainer_link()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and new.trainer_id is distinct from old.trainer_id then
    raise exception 'A client cannot set their own coach. Coaching starts with a code, an invitation or a directory request, and ends with end_coaching().'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

drop trigger if exists guard_client_trainer_link_t on public.clients;
create trigger guard_client_trainer_link_t
  before update on public.clients
  for each row execute function public.guard_client_trainer_link();

comment on function public.guard_client_trainer_link() is
  'Stops a client writing clients.trainer_id from the app. Deliberately NOT security definer: current_user is the caller''s role only in an invoker-rights trigger, which is what lets link_coaching() and end_coaching() through and keeps a direct PostgREST update out.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CREDENTIALS — and the word this table is not allowed to say
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A certification is a claim until somebody checks it. Repple has no document
-- store, no reviewer, and no relationship with REPs, CIMSPA, NASM, ACE or any
-- insurer's policy API — so Repple cannot check one, and a product that prints
-- a tick next to a self-typed line of text is telling a client something it
-- does not know. The client then trains with somebody on the strength of it.
--
-- ── What verification would actually cost ──────────────────────────────────
--
-- Written down here because "we'll verify later" is the kind of intention that
-- turns into a badge nobody re-examined:
--
--   · A private document store (a certificate PDF is a named individual's
--     record — the same argument part 91 makes about injury documents, which
--     are visible to their owner and never to the coach) plus signed-URL reads.
--   · A human who looks at each one. At a few minutes per credential this is
--     the only real cost, and it recurs — certifications expire, insurance
--     renews annually, and a badge that is not re-checked at renewal is a
--     badge that says "insured" about a lapsed policy.
--   · Per-body verification where an API exists (REPs and CIMSPA publish
--     register lookups; most insurers do not), which changes the cost but not
--     the recurrence.
--
-- Until that exists, `verification` is 'self_declared' for every row, and the
-- SCHEMA is what guarantees it rather than the screen: `authenticated` is
-- granted INSERT and UPDATE on the declared columns ONLY. A coach physically
-- cannot write `verification`, `verified_at` or `verified_by`, from the app or
-- from a hand-rolled PostgREST call. The column exists so the honest path is
-- additive rather than a migration, and only a service-role reviewer can set
-- it. `src/lib/coachCredentials.ts` refuses to render a verified badge for a
-- 'self_declared' row, and its test asserts the wording never says "verified",
-- "checked" or "confirmed" — belt, braces, and a third thing.
--
-- ── Not tenant-scoped, on purpose ──────────────────────────────────────────
--
-- A qualification belongs to the person, not the premises. A coach who moves
-- gyms does not re-sit their Level 3, and their insurance does not lapse at the
-- door. So there is no tenant_id here and the rows follow the coach.
--
-- ── `reference` is public, and that is the point ───────────────────────────
--
-- A registration number is the one thing that makes a self-declared claim
-- checkable BY THE READER: "REPs R123456" can be typed into the REPs register
-- by the client, which is a better answer than a badge Repple invented. So it
-- is stored and shown. The credentials screen offers the field for a
-- CERTIFICATION and not for an INSURANCE policy — an insurance policy number is
-- not publicly checkable by anyone, so publishing it buys the reader nothing
-- and hands a stranger a number that identifies a real policy.
create table if not exists public.coach_credentials (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('certification', 'insurance')),
  -- "Level 3 Personal Trainer", or "Public liability".
  title         text not null check (btrim(title) <> ''),
  -- The awarding body, or the insurer.
  issuer        text,
  -- Registration / certificate number. See the header: certifications only.
  reference     text,
  issued_on     date,
  -- Null is a real answer for a lifetime qualification, and a different answer
  -- from a date in the past. src/lib/coachCredentials.ts keeps them apart.
  expires_on    date,
  verification  text not null default 'self_declared'
                check (verification in ('self_declared', 'verified')),
  verified_at   timestamptz,
  verified_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A 'verified' row with no timestamp and no reviewer is a badge nobody signed.
  constraint coach_credentials_verified_has_provenance
    check (verification <> 'verified' or (verified_at is not null and verified_by is not null)),
  constraint coach_credentials_dates_ordered
    check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create index if not exists coach_credentials_coach_idx
  on public.coach_credentials (coach_id, kind, expires_on);

alter table public.coach_credentials enable row level security;

-- The coach owns their own rows outright.
drop policy if exists coach_credentials_self_rw on public.coach_credentials;
create policy coach_credentials_self_rw on public.coach_credentials
  for all using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- A listed coach's credentials are directory information: the whole point of
-- publishing a profile is to be assessed. `trainers_public_directory_r`
-- (`listed = true`) is the same door the bio and the specialties come through,
-- and this policy is a subquery over it, so an unlisted coach's rows are not
-- reachable this way. No recursion: no policy on `trainers` mentions this table.
drop policy if exists coach_credentials_directory_r on public.coach_credentials;
create policy coach_credentials_directory_r on public.coach_credentials
  for select to authenticated using (exists (
    select 1 from public.trainers t
     where t.id = coach_credentials.coach_id and t.listed = true));

-- And the person actually being coached, whose coach is usually NOT listed —
-- part 130's whole argument. On `coaching_relationships` rather than
-- `clients.trainer_id` because §0 has just made one of the two forgeable-free
-- and left the other as a column a client may not write; either would now do,
-- and the relationship is the record that says the coaching is live.
drop policy if exists coach_credentials_client_r on public.coach_credentials;
create policy coach_credentials_client_r on public.coach_credentials
  for select to authenticated using (exists (
    select 1 from public.coaching_relationships r
     where r.coach_id = coach_credentials.coach_id
       and r.client_id = (select auth.uid())
       and r.status = 'active'));

-- Supabase's default privileges hand `anon`, `authenticated` and `service_role`
-- ALL on every new table in `public`, so this starts by taking it back. RLS
-- narrows a GRANT; it does not confer one, and it does not select columns —
-- which is exactly why the write grants below are enumerated.
revoke all on public.coach_credentials from public, anon, authenticated;

-- `verified_by` is deliberately absent: which Repple reviewer signed a
-- credential off is not directory information.
grant select (id, coach_id, kind, title, issuer, reference,
              issued_on, expires_on, verification, verified_at,
              created_at, updated_at)
  on public.coach_credentials to authenticated;

-- The three verification columns are absent from BOTH of these, which is the
-- enforcement described in the header. A table-wide grant here would supersede
-- any column revoke, so there must not be one.
grant insert (coach_id, kind, title, issuer, reference, issued_on, expires_on)
  on public.coach_credentials to authenticated;
grant update (kind, title, issuer, reference, issued_on, expires_on)
  on public.coach_credentials to authenticated;
grant delete on public.coach_credentials to authenticated;

-- `anon` gets nothing. The directory is behind sign-in and there is no
-- unauthenticated reader of this table.

create or replace function public.touch_coach_credential()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists touch_coach_credential_t on public.coach_credentials;
create trigger touch_coach_credential_t
  before update on public.coach_credentials
  for each row execute function public.touch_coach_credential();

-- `touch_coach_credential` and `guard_client_trainer_link` above keep their
-- default EXECUTE here, and neither is SECURITY DEFINER. Called directly they
-- raise "trigger functions can only be called as triggers". The
-- revoke-from-public-AND-anon rule is about definer functions, and every
-- definer function in §2 below has it.
--
-- ── THE REASON THIS ORIGINALLY GAVE WAS WRONG — read 141 instead ──────────
--
-- It said the two "must" keep their EXECUTE, because "a trigger function runs
-- as the role performing the write, so revoking EXECUTE from `authenticated`
-- would make the table unwritable rather than more private."
--
-- Postgres does not work that way. It checks EXECUTE on a trigger function when
-- the TRIGGER IS CREATED, not each time it fires — which is what
-- 51-advisor-tidy.sql, 141-the-grants-that-came-back.sql and part 146 all say,
-- and they are right. 141 §2 then revokes EXECUTE from public, anon AND
-- authenticated on every non-extension trigger function in `public`, these two
-- included, and it sorts after this file. `coach_credentials` is still
-- writable, which is the proof.
--
-- The sentence is corrected rather than deleted because it stated a general
-- rule about trigger privileges that is the opposite of the one this schema is
-- built on, next to the only two trigger functions in the file — the exact
-- place somebody would come to learn it.
comment on table public.coach_credentials is
  'Certifications and insurance a coach STATES about themselves. verification is ''self_declared'' for every row written through the API — authenticated holds no INSERT or UPDATE grant on verification, verified_at or verified_by, so a coach cannot mark their own claim checked. Nothing in the product may present one of these as verified by Repple.';
comment on column public.coach_credentials.reference is
  'Registration or certificate number, shown publicly so a reader can check it with the issuer themselves. The credentials screen offers it for certifications only — an insurance policy number is checkable by nobody and identifies a live policy.';
comment on column public.coach_credentials.verification is
  'Only a service-role reviewer can write ''verified''. See supabase/parts/139 for what verifying would actually cost.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. REVIEWS — a named person's livelihood
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Who may write one ──────────────────────────────────────────────────────
--
-- Somebody who is, or was, this coach's client. `coaching_relationships`
-- status 'active' or 'ended' — and emphatically NOT 'pending', because
-- `join_by_code` creates a pending row for anyone holding a six-character code
-- a coach has handed out. Gating on "a row exists" would let a code holder who
-- was never accepted review the coach who declined them.
--
-- 'ended' counts, and it is the more important of the two. The most honest
-- review is written by somebody who has finished, and a system that only hears
-- from current clients only hears from people who are still paying.
--
-- ── One review per client per coach, editable, withdrawable, answerable ────
--
-- `unique (coach_id, client_id)`. Re-writing replaces, which means a client who
-- changed their mind updates rather than stacking. Withdrawal is a timestamp,
-- not a delete: the row keeps the coach's reply and the unique key, and writing
-- again clears it.
--
-- Editing CLEARS the coach's reply. A reply that stays attached to rewritten
-- text puts words under a review the coach never read, which misrepresents the
-- coach — the exact harm the right of reply exists to prevent. The client is
-- told this before they save.
--
-- The right of reply is the reason this is safe to ship at all. A one-way
-- channel from a client to a public profile, with no answer from the person
-- being described, is how a misunderstanding becomes somebody's livelihood.
-- `reply_to_coach_review` is the coach's, and it is public alongside the review.
--
-- ── What is NOT here, and is a real gap ────────────────────────────────────
--
-- There is no takedown. A defamatory review can be answered but not removed
-- except by a service-role operator with SQL access, because a moderation queue
-- is a screen, a role and a decision record, and guessing at those would be
-- worse than naming the gap. Right of reply is the mechanism this ships with.
--
-- ── Reviews are not anonymous, and the client is told so ───────────────────
--
-- Only a first name is exposed, to every reader including the coach — never a
-- full name, never a user id, never an avatar. But the writer pool is the
-- coach's own roster, so a coach can usually work out who wrote it, and
-- `src/ui/reviews.ts` says so in the words the client reads before saving.
-- Pretending otherwise would be the dishonest option. A full name would add
-- nothing for a stranger reading the directory and would add identification
-- power whose main use is retaliation.
--
-- ── Multi-tenant: shown across gyms, labelled by gym ───────────────────────
--
-- This product is white-label; a review earned at one gym is not automatically
-- evidence about the same coach's work at another. The tempting rule is to
-- scope reviews to the reading tenant.
--
-- Rejected, because the directory itself is not tenant-scoped —
-- `trainers_public_directory_r` is `listed = true` full stop, and
-- `app/(client)/trainers.tsx` queries it with no tenant filter — so a
-- tenant-scoped review read would show a coach with a dozen reviews to their
-- own gym's members and a bare "No reviews yet" to everyone else. That is a
-- false statement about somebody's record, made by omission, and it is the same
-- class of harm as reporting a failed read as an empty one.
--
-- So every review is shown, and each carries the gym it was written under when
-- that differs from the reader's — `tenant_id` is stamped at write time from
-- the COACH's `trainers.tenant_id`, which is where the work was actually
-- happening, and stamped rather than joined so that a coach moving gyms does
-- not retroactively re-attribute their history. The reader gets the record and
-- the context to weigh it, which is what the honest version of this looks like.
create table if not exists public.coach_reviews (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references public.profiles(id) on delete cascade,
  client_id       uuid not null references public.profiles(id) on delete cascade,
  -- Where the coaching was happening when this was written. Nullable and
  -- ON DELETE SET NULL: a gym closing must not delete its coaches' records.
  tenant_id       uuid references public.tenants(id) on delete set null,
  rating          smallint not null check (rating between 1 and 5),
  body            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  edited          boolean not null default false,
  withdrawn_at    timestamptz,
  coach_reply     text,
  coach_replied_at timestamptz,
  unique (coach_id, client_id),
  constraint coach_reviews_not_self check (coach_id <> client_id),
  constraint coach_reviews_reply_has_time
    check ((coach_reply is null) = (coach_replied_at is null))
);

create index if not exists coach_reviews_coach_live_idx
  on public.coach_reviews (coach_id, created_at desc)
  where withdrawn_at is null;
create index if not exists coach_reviews_client_idx
  on public.coach_reviews (client_id);

alter table public.coach_reviews enable row level security;

-- No policy, and no grant to `authenticated` or `anon`. Deliberate, and it is
-- the tighter of the two available answers.
--
-- RLS selects ROWS, never columns, so any policy wide enough to show a review
-- to a stranger browsing the directory also hands over `client_id` — the
-- reviewer's account id, against their rating of a named person. There is no
-- column grant that fixes it either, because the row a coach reads and the row
-- a stranger reads need DIFFERENT columns, and a grant is per-role.
--
-- So the table is unreachable over PostgREST — a select returns 42501, not an
-- empty list — and every read is a SECURITY DEFINER function below that names
-- its columns. Part 130 makes this argument for `trainers`; it is stronger here
-- because the withheld column identifies a third party rather than the subject.
revoke all on public.coach_reviews from public, anon, authenticated;

-- ── 2a. The gate, on its own, because two things need it ───────────────────
--
-- Definer because `coaching_relationships` is now SELECT-only to its two
-- parties and this has to be callable by the client BEFORE they write. Takes a
-- coach id and answers only about the caller's own history, so the worst a
-- probe learns is whether the prober themselves was that coach's client.
create or replace function public.can_review_coach(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.coaching_relationships r
     where r.coach_id   = p_coach
       and r.client_id  = auth.uid()
       and r.status in ('active', 'ended'));
$function$;

revoke execute on function public.can_review_coach(uuid) from public, anon;
grant  execute on function public.can_review_coach(uuid) to authenticated;

-- ── 2b. Writing one ────────────────────────────────────────────────────────
--
-- Returns a WORD rather than raising, so the screen can say which of the four
-- refusals happened. A zero-row write over PostgREST is not an error and never
-- reaches a client as one — the reason every write path in this part is a
-- function with a return value rather than an insert behind a policy.
create or replace function public.write_coach_review(
  p_coach uuid, p_rating int, p_body text)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  v_tenant uuid;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if v_me is null then return 'signed_out'; end if;
  if p_coach is null or p_coach = v_me then return 'self'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then return 'invalid_rating'; end if;
  if not public.can_review_coach(p_coach) then return 'not_a_client'; end if;

  -- Where the coaching was happening, taken from the record and not from the
  -- caller, who has every reason to be wrong about it and no way to be right.
  select t.tenant_id into v_tenant from public.trainers t where t.id = p_coach;

  insert into public.coach_reviews (coach_id, client_id, tenant_id, rating, body)
  values (p_coach, v_me, v_tenant, p_rating::smallint, v_body)
  on conflict (coach_id, client_id) do update
    set rating           = excluded.rating,
        body             = excluded.body,
        updated_at       = now(),
        edited           = true,
        withdrawn_at     = null,
        -- See the header: a reply must not survive the text it answered.
        coach_reply      = null,
        coach_replied_at = null;
  return 'written';
end
$function$;

revoke execute on function public.write_coach_review(uuid, int, text) from public, anon;
grant  execute on function public.write_coach_review(uuid, int, text) to authenticated;

-- ── 2c. Taking it back ─────────────────────────────────────────────────────
create or replace function public.withdraw_coach_review(p_coach uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rows int;
begin
  if auth.uid() is null then return false; end if;
  update public.coach_reviews
     set withdrawn_at = now(), updated_at = now()
   where coach_id = p_coach
     and client_id = auth.uid()
     and withdrawn_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$function$;

revoke execute on function public.withdraw_coach_review(uuid) from public, anon;
grant  execute on function public.withdraw_coach_review(uuid) to authenticated;

-- ── 2d. The answer back ────────────────────────────────────────────────────
--
-- An empty reply removes it, which is how a coach retracts something written in
-- the first ten minutes. `coach_replied_at` moves with the text so the pair can
-- never disagree — the CHECK constraint on the table refuses the state where
-- one is set and the other is not.
create or replace function public.reply_to_coach_review(p_review uuid, p_reply text)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_text text := nullif(btrim(coalesce(p_reply, '')), '');
  v_rows int;
begin
  if auth.uid() is null then return false; end if;
  update public.coach_reviews
     set coach_reply      = v_text,
         coach_replied_at = case when v_text is null then null else now() end
   where id = p_review
     and coach_id = auth.uid()
     and withdrawn_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$function$;

revoke execute on function public.reply_to_coach_review(uuid, text) from public, anon;
grant  execute on function public.reply_to_coach_review(uuid, text) to authenticated;

-- ── 2e. Reading them ───────────────────────────────────────────────────────
--
-- `client_id` is not in the return type and cannot be got at. The reviewer is a
-- FIRST NAME — `split_part` on the first space — and null when there is no name
-- on the profile, which the screen renders as "A client" rather than inventing
-- one.
--
-- `tenant_name` is filled ONLY when the review was written under a different
-- gym from the reader's, which is the whole of the multi-tenant disclosure: a
-- reader in the coach's own gym sees nothing extra, and a reader elsewhere is
-- told where the work happened. A gym's trading name is public information
-- about a business; the reviewer's is not, and is not returned.
--
-- Withdrawn reviews are excluded here for everybody, the author included —
-- `my_review_of` is where the author sees their own withdrawn row.
create or replace function public.coach_reviews_for(p_coach uuid)
returns table (
  review_id        uuid,
  rating           smallint,
  body             text,
  created_at       timestamptz,
  updated_at       timestamptz,
  edited           boolean,
  reviewer_name    text,
  other_gym        text,
  coach_reply      text,
  coach_replied_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select r.id,
         r.rating,
         r.body,
         r.created_at,
         r.updated_at,
         r.edited,
         nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''),
         case when r.tenant_id is distinct from
                   (select me.tenant_id from public.profiles me where me.id = auth.uid())
              then (select tn.name from public.tenants tn where tn.id = r.tenant_id)
         end,
         r.coach_reply,
         r.coach_replied_at
    from public.coach_reviews r
    left join public.profiles p on p.id = r.client_id
   where r.coach_id = p_coach
     and r.withdrawn_at is null
     and auth.uid() is not null
     -- Exactly the three readers a review is for: anyone browsing a published
     -- profile, the coach it names, and the client being coached by them.
     and (
       exists (select 1 from public.trainers t where t.id = p_coach and t.listed = true)
       or p_coach = auth.uid()
       or public.can_review_coach(p_coach)
     )
   order by r.created_at desc;
$function$;

revoke execute on function public.coach_reviews_for(uuid) from public, anon;
grant  execute on function public.coach_reviews_for(uuid) to authenticated;

-- ── 2f. The caller's own review of a coach ─────────────────────────────────
--
-- So the client screen can show what they already said, prefill an edit, and
-- tell them a withdrawn review is withdrawn rather than missing.
create or replace function public.my_review_of(p_coach uuid)
returns table (
  review_id        uuid,
  rating           smallint,
  body             text,
  created_at       timestamptz,
  updated_at       timestamptz,
  edited           boolean,
  withdrawn_at     timestamptz,
  coach_reply      text,
  coach_replied_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select r.id, r.rating, r.body, r.created_at, r.updated_at, r.edited,
         r.withdrawn_at, r.coach_reply, r.coach_replied_at
    from public.coach_reviews r
   where r.coach_id = p_coach
     and r.client_id = auth.uid();
$function$;

revoke execute on function public.my_review_of(uuid) from public, anon;
grant  execute on function public.my_review_of(uuid) to authenticated;

-- ── 2g. The number on a directory row ──────────────────────────────────────
--
-- One call for the whole directory page rather than one per coach. Returns the
-- COUNT and the SUM, not an average: whether a handful of ratings may be shown
-- as a single figure is a judgement about how much a number claims, and it is
-- made once in `src/lib/reviews.ts` where it can be asserted on, not separately
-- by each screen that happens to divide.
--
-- The same three-reader gate as 2e, applied per coach, so an unlisted coach's
-- count is not enumerable by anyone who is not their client.
create or replace function public.coach_review_summary(p_coaches uuid[])
returns table (coach_id uuid, rating_count int, rating_sum int)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select r.coach_id, count(*)::int, sum(r.rating)::int
    from public.coach_reviews r
   where auth.uid() is not null
     and r.coach_id = any (coalesce(p_coaches, '{}'::uuid[]))
     and r.withdrawn_at is null
     and (
       exists (select 1 from public.trainers t where t.id = r.coach_id and t.listed = true)
       or r.coach_id = auth.uid()
       or public.can_review_coach(r.coach_id)
     )
   group by r.coach_id;
$function$;

revoke execute on function public.coach_review_summary(uuid[]) from public, anon;
grant  execute on function public.coach_review_summary(uuid[]) to authenticated;

comment on table public.coach_reviews is
  'Reviews of a coach by their clients. NO grant to authenticated or anon: every read is a SECURITY DEFINER function that names its columns, because RLS selects rows and any row-wide read would expose client_id — the reviewer''s identity — to strangers browsing the directory.';
comment on column public.coach_reviews.tenant_id is
  'The coach''s tenant when the review was written, stamped by write_coach_review from the record rather than taken from the caller. Reviews are shown across tenants and labelled with this one when it differs from the reader''s.';
comment on function public.can_review_coach(uuid) is
  'Whether the caller is, or was, this coach''s client. Status ''active'' or ''ended'' — never ''pending'', which join_by_code creates for anybody holding a code.';

-- ── Deliberately NOT done here ─────────────────────────────────────────────
--
-- 1. No moderation or takedown. Named above as a real gap rather than guessed
--    at; the right of reply is what ships.
--
-- 2. No rating on `trainers`. A denormalised average is a second copy of a
--    number that has to be kept true by a trigger, and the summary function
--    reads an indexed partial count instead.
--
-- 3. `coach_requests` is NOT the review gate, even though it is the other table
--    that records a client asking for a coach. A request is something a
--    stranger can send from the directory; it says nothing about whether anyone
--    was ever coached.
--
-- 4. The owner console still cannot see its trainers' credentials. The tables
--    are the coach's and the reader's, `is_owner_of` appears in no policy here,
--    and a gym owner checking their floor staff's insurance is a screen in an
--    app this part's author does not own. Adding an owner policy without that
--    screen in front of it would be a guess at what it needs to show.
