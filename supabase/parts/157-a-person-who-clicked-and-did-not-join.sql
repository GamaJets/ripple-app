-- ═══════════════════════════════════════════════════════════════════════════
-- The person who clicked and did not join.
--
-- ── What was missing ───────────────────────────────────────────────────────
--
-- The join code is the top of this funnel and it works. Part 81 gives a coach
-- parallel named codes, part 98 gives each one a cost and a return, part 100
-- reads ad spend off the destination link so nothing is mapped by hand, and
-- `coach_requests.via_code` records the exact string somebody spent so that a
-- rotation never rewrites where anybody came from.
--
-- Every one of those measures a CONVERSION. A code is spent by somebody who
-- already installed the app, already made an account, and already decided. The
-- person who opened /join?c=K7M2QX, read it, and closed the tab is recorded
-- nowhere at all — and on the evidence of web/join.html that is most of them:
-- as of 30 Aug 2026 both store listings still 404, so an invited client is
-- redirected to a page that cannot give them the app, and the only route the
-- page offers them is to email support by hand.
--
-- So a coach running a flyer, an Instagram bio and a paid ad can see how many
-- people finished and cannot see how many started. The two numbers answer
-- different questions and the second one is the one that says whether the AD
-- worked as opposed to whether the ONBOARDING did — which matters, because
-- unmatched ad spend and a dead store listing look identical from inside
-- `my_code_returns()`: both read as a channel that cost money and returned
-- nobody.
--
-- ── The shape, and what it deliberately is not ─────────────────────────────
--
-- One table of enquiries, written by ONE narrow SECURITY DEFINER function that
-- `anon` may call, plus one table recording what the coach did about each one.
--
-- There is NO email in this schema. No queue, no `send_after`, no template, no
-- sequence, no edge function, and nothing here can cause anybody to receive
-- anything. That is not a stage of the work: this product has no email channel
-- at all, and a `lead_sequences` table would be a promise the app cannot keep
-- — a coach would watch a lead sit in "Day 2 of 5" while nothing was ever sent.
-- The same rule part 140 wrote for nudges applies here for the same reason.
-- Following one of these up is manual, and the screen says so in those words.
--
-- Attribution is `via_code`, the string as it was resolved — the same column
-- name, the same uppercased form, and the same reasoning as
-- `coach_requests.via_code` in part 56. That means src/lib/adMatch.ts needs no
-- change and no new mapping: an ad already carries the code in its destination,
-- the code is on the enquiry, and the app matches the two against the coach's
-- own `my_join_codes()` list exactly as `matchAds` already does for spend.
--
-- ── THE ANON WRITE PATH — the part to read carefully ───────────────────────
--
-- A public form means the key compiled into the marketing site can write. This
-- database has been bitten here repeatedly and the lessons are in parts 119,
-- 131, 141, 151 and 152. Applied here, in order:
--
--  1. `anon` gets NO privilege on either table. Not narrowed by a policy —
--     refused at the grant, as part 140 puts it, because RLS narrows a grant
--     and does not confer one. TRUNCATE goes with it: RLS does not apply to
--     TRUNCATE. Supabase's stock default privileges hand `anon` the full DML
--     set on every table created in this project (part 119 found that on 80 of
--     89 tables), so this is written out rather than assumed.
--
--  2. The ONLY thing `anon` may execute is `leave_my_details`. It returns
--     void. Nothing flows back out of it — not a row, not a count, not a
--     boolean, not an id.
--
--  3. IT MUST NOT BE AN ORACLE. Part 141 found that `anon` could call
--     `join_by_code` and use it to try codes against; `join_by_code` raises
--     'no coach uses that code' for a miss and returns a row for a hit, which
--     is an enumeration primitive over a credential. A join code is what
--     attaches somebody to a coach, so a list of live codes is a list of
--     coaches a stranger can queue requests at.
--
--     So this function has EXACTLY ONE outcome for every input it will ever be
--     given: it returns void, having raised nothing. A blank name, a malformed
--     code, a code that belongs to nobody, a code that is somebody's live
--     Instagram campaign, a duplicate submission and a caller who has already
--     hit the cap are all indistinguishable from the outside. There is no
--     branch that raises and no branch that returns a different value.
--
--     The honest residual, stated rather than glossed: a resolving code costs
--     one INSERT that a non-resolving code does not, so the two differ by a
--     sub-millisecond of server time under network jitter. That is a timing
--     side channel and it is real. It is bounded by 4 below rather than
--     eliminated, because eliminating it would mean doing a fake write, and a
--     table anybody can fill with rows attached to no coach is a worse thing
--     to have than a timing difference an attacker can already get more
--     cheaply from `join_by_code`'s own rate limits.
--
--  4. IT MUST BE RATE-LIMITABLE, and it is limited here as well as being
--     limitable at the edge. Everything the limit needs is one indexed count
--     over one trainer and one hour:
--
--       · at most LEAD_HOURLY_CAP (20) enquiries per code per rolling hour.
--         Past that the function writes nothing and returns void, exactly as
--         it does for every other refusal. Twenty an hour off one campaign is
--         far above any real coach's inbound and far below what makes a
--         coach's screen unusable.
--       · the same contact against the same code inside 24 hours is one
--         enquiry, not two. That is a double-tap on a phone as much as it is
--         an attacker, and a coach who rings the same person twice because the
--         form was submitted twice is the failure this dedupe exists for.
--
--     The cap is per (coach, code) and deliberately not global: a global cap
--     would let one attacker silence lead capture for every coach on the
--     platform, which is a denial of service dressed as a safety measure.
--
--  5. `search_path` is pinned — `public, pg_temp`, with pg_temp last so an
--     object in a temporary schema cannot shadow one of the tables this
--     function writes to — and EXECUTE is revoked from PUBLIC. It is granted
--     to `anon` and to `authenticated` and to nobody else. Both, because the
--     marketing site's supabase-js client may already hold a session from
--     /signup on the same origin, and an enquiry that silently fails for the
--     one visitor who happens to be signed in is a lost lead with no symptom.
--
--     Part 141's sweep revokes EXECUTE from `anon` on every function in
--     `public`, and it says at the top to re-run it after adding any function.
--     Run standalone against this, that would silently switch the public form
--     off — the page would keep saying "thank you" and nothing would be
--     written. Rather than leave that trap, part 141 now skips the `anon`
--     revoke for a function whose COMMENT carries the marker
--     `[anon entry point]`, and this function's comment carries it. Part 141
--     still revokes PUBLIC from it, which is the half that matters: PUBLIC is
--     every role including ones that do not exist yet, and `anon` is the one
--     deliberate grant.
--
--  6. Column privileges follow part 152's rule, which part 131 established for
--     SELECT and which is the one people get wrong: RLS selects ROWS, never
--     COLUMNS, and a table-level grant is not a set of column grants you can
--     subtract one from. So the table privilege is revoked and the named
--     columns are granted back. A coach may UPDATE `state` and nothing else —
--     not the name, not the contact, not the note, and not `via_code`, which
--     is the attribution and must not become editable, or a coach could move
--     an enquiry onto whichever campaign they wished had produced it.
--
-- ── What a coach may see, and what nobody else may ─────────────────────────
--
-- `trainer_id = auth.uid()` on every verb, as part 140 does for nudges, and
-- for the same three reasons. Another coach must not read it — an enquiry list
-- is the most commercially sensitive thing this app holds about a coaching
-- business. Another coach must not WRITE it either; there is no insert policy
-- at all, so the definer function is the only writer and nobody can plant a row
-- on somebody else's screen. And there is no client case: the person who left
-- their details has no account, by construction — that is the entire point of
-- the feature.
--
-- ── Personal data, and the one deletion that is allowed ────────────────────
--
-- A row here is an unregistered person's name and how to reach them, given to
-- one coach for one purpose. So DELETE is granted to the coach: a person who
-- asks to be removed must be removable by the only party who can be asked, and
-- unlike part 140's 'sent' rows there is no second party this record protects.
-- `coach_lead_notes` cascades with it. UPDATE stays limited to `state`, which
-- means "erase me" is an erasure and never a quiet edit of somebody's name into
-- somebody else's.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.coach_leads (
  id         uuid primary key default gen_random_uuid(),
  -- On `trainers`, not on auth.users: an enquiry is against a coaching
  -- business, and an account with no trainer row cannot issue a code for one
  -- to have arrived through.
  trainer_id uuid        not null references public.trainers(id) on delete cascade,
  -- The code as it RESOLVED, uppercased. Same column name, same form and same
  -- reasoning as coach_requests.via_code: the string lives on the enquiry, so
  -- rotating or revoking a code later does not rewrite where this person came
  -- from. Not a foreign key to coach_join_codes on purpose — a coach's DEFAULT
  -- code lives on `trainers` and has no row in that table, and a key that
  -- could only describe half the codes would be worse than the string.
  via_code   text        not null,
  name       text        not null,
  -- Whatever they typed to be reached on. ONE field, not an email column and a
  -- phone column: this product cannot send an email (see the header), so a
  -- column called `email` would be the first half of a promise, and half the
  -- people who fill in a coach's form would rather be texted anyway. What kind
  -- of thing it is is read from the string itself, in src/lib/leads.ts, which
  -- is testable without a database and says 'unknown' when it cannot tell.
  contact    text        not null,
  -- What they wanted, in their words. Nullable: somebody who left a name and a
  -- number and no message is still a lead.
  note       text,
  at         timestamptz not null default now(),
  -- What the coach has done about it. Three states and no more: 'new' is
  -- untouched, 'contacted' is the coach has reached out, 'closed' is finished
  -- either way. There is deliberately no 'joined' — this database cannot know
  -- that. An enquiry carries no account, so nothing can ever link it to the
  -- `coach_requests` row that person may later create, and a state the app
  -- would have to guess at is a number a coach would divide by.
  state      text        not null default 'new'
             check (state in ('new', 'contacted', 'closed'))
);

