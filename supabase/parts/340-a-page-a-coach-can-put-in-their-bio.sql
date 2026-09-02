-- ═══════════════════════════════════════════════════════════════════════════
-- A page a coach can put in their bio.
--
-- `trainers.listed` puts a coach in Find a Trainer, which is a screen inside
-- the client app behind a sign-in. A coach's own audience — the people already
-- watching them on Instagram, the person handed a card at a gym door — cannot
-- see it, and there was no address anywhere in this product a coach could point
-- them at. Their next client comes from that audience and Repple gave them
-- nothing to send it to.
--
-- This part is the database half of that page. `web/coach.html` is the page;
-- `src/lib/publicProfile.ts` holds every rule about what may be on it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · CONSENT: the directory opt-in is not consent to the open web
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `listed` is a per-coach switch that says "clients browsing Repple can see
-- me". A page on the open web is a wider audience than that by a long way: no
-- sign-in, no account, indexable, forwardable, and readable by the coach's
-- employer, their previous employer and anybody they have ever trained. Reading
-- `listed = true` as permission to publish would be this product deciding on a
-- coach's behalf that the two are the same thing.
--
-- So there is a SECOND switch, `public_page`, off by default, and it is built
-- ON TOP of the first rather than beside it:
--
--   · a page requires BOTH `listed` and `public_page`. The read function below
--     demands both, and so does the trigger;
--   · turning `listed` off takes the page down, in the same statement, without
--     the coach having to think of it. That is the trigger's whole job —
--     `set_my_public_page` is not the only way `listed` moves (the profile
--     screen writes it through the ordinary debounced update), and a coach who
--     leaves the directory and finds their bio link still live has been let
--     down by us and not by their own tap.
--
-- The second half matters because of what the page carries. `coach_reviews_for`
-- and `coach_review_summary` (part 139) show a review to a stranger only when
-- `listed = true`; a summary of those same reviews on a public page has to sit
-- behind the same condition or the reviewers' expectations and the product have
-- parted company.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · WHAT IS ON THE PAGE, AND THE THREE THINGS DELIBERATELY LEFT OFF
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ON IT: the coach's trading name or their own name, their accent colour, their
-- tagline, their bio, their specialties, what they offer, their session fee
-- WITH its currency, the qualifications and insurance they have stated, an
-- aggregate of their reviews, and their join code so an arrival is attributed.
-- Every one of those is something the coach typed about themselves.
--
-- ── NOT ON IT · a single word a client wrote ──────────────────────────────
--
-- `coach_reviews` has no policy and no grant to `authenticated`, and part 139
-- gives the reason: RLS selects ROWS and never columns, so any policy wide
-- enough to show a review to a stranger also hands over `client_id`. Both
-- existing readers are SECURITY DEFINER functions that name their columns, and
-- BOTH are revoked from `anon` and open `where auth.uid() is not null`. Neither
-- can serve an unauthenticated page at all, which is the first answer: the
-- existing RPCs cannot do this.
--
-- The second answer is that they should not be extended to. `coach_reviews_for`
-- returns `reviewer_name` — the reviewer's first name — and `other_gym`, the
-- gym they trained at. In the app that pair is shown to a signed-in reader, and
-- `IDENTITY_NOTE` in src/lib/reviews.ts is the promise made to the reviewer
-- before they write: "your first name is shown with your review. Your coach can
-- probably work out it was you." That sentence describes a screen inside the
-- app. It is not consent to a first name plus a paragraph about somebody's body
-- on a crawlable URL, and the reviewer is not the person who gets to opt into
-- this page — the coach is. Part 139 also records, in its own words, that there
-- is no moderation and no takedown, so a public review page would have no
-- remedy behind it either.
--
-- So this publishes THE SUMMARY ONLY: a count and a sum. No body, no name, no
-- gym, no date, no coach's reply, and no review id. `src/lib/reviews.ts` decides
-- what a count and a sum may be made to say — below MIN_FOR_AVERAGE there is no
-- average, and there is no branch in that file that can produce one — and the
-- page uses those same functions rather than dividing for itself.
--
-- ── NOT ON IT · an expired credential ─────────────────────────────────────
--
-- `coach_credentials` carries expiry dates and part 202's nightly job tells a
-- coach when one lapses. In the app an expired row stays visible and sorts last
-- (`sortCredentials`), because a signed-in prospect is entitled to see that a
-- coach has one that ran out and is in a position to ask about it.
--
-- A public page is skimmed by somebody who cannot ask anybody anything, and
-- "Level 3 Personal Trainer" in a list reads as a current qualification however
-- carefully the small print under it is worded. So an expired row is filtered
-- out HERE, in SQL, and never leaves the database towards a public URL. The
-- coach loses a line; nothing false is said; and `credentialsSummaryLine`
-- already counts only live qualifications, so this is the rule the app applies
-- to its own summary applied to the page.
--
-- ── NOT ON IT · any suggestion that Repple checked anything ───────────────
--
-- Only `verification = 'self_declared'` rows are returned. Nothing in any of
-- the three apps can write 'verified' — part 139 withholds the write grant on
-- those columns from `authenticated` entirely — so today that filter excludes
-- nothing at all. It is here so that the day a review process does ship, it
-- ships with wording of its own rather than inheriting a page whose fixed
-- sentence says Repple has not looked at any of this. `verified_at` and
-- `verified_by` are not in the return type at all.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · THE ADDRESS, AND WHY IT IS NOT THE JOIN CODE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The obvious handle was the join code: unique already, already the thing a
-- coach puts in a bio, and it would make the join link on the page free.
--
-- It is the wrong one. A function that answers for a real code and not for an
-- invented one is an enumeration oracle over a credential, which is the exact
-- thing part 141 closed and part 157 was written around — `leave_my_details`
-- returns void for every input on purpose so that the marketing site "cannot be
-- used to tell a real join code from a made-up one". A public lookup keyed on
-- the code would put that oracle back on the same site, one page over. Codes
-- also rotate (parts 81 and 98), and an address that dies when a coach presses
-- "New code" is an address they cannot print.
--
-- So the address is a handle the coach chooses: 3 to 30 characters, lowercase,
-- digits and hyphens, no leading or trailing hyphen. Confirming a handle exists
-- reveals nothing the page itself does not already publish, which is what makes
-- it safe to answer for.
--
-- The join CODE is still returned — it is what the page's join link carries, so
-- that somebody arriving from a coach's bio is attributed to them exactly as
-- `codeFromUrl` in src/lib/adMatch.ts already attributes an ad click. Part 131
-- keeps join codes off the directory because a code anybody can lift off a
-- listing is a code whose numbers mean nothing; this is the opposite situation
-- — the coach is publishing their own link deliberately, and handing it out is
-- the entire purpose of the page.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · WHY THE HANDLE COLUMN HAS NO UPDATE GRANT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Part 152 revoked table-wide INSERT and UPDATE on `trainers` and granted back
-- a named column list. Neither column added here is in it, and neither is added
-- to it: both move only through `set_my_public_page()` below, which is the one
-- place that can check the shape, the reserved list, the collision and the
-- directory opt-in together and answer in a word.
--
-- The alternative was letting the profile screen write them through its
-- ordinary debounced update. That update is fire-and-forget — `.then(() => {},
-- () => {})` — so a unique violation on a taken handle would be swallowed and
-- the coach would be left looking at a handle they do not own.
--
-- The shape is a CHECK constraint and the collision is a unique index, so
-- neither is merely the function's opinion. The RESERVED list is enforced by
-- the function alone, and that is deliberate rather than a gap: a CHECK
-- constraint calling a function is re-evaluated on every update to the row, by
-- whoever issues it, so it would put a live EXECUTE grant on the reserved list
-- in the path of the coach's ordinary profile write and break that write the
-- day a sweep like part 141's took the grant away. With no UPDATE grant on the
-- column there is exactly one door, and the check belongs on it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the two columns ─────────────────────────────────────────────────────────
alter table public.trainers add column if not exists public_page   boolean not null default false;
alter table public.trainers add column if not exists public_handle text;