-- Lengths as constraints rather than as trust in the caller. The definer
-- function truncates to exactly these, and the app and web/join.html state the
-- same numbers; the constraint is what makes that agreement enforceable rather
-- than customary.
alter table public.coach_leads drop constraint if exists coach_leads_sane;
alter table public.coach_leads add constraint coach_leads_sane check (
  char_length(name) between 1 and 80
  and char_length(contact) between 1 and 120
  and (note is null or char_length(note) <= 500)
  and via_code ~ '^[A-Z0-9]{4,12}$'
);

-- One index, and it serves all three readers: the coach's list ("mine, newest
-- first"), the hourly cap and the 24-hour dedupe. Both of the latter are a
-- narrow time slice inside one trainer, so the leading (trainer_id, at desc)
-- prefix is what does the work and a second index keyed on via_code would be
-- the duplicate part 145 spent a night removing.
create index if not exists coach_leads_trainer_at
  on public.coach_leads (trainer_id, at desc);

alter table public.coach_leads enable row level security;

drop policy if exists coach_leads_owner_read on public.coach_leads;
create policy coach_leads_owner_read on public.coach_leads
  for select
  to authenticated
  using (trainer_id = (select auth.uid()));

drop policy if exists coach_leads_owner_state on public.coach_leads;
create policy coach_leads_owner_state on public.coach_leads
  for update
  to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

drop policy if exists coach_leads_owner_erase on public.coach_leads;
create policy coach_leads_owner_erase on public.coach_leads
  for delete
  to authenticated
  using (trainer_id = (select auth.uid()));

-- There is deliberately no INSERT policy. Every row arrives through
-- leave_my_details(), which is SECURITY DEFINER and therefore runs as the
-- table's owner, so it is unaffected by the absence.

revoke all on public.coach_leads from public;
revoke all on public.coach_leads from anon;
-- Revoke the TABLE privileges, then grant back the one column a coach may
-- write. This is part 152's rule and it is the step whose omission made that
-- part a no-op the first time it was written: `grant select` plus
-- `revoke update (name)` leaves UPDATE on every column standing, because the
-- table-level privilege covers columns added later as well.
revoke insert, update, delete, truncate on public.coach_leads from authenticated;
grant select, delete on public.coach_leads to authenticated;
grant update (state) on public.coach_leads to authenticated;

comment on table public.coach_leads is
  'Somebody who opened a coach''s join link and left their details WITHOUT creating an account. Written only by leave_my_details(); read, re-stated and erased only by the coach it names. Not an email list: nothing in this schema can send anything.';
comment on column public.coach_leads.via_code is
  'The join code this enquiry arrived through, uppercased, as it resolved. The attribution — matched against the coach''s own codes by src/lib/adMatch.ts''s rules, the same way ad spend is. Never editable by the coach.';