comment on column public.trainers.public_page is
  'Whether this coach has asked for a page on the OPEN WEB. Separate from `listed`, which is the in-app directory, and useless without it: public_coach_page() demands both, and a trigger clears this the moment `listed` goes false. Off by default and never set on a coach''s behalf.';
comment on column public.trainers.public_handle is
  'The coach''s own address on the marketing site — /coach?h=<handle>. Deliberately NOT the join code: a lookup keyed on the code would be an enumeration oracle over a credential (parts 141, 157) and would die every time the code rotated. No UPDATE grant: it moves only through set_my_public_page().';

-- ── the names a handle may not be ───────────────────────────────────────────
--
-- Every top-level path the site serves, plus the words somebody would read as
-- Repple speaking rather than as a coach. A coach at /coach?h=support is a
-- coach who can be mistaken for us.
--
-- A function rather than a literal, so that when this list grows there is one
-- place to grow it. `src/lib/publicProfile.ts` carries the same set for the
-- coach-facing message and `src/lib/publicProfile.test.ts` parses the array
-- below and fails if the two part company — the same arrangement
-- `joinPage.test.ts` holds over the brand table baked into web/join.html.
--
-- Called only from inside set_my_public_page(), which is SECURITY DEFINER, so
-- nobody outside needs EXECUTE and nobody outside gets it. It is NOT used in a
-- CHECK constraint; §4 explains why not.
create or replace function public.reserved_public_handles()
returns text[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select array[
    'account','admin','api','app','apps','badges','blog','brand','client','clients',
    'coach','coaches','confirmed','connect','contact','delete-account','download',
    'faq','favicon','forgot-password','help','home','how-it-works','index','join',
    'legal','login','logout','me','new','none','null','owner','play','press',
    'pricing','privacy','profile','register','repple','reset-password','root',
    'security','settings','signin','signup','sitemap','staff','static','studio',
    'support','terms','test','trainer','trainers','undefined','user','www'
  ]::text[];
$function$;

comment on function public.reserved_public_handles() is
  'Handles a coach may not take: every top-level path web/ serves, plus the words that would read as Repple speaking rather than as a coach. Called only by set_my_public_page(), which is the only write path to trainers.public_handle.';

revoke execute on function public.reserved_public_handles() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainers'::regclass and conname = 'trainers_public_handle_shape'
  ) then
    alter table public.trainers add constraint trainers_public_handle_shape
      check (public_handle is null or public_handle ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');
  end if;
end $$;

-- One coach per address. The shape constraint already forces lower case, so a
-- plain unique index is case-insensitive by construction and there is no
-- functional index for a later reader to wonder about.
create unique index if not exists trainers_public_handle_key
  on public.trainers (public_handle) where public_handle is not null;

-- ── the page follows the listing, always ────────────────────────────────────
--
-- Not a CHECK constraint. A check would REFUSE the update that turns `listed`
-- off while a page is live, and that update arrives from the profile screen's
-- debounced write, which discards its errors — so the coach would tap the
-- directory switch off, watch it go off, and leave their page standing. A
-- BEFORE trigger cannot fail and cannot be forgotten.
create or replace function public.public_page_follows_listing()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not coalesce(new.listed, false) then new.public_page := false; end if;
  if new.public_handle is null then new.public_page := false; end if;
  return new;
end
$function$;

revoke execute on function public.public_page_follows_listing() from public, anon, authenticated;

drop trigger if exists trainers_public_page_follows_listing on public.trainers;
create trigger trainers_public_page_follows_listing
  before insert or update on public.trainers
  for each row execute function public.public_page_follows_listing();

-- ═══════════════════════════════════════════════════════════════════════════
-- THE PAGE'S ONE READ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row, or none. `anon` may execute it, which makes it the second anon entry
-- point in this database after `leave_my_details`, and it is held to the same
-- rules: it names every column it returns, it returns nothing for a coach who
-- has not opted in, and a handle nobody holds is indistinguishable from a coach
-- who has switched their page off — both are zero rows.
--
-- The page treats zero rows and a failed call as DIFFERENT states and says two
-- different things, because an empty profile under a failed read is a coach who
-- looks like they have nothing. That distinction is the caller's to make and it
-- is made in web/coach.html; nothing here can help it, which is exactly why
-- this returns rows rather than a status word.
--
-- `session_fee` comes with `currency` or it does not appear. The currency is
-- the gym's (`tenants.currency`, part 99) and it is nullable on purpose — part
-- 242 makes the same journey for the in-app directory and its header explains
-- why a second `trainers.session_fee_currency` was refused. A null currency
-- here means the page prints no price at all rather than a bare number in
-- whatever money the reader happens to be thinking in.
--
-- A `session_fee` of 0 is treated as unset, matching src/ui/coachProfile.tsx:
-- the column defaulted to 0 for rows created before it was nullable, three of
-- the eight rows on production still hold one, and a "0" on a public page is a
-- coach advertising that they work for nothing.
create or replace function public.public_coach_page(p_handle text)
returns table (
  display_name  text,
  brand_color   text,
  tagline       text,
  bio           text,
  specialties   text[],
  offers        text[],
  session_fee   numeric,
  currency      text,
  join_code     text,
  rating_count  int,
  rating_sum    int,
  credentials   jsonb
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    -- The trading name they chose, else the name their clients already know
    -- them by. Never both, and never a blank under a heading.
    coalesce(nullif(btrim(coalesce(t.brand_name, '')), ''),
             nullif(btrim(coalesce(p.full_name,  '')), '')),
    t.brand_color,
    nullif(btrim(coalesce(t.tagline, '')), ''),
    nullif(btrim(coalesce(t.bio, '')), ''),
    t.specialties,
    t.offers,
    case when t.session_fee is not null and t.session_fee > 0 then t.session_fee end,
    tn.currency,
    nullif(btrim(coalesce(t.join_code, '')), ''),
    coalesce(r.n, 0),
    coalesce(r.s, 0),
    coalesce(c.items, '[]'::jsonb)
  from public.trainers t
  left join public.profiles p  on p.id  = t.id
  left join public.tenants  tn on tn.id = t.tenant_id
  -- A count and a sum. Not an average: whether a handful of ratings may be
  -- shown as one figure is a judgement about how much a number claims, and part
  -- 139 already made it once, in src/lib/reviews.ts, where it can be asserted
  -- on. `client_id`, `body`, `coach_reply` and the review id are not selected
  -- and are not in the return type.
  left join lateral (
    select count(*)::int as n, sum(v.rating)::int as s
      from public.coach_reviews v
     where v.coach_id = t.id
       and v.withdrawn_at is null
  ) r on true
  -- Live, self-declared claims only. See §2: an expired row never leaves the
  -- database towards a public URL, and a 'verified' row is a different claim
  -- that would need wording this page does not have.
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'kind',       k.kind,
               'title',      k.title,
               'issuer',     nullif(btrim(coalesce(k.issuer, '')), ''),
               'reference',  nullif(btrim(coalesce(k.reference, '')), ''),
               'expires_on', k.expires_on)
             order by k.kind, k.title) as items
      from public.coach_credentials k
     where k.coach_id = t.id
       and k.verification = 'self_declared'
       and (k.expires_on is null or k.expires_on >= current_date)
  ) c on true
 where t.listed = true
   and t.public_page = true
   and t.public_handle is not null
   and t.public_handle = lower(btrim(coalesce(p_handle, '')));