comment on column public.coach_leads.state is
  'What the coach has done: new, contacted, closed. There is no ''joined'' state and there cannot be — an enquiry carries no account, so nothing here can ever be linked to the coach_requests row that person may later create.';

-- ── What the coach did about it ───────────────────────────────────────────
--
-- `state` says where an enquiry stands. This says what actually happened, in
-- the coach's own words, and it is a separate table for the reason part 140
-- gives: a row about a moment that can be edited afterwards is not a record of
-- anything. So there is no UPDATE here and there is no DELETE — the follow-up
-- history is append-only, and the only way it goes away is with the lead it
-- belongs to, which is the erasure route above.
--
-- The two are allowed to disagree in one direction and it is worth naming: a
-- coach can set 'contacted' without writing a note, because ticking a state
-- off a list on a bus is a real thing coaches do and forcing a sentence out of
-- them would produce empty sentences. A note without a state change is also
-- fine. `state` is the filter; this is the memory.
create table if not exists public.coach_lead_notes (
  id       uuid primary key default gen_random_uuid(),
  lead_id  uuid not null references public.coach_leads(id) on delete cascade,
  -- The account that acted, on auth.users, matching client_nudges (part 140).
  coach_id uuid not null references auth.users(id) on delete cascade,
  at       timestamptz not null default now(),
  body     text not null
);

alter table public.coach_lead_notes drop constraint if exists coach_lead_notes_sane;
alter table public.coach_lead_notes add constraint coach_lead_notes_sane
  check (char_length(btrim(body)) between 1 and 1000);

create index if not exists coach_lead_notes_lead_at
  on public.coach_lead_notes (lead_id, at desc);

alter table public.coach_lead_notes enable row level security;

-- Ownership is resolved through the lead, not through `coach_id` alone. A
-- policy of `coach_id = auth.uid()` on its own would let a coach write follow-up
-- notes onto a rival's enquiry: the row would carry their own uid, pass the
-- check, and appear on somebody else's screen.
drop policy if exists coach_lead_notes_owner_read on public.coach_lead_notes;
create policy coach_lead_notes_owner_read on public.coach_lead_notes
  for select
  to authenticated
  using (exists (
    select 1 from public.coach_leads l
    where l.id = lead_id and l.trainer_id = (select auth.uid())
  ));

drop policy if exists coach_lead_notes_owner_write on public.coach_lead_notes;
create policy coach_lead_notes_owner_write on public.coach_lead_notes
  for insert
  to authenticated
  with check (
    coach_id = (select auth.uid())
    and exists (
      select 1 from public.coach_leads l
      where l.id = lead_id and l.trainer_id = (select auth.uid())
    )
  );

revoke all on public.coach_lead_notes from public;
revoke all on public.coach_lead_notes from anon;
revoke update, delete, truncate on public.coach_lead_notes from authenticated;
grant select, insert on public.coach_lead_notes to authenticated;

comment on table public.coach_lead_notes is
  'What a coach actually did about one enquiry, in their own words. Append-only: no UPDATE and no DELETE, because a record of a moment that can be rewritten afterwards records nothing. Removed only with the lead it belongs to.';