$function$;

comment on function public.public_coach_page(text) is
  'One coach''s public page, for the marketing site. [anon entry point] Returns a row only for a coach who has BOTH opted into the directory and asked for a public page; a handle nobody holds and a page switched off are the same zero rows. Reviews are a COUNT and a SUM only — no body, no reviewer name, no gym, no reply — because RLS selects rows and part 139 keeps client_id unreachable; expired and non-self-declared credentials are filtered out so nothing on a public URL can read as current or as checked by Repple.';

revoke execute on function public.public_coach_page(text) from public;
grant  execute on function public.public_coach_page(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE COACH'S SWITCH
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Returns a WORD rather than raising, the same shape `write_coach_review` uses
-- and for the same reason: the screen has to be able to say which of six things
-- happened, and a raised Postgres exception is not a sentence anybody wants to
-- read. `src/lib/publicProfile.ts` turns each word into one.
--
-- 'needs_directory' is the interesting one. Publishing while not listed is
-- refused rather than silently corrected, because the coach asked for something
-- and is owed the reason it did not happen — the trigger would otherwise clear
-- the flag under them and the switch would spring back with no explanation.
create or replace function public.set_my_public_page(p_handle text, p_on boolean)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid    := auth.uid();
  v_handle text    := lower(btrim(coalesce(p_handle, '')));
  v_on     boolean := coalesce(p_on, false);
  v_listed boolean;
begin
  if v_me is null then return 'signed_out'; end if;

  select t.listed into v_listed from public.trainers t where t.id = v_me;
  if not found then return 'not_a_coach'; end if;

  -- Clearing the handle takes the page down with it. There is no state where a
  -- page is on and has no address, and the trigger enforces that too.
  if v_handle = '' then
    update public.trainers set public_handle = null, public_page = false where id = v_me;
    return 'cleared';
  end if;

  if v_handle !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then return 'invalid'; end if;
  if v_handle = any (public.reserved_public_handles()) then return 'reserved'; end if;
  if v_on and not coalesce(v_listed, false) then return 'needs_directory'; end if;

  -- Checked before the write so the ordinary case gets the ordinary answer, and
  -- caught after it as well: two coaches can claim the same handle between the
  -- select and the update, and only the index sees both.
  if exists (
    select 1 from public.trainers t where t.public_handle = v_handle and t.id <> v_me
  ) then
    return 'taken';
  end if;

  begin
    update public.trainers
       set public_handle = v_handle,
           public_page   = v_on
     where id = v_me;
  exception when unique_violation then
    return 'taken';
  end;

  return case when v_on then 'published' else 'saved' end;
end
$function$;

comment on function public.set_my_public_page(text, boolean) is
  'Claim a public-page handle and switch the page on or off, for the caller''s own trainers row. Returns a word — signed_out, not_a_coach, cleared, invalid, reserved, taken, needs_directory, saved, published — because the screen has to say which one happened. This is the ONLY write path to trainers.public_handle and trainers.public_page: part 152''s column grants exclude both.';

revoke execute on function public.set_my_public_page(text, boolean) from public, anon;
grant  execute on function public.set_my_public_page(text, boolean) to authenticated;

-- ── reading back your own switch ────────────────────────────────────────────
--
-- Part 131 revoked table-wide SELECT on `trainers` and granted back a named
-- column list; part 151 is the write-up of what happens when that list is one
-- short — the read is refused 42501 and a whole editor fails to load. Both new
-- columns are added to it here, in the same file that creates them.
--
-- SELECT only. There is deliberately no matching `grant update`: see §4.
grant select (public_page, public_handle) on public.trainers to authenticated;

-- ── Deliberately NOT done here ─────────────────────────────────────────────
--
-- 1. No coach photo or logo. `profiles.avatar` would be the obvious thing to
--    put at the top of a page like this and it is not returned, because
--    whether that object is readable without a signed URL is a storage question
--    this part has not answered. A logo is being added elsewhere; the page
--    draws a monogram in the coach's accent colour and has a slot the logo
--    drops into when it lands.
--
-- 2. No packages or prices beyond `session_fee`. Part 147 narrowed
--    `trainer_packages` to the buyer's own coach and rejected the
--    "listed/directory coaches" shape by name: there is no screen that shows a
--    non-client another coach's price list, and there is no reader here either.
--    One session fee, which `trainers` has always carried and the in-app
--    directory has always shown, is the whole of it.
--
-- 3. No enumeration. Nothing lists the coaches who have a page. A directory of
--    them would be a product decision with its own consent question, and the
--    sitemap is left alone for the same reason — web/sitemap.xml is a static
--    file and there is nothing that could keep it current anyway.