/**
 * Leave your details for a coach, from their join link, without an account.
 *
 * THE ONLY THING `anon` MAY EXECUTE IN THIS PART. Read the header before
 * changing anything in here; the properties this function has to hold are:
 *
 *   · it returns void, always, for every input;
 *   · it raises nothing, for every input. A malformed code, a code belonging
 *     to nobody, a live code, a blank name, a duplicate and a caller over the
 *     cap are all one outcome from the outside. Adding a `raise` here — even a
 *     helpful one, even for a blank field — turns this back into the oracle
 *     part 141 closed;
 *   · every bound it enforces is a count over one indexed range, so it can be
 *     reasoned about and re-tuned without touching the caller.
 *
 * Truncation rather than refusal on length, for the same reason: refusing is a
 * distinguishable outcome, and there is nothing to be gained by telling a
 * browser that its own maxlength attribute was right. The app and the form
 * state these numbers too, so the truncation should never fire.
 *
 * A REVOKED code still accepts an enquiry, and that is a deliberate departure
 * from `join_by_code`, which refuses one. The two are not the same act. A
 * revoked code means "this campaign is over, do not put anybody new on my
 * roster"; somebody who found last spring's flyer and wants to ask a question
 * is not being put on a roster, and dropping them would lose a real enquiry to
 * a distinction the person on the other end cannot see. It also keeps the
 * response identical for live and revoked codes, which is the third property
 * above.
 */
create or replace function public.leave_my_details(
  p_code    text,
  p_name    text,
  p_contact text,
  p_note    text
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Whitespace stripped before the shape test, because a code read off a
  -- flyer gets typed as 'K7M 2QX' about as often as not, and src/lib/joinCode.ts
  -- already normalises the same way for the app.
  wanted  text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  nm      text := left(btrim(coalesce(p_name, '')), 80);
  ct      text := left(btrim(coalesce(p_contact, '')), 120);
  nt      text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  t_id    uuid;
  t_code  text;
  recent  int;
begin
  -- Nothing to file. Returns exactly as a valid enquiry does.
  if nm = '' or ct = '' then return; end if;
  -- The shape the constraint above allows. Checked here as well so a value
  -- that could never be stored never reaches the lookups, and so the INSERT at
  -- the bottom cannot raise a check violation — a raise is an outcome, and
  -- this function has only one.
  if wanted !~ '^[A-Z0-9]{4,12}$' then return; end if;

  -- Named codes first, then the default on `trainers`, exactly as
  -- join_by_code resolves. The two spaces are unique against each other by
  -- construction (generate_join_code checks both), so the order is not what
  -- makes this unambiguous — it is simply the same order, so the two functions
  -- cannot come to disagree about which coach a code names.
  select c.trainer_id, upper(c.code) into t_id, t_code
  from public.coach_join_codes c
  where upper(c.code) = wanted;

  if t_id is null then
    select tr.id, upper(tr.join_code) into t_id, t_code
    from public.trainers tr
    where tr.join_code is not null and upper(tr.join_code) = wanted;
  end if;

  -- A code nobody owns. NOT an error, and nothing is written: a row with no
  -- coach is a row nobody can read, act on or erase, which is a bucket anybody
  -- can fill rather than a lead. The consequence is real and is stated on the
  -- form — a mistyped code loses the enquiry — and is the price of not having
  -- an oracle.
  if t_id is null then return; end if;

  -- The same person, the same code, inside a day: one enquiry. A second tap on
  -- a slow phone and a refresh both land here.
  if exists (
    select 1 from public.coach_leads l
    where l.trainer_id = t_id
      and upper(l.via_code) = t_code
      and lower(l.contact) = lower(ct)
      and l.at > now() - interval '24 hours'
  ) then
    return;
  end if;

  -- The cap. Per coach and per code, over a rolling hour.
  select count(*) into recent
  from public.coach_leads l
  where l.trainer_id = t_id
    and upper(l.via_code) = t_code
    and l.at > now() - interval '1 hour';
  if recent >= 20 then return; end if;

  insert into public.coach_leads (trainer_id, via_code, name, contact, note)
  values (t_id, t_code, nm, ct, nt);
end; $$;

-- The marker in this comment is load-bearing, not decoration: part 141's sweep
-- reads it and skips the `anon` revoke for this function alone. See point 5 in
-- the header.
comment on function public.leave_my_details(text, text, text, text) is
  'Leave your details for a coach from their join link, with no account. [anon entry point] Returns void for every input and raises for none, so it cannot be used to tell a real join code from a made-up one. Bounded at 20 enquiries per code per hour, and one per contact per code per day.';

revoke execute on function public.leave_my_details(text, text, text, text) from public;
grant execute on function public.leave_my_details(text, text, text, text) to anon, authenticated;
