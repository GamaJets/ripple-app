-- ═══════════════════════════════════════════════════════════════════════════
-- A delivered session comes off whatever the client actually paid with — and
-- the session says which.
--
-- Part 193 made a STANDING appointment draw a credit off a coach-sold pack at
-- delivery. It stopped there, on purpose and with the reasoning written down,
-- and two holes were left open behind it. Both were confirmed by reading every
-- path that can put a client into a `sessions` row.
--
-- ── HOLE 1 · a one-off nobody booked on a phone ──────────────────────────
--
-- Part 193's header says a one-off "ALREADY drew its credit at booking time, on
-- the client's phone". That is true of exactly two of the four ways a client
-- ends up in a slot:
--
--   the client taps Book            book_session, then the app calls
--   (app/(client)/calendar.tsx)     redeem_pack_session → A CREDIT COMES OFF
--
--   the waitlist moves              _promote_session_waitlist draws inline
--   (supabase/parts/126)            → A CREDIT COMES OFF
--
--   the COACH books the client      app/(trainer)/calendar.tsx inserts a row
--   into a slot                     with status 'booked' → NOTHING COMES OFF
--
--   the GYM puts a one-to-one       sessions_gym_owner_i (part 44) inserts the
--   on its own timetable            same row → NOTHING COMES OFF
--
-- The last two are the whole of the in-person business: a coach with a diary
-- and a front desk with a screen. A client on a ten-pack whose coach books them
-- in — which is how most in-person coaching is actually scheduled — consumed
-- zero credits, for ever, exactly as part 193's standing appointments did.
--
-- ── HOLE 2 · the gym sold the pack and nothing knew ──────────────────────
--
-- `client_purchases` is a pack sold by a COACH, keyed on trainer_id.
-- `gym_passes` (part 31, sold to a member since part 281) is sold by a GYM,
-- keyed on tenant. Nothing has ever linked a `gym_pass` to a `sessions` row, so
-- a member who bought ten PT sessions from the gym and was assigned a coach had
-- those ten sessions delivered against a balance that never moved.
--
-- ── WHICH ENTITLEMENT PAYS, AND WHY THAT ORDER ───────────────────────────
--
-- A client can hold both. The rule is SPECIFICITY — the entitlement that names
-- both parties to this session wins — and it is decided here, once, rather than
-- at each point of use:
--
--   1. a pack the client bought FROM THIS COACH (`client_purchases`, matched on
--      client_id AND trainer_id). It names the two people who were in the room.
--      It was sold for these hours and nothing else.
--
--   2. a pass THIS GYM sold the client that covers PT (`gym_passes`, matched on
--      holder_id and the session's tenant_id). It names the client and the gym;
--      the coach is whoever the gym rostered, and is interchangeable.
--
--   3. nothing. Cash, or a membership that includes PT. Ordinary, and not an
--      error — see the note on shortfall below for the difference between
--      "nothing to draw" and "something should have been drawn".
--
-- NEVER BOTH, and never a fall-through from an EXHAUSTED coach pack onto a gym
-- pass. If a client holds a pack from this coach and it is used up, the honest
-- outcome is that the coach's pack ran out — a conversation the coach and the
-- client need to have — and quietly spending the gym's credit instead would
-- hide it from all three parties and move money between two businesses. So a
-- coach pack, once held, is the answer even when the answer is "empty".
--
-- ── WHERE THE DRAW HAPPENS, PER ROUTE ────────────────────────────────────
--
--   coach pack · standing appointment      at delivery   (part 193, unchanged)
--   coach pack · client booked it          at booking    (unchanged)
--   coach pack · coach or gym booked it    at delivery   ← NEW
--   coach pack · waitlist promotion        at booking, now STAMPED   ← NEW
--   gym pass   · every route               at delivery   ← NEW
--
-- The discriminator for "this one-off already paid at booking" is a new column,
-- `sessions.booking_drew_credit_at`, and it is stamped by `book_session` — the
-- SECURITY DEFINER function EVERY build calls, old and new, because booking is
-- not something the app can do with an UPDATE. So the discriminator is right
-- for a phone that has not taken today's OTA as much as for one that has, and
-- nothing here depends on a client-side change landing first.
--
-- The honest limit of that stamp, written down rather than glossed: it records
-- that the booking ATTEMPTED the draw, not that the draw succeeded. If the
-- client's phone lost the network between `book_session` and
-- `redeem_pack_session`, no credit came off and this trigger will not draw one
-- later. That is not a regression — it is exactly today's behaviour — and it is
-- not silent: the booking screen already tells the client "This wasn't taken off
-- your session pack … check your package before you book again". Closing it
-- properly means moving the draw inside `book_session`, which cannot be done
-- while a build in the field still calls `redeem_pack_session` straight
-- afterwards and would draw a second credit. That is the next pass, and this is
-- the note it should start from.
--
-- ── DRAWING ONCE ─────────────────────────────────────────────────────────
--
-- Every rule part 123 and part 193 established is kept and extended, not
-- restated loosely: one statement per draw, `for update` on the chosen row,
-- `get diagnostics` after the write, and the marker set ONLY when the database
-- confirms it moved. A gym pass is spent by INSERTING a `gym_pass_redemptions`
-- row — the way part 31 already defines spending one — so `uses_spent` is
-- recomputed by that table's own trigger and cannot drift, and the row is the
-- audit trail a disputed session is resolved from.
--
-- ── GIVING IT BACK ───────────────────────────────────────────────────────
--
-- An outcome moved off 'completed' returns the credit to the SAME thing it came
-- off: the same purchase row, or the same pass (by deleting this session's
-- redemption). Part 193's reasoning applies unchanged and applies harder to a
-- gym pass, because a pass can expire — returning a credit to whichever pass is
-- newest could hand somebody a credit on a pass they cannot use, while the one
-- it actually came off stays short.
--
-- ── A DRAW THAT SHOULD HAVE HAPPENED AND DID NOT ─────────────────────────
--
-- `pack_draw_shortfall_at` is the one thing this part adds that is neither a
-- draw nor a return. A coach paid for a session the client did not pay for is
-- the defect this whole area exists to prevent, and until now it was invisible:
-- an exhausted pack and a cash client produced byte-identical rows. The marker
-- is set when a session completes, the client HELD the entitlement that should
-- have paid for it, and every one of them was used up or expired. It is not set
-- for a client who holds nothing — that person is paying another way and
-- nothing went wrong. It is cleared when the outcome is undone.
--
-- ── A RELEASED SLOT MUST NOT INHERIT SOMEBODY ELSE'S CREDIT ──────────────
--
-- `cancel_my_session` and the coach's own release both hand a booked slot back
-- to the pool with `client_id = null`, and `_promote_session_waitlist` then
-- gives it to the next person. Without the release trigger below, the new
-- occupant would inherit the previous one's markers — and a one-off booked by
-- the coach into a recycled slot would be read as already paid, or would return
-- a credit to a stranger's pack. So the markers travel with the client, and the
-- one place they are deliberately CARRIED rather than cleared is a reschedule,
-- where the same person is moving the same booking to a different hour.
--
-- auth.uid() is not consulted by any trigger below. They run on behalf of
-- whoever wrote the row; the person whose money moves is named on the row.
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1 · what a gym pass is good for ─────────────────────────────────────────
--
-- `gym_pass_types.kind` is drop_in | guest | pack, which says how a pass was
-- SOLD, not what it may be spent on. Every pass sold to date is spent at the
-- door or against a class (`gym_pass_redemptions.class_id`), and a ten-CLASS
-- pack is not a ten-PT-session pack: drawing an hour of one-to-one off it would
-- be the exact failure this part exists to prevent, pointed at the member
-- instead of the coach.
--
-- So a type says what it covers, and only a type that says 'pt' can pay for a
-- one-to-one. Two values and not three: a gym that wants a pass good for both a
-- class and a PT hour sells two types, because a single pool drawn down by two
-- different things is a balance neither the member nor the desk can predict.
--
-- DEFAULT 'visit', so every pass that exists today keeps meaning exactly what
-- it meant this morning and no member's class pack starts paying for PT the
-- moment this file is run.
alter table public.gym_pass_types add column if not exists covers text not null default 'visit';
alter table public.gym_pass_types drop constraint if exists gym_pass_types_covers_ck;
alter table public.gym_pass_types add constraint gym_pass_types_covers_ck
  check (covers in ('visit', 'pt'));

comment on column public.gym_pass_types.covers is
  'What a pass of this type may be spent on. ''visit'' — the door and group classes, which is every pass sold before this column existed. ''pt'' — one-to-one sessions, drawn at delivery by sessions_pack_draw(). A type covers one or the other, never both: a single balance drawn down by two different things is one neither the member nor the desk can predict.';


-- ── 2 · which session a pass was spent on ───────────────────────────────────
--
-- `gym_pass_redemptions` has carried `class_id` since part 31 and had nowhere
-- to record a one-to-one. Nullable and ON DELETE CASCADE for the same reason
-- the row exists at all: the redemption is the record of a credit being spent,
-- and a redemption whose session has been deleted records a credit spent on
-- nothing, which is worse than no row.
alter table public.gym_pass_redemptions
  add column if not exists session_id uuid references public.sessions(id) on delete cascade;

create unique index if not exists uq_gym_pass_redemptions_session
  on public.gym_pass_redemptions (session_id)
  where session_id is not null;

comment on column public.gym_pass_redemptions.session_id is
  'The one-to-one this pass credit paid for. UNIQUE where present: one session spends at most one pass credit, enforced by the database rather than by the trigger being careful.';


-- ── 3 · what paid for this session, on the session ──────────────────────────
--
-- Part 193 added `pack_drawn_at` and `pack_drawn_purchase_id`. Those stay and
-- keep their meaning; `pack_drawn_kind` says which of the two entitlement
-- systems the stamp belongs to, so nothing has to infer it from which id is
-- null.
alter table public.sessions add column if not exists pack_drawn_kind text;
alter table public.sessions drop constraint if exists sessions_pack_drawn_kind_ck;
alter table public.sessions add constraint sessions_pack_drawn_kind_ck
  check (pack_drawn_kind is null or pack_drawn_kind in ('coach_pack', 'gym_pass'));

alter table public.sessions add column if not exists pack_drawn_pass_id uuid
  references public.gym_passes(id) on delete set null;

alter table public.sessions add column if not exists pack_draw_shortfall_at timestamptz;

alter table public.sessions add column if not exists booking_drew_credit_at timestamptz;

comment on column public.sessions.pack_drawn_kind is
  '''coach_pack'' — the credit came off client_purchases, named by pack_drawn_purchase_id. ''gym_pass'' — it came off gym_passes, named by pack_drawn_pass_id. NULL means nothing was drawn, which includes a client paying cash and a one-off that drew at booking.';
comment on column public.sessions.pack_drawn_pass_id is
  'WHICH gym pass paid, so returning the credit puts it back on the same one rather than on whichever pass happens to be newest — a pass can expire, and a credit returned to the wrong one is a credit the member cannot use.';
comment on column public.sessions.pack_draw_shortfall_at is
  'Set when this session completed, the client HELD the entitlement that should have paid for it, and every one of them was used up or expired. NOT set for a client who holds nothing — that person is paying another way and nothing went wrong. This is the only signal that a coach delivered an hour nobody paid for.';
comment on column public.sessions.booking_drew_credit_at is
  'Set by book_session: this booking was made by the client themselves, and the coach-pack draw for it was attempted on their phone straight afterwards. Delivery therefore does NOT draw a coach-pack credit for it. Cleared the moment the slot changes hands, so a recycled slot never reads as already paid.';

-- Existing part 193 stamps predate the kind column and are all coach packs.
update public.sessions
   set pack_drawn_kind = 'coach_pack'
 where pack_drawn_at is not null
   and pack_drawn_kind is null;

-- The client's own credit ledger reads their sessions newest first; the coach's
-- and the gym's read one client's. Both are covered by existing indexes on
-- (trainer_id, starts_at) and (tenant_id, starts_at). The one read neither
-- serves is "which sessions did this pass pay for", from the gym's side.
create index if not exists sessions_pack_drawn_pass_idx
  on public.sessions (pack_drawn_pass_id)
  where pack_drawn_pass_id is not null;

-- "Which sessions were delivered against nothing" — the owner's and the coach's
-- one query over the defect this part exists to surface.
create index if not exists sessions_pack_shortfall_idx
  on public.sessions (tenant_id, starts_at desc)
  where pack_draw_shortfall_at is not null;


-- ── 4 · booking says so ─────────────────────────────────────────────────────
--
-- Byte-identical to part 86's function apart from the one new assignment. It is
-- restated whole rather than patched because a `create or replace` of half a
-- function is not a thing Postgres offers, and because the exclusion handler
-- below it is load-bearing: a clash is reported as `false`, the same answer as
-- a slot somebody else took, and the client screen has one honest sentence for
-- both.
create or replace function public.book_session(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_rows int;
begin
  update sessions
     set client_id = auth.uid(),
         status = 'booked',
         released = false,
         -- The client is booking this themselves, so the app draws the
         -- coach-pack credit for it in the next breath. Recorded here, on the
         -- server, so that a build which has not taken today's update is
         -- described as accurately as one that has.
         booking_drew_credit_at = now()
   where id = p_session and status = 'available'
     and exists (select 1 from clients c where c.id = auth.uid() and c.trainer_id = sessions.trainer_id);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
exception
  when exclusion_violation then return false;
end $fn$;

grant execute on function public.book_session(uuid) to authenticated;


-- ── 5 · the slot travels, the credit travels with it ────────────────────────
--
-- BEFORE UPDATE on every column, not `of` a list, because the thing being
-- watched is who the session belongs to.
--
-- The escape hatch is deliberate and is used by exactly one caller. When the
-- SAME statement that changes the client also sets the markers, it is carrying
-- them on purpose — that is `reschedule_my_session` moving one person's booking
-- from one hour to another — and clearing them would strand a credit on a slot
-- the member no longer holds. Every other statement leaves them alone, which is
-- the release case, and they go.
--
-- `old.outcome is null` guards the record: a session that has been marked is
-- not a slot any more, and a stamp on it is part of what happened rather than
-- part of a booking. Unbooking a marked session is not a flow this product has,
-- and if one is ever added it must decide what to do with the credit
-- explicitly rather than inherit a silent clear from here.
create or replace function public.sessions_release_clears_draw()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.client_id is distinct from old.client_id
     and old.outcome is null
     and new.pack_drawn_at is not distinct from old.pack_drawn_at
     and new.booking_drew_credit_at is not distinct from old.booking_drew_credit_at then
    new.pack_drawn_at := null;
    new.pack_drawn_purchase_id := null;
    new.pack_drawn_kind := null;
    new.pack_drawn_pass_id := null;
    new.pack_draw_shortfall_at := null;
    new.booking_drew_credit_at := null;
  end if;
  return new;
end $fn$;

revoke all on function public.sessions_release_clears_draw() from public, anon, authenticated;

drop trigger if exists sessions_release_clears_draw_trg on public.sessions;
create trigger sessions_release_clears_draw_trg
  before update on public.sessions
  for each row execute function public.sessions_release_clears_draw();


-- ── 6 · the draw, and the giving back ───────────────────────────────────────
create or replace function public.sessions_pack_draw()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_used int;
  v_pass uuid;
  v_spent int;
  v_total int;
  v_on date;
  n int;
begin

  -- ── giving it back ─────────────────────────────────────────────────────
  --
  -- Checked FIRST, because a correction is the case where getting it wrong
  -- costs somebody a session they never had. Off 'completed', with a credit
  -- recorded against this session: put it back on the SAME thing it came off.
  if old.outcome = 'completed' and new.outcome is distinct from 'completed' then

    -- A shortfall describes a completed session. This one is no longer one.
    new.pack_draw_shortfall_at := null;

    if new.pack_drawn_kind = 'coach_pack' and new.pack_drawn_purchase_id is not null then
      update public.client_purchases cp
         set sessions_used = greatest(0, cp.sessions_used - 1)
       where cp.id = new.pack_drawn_purchase_id;
      get diagnostics n = row_count;
      -- The pack row is gone. Nothing to give back to, and clearing the marker
      -- anyway would let the next completion draw a second credit for the same
      -- session.
      if n = 1 then
        new.pack_drawn_at := null;
        new.pack_drawn_purchase_id := null;
        new.pack_drawn_kind := null;
      end if;
      return new;
    end if;

    if new.pack_drawn_kind = 'gym_pass' and new.pack_drawn_pass_id is not null then
      -- Deleting the redemption IS returning the credit: part 31's own trigger
      -- recomputes `uses_spent` from the surviving rows, so the counter cannot
      -- drift and there is no second number to keep in step by hand.
      delete from public.gym_pass_redemptions r where r.session_id = new.id;
      get diagnostics n = row_count;
      if n = 1 then
        new.pack_drawn_at := null;
        new.pack_drawn_pass_id := null;
        new.pack_drawn_kind := null;
      end if;
      return new;
    end if;

    return new;
  end if;

  -- ── drawing it ─────────────────────────────────────────────────────────
  --
  -- Only on the transition INTO 'completed', and only when nothing has been
  -- drawn for this session yet. Both conditions, not either: the transition
  -- alone would draw again on a session corrected twice, and the marker alone
  -- would draw on any update at all to an already-completed session.
  if new.outcome is distinct from 'completed'
     or old.outcome is not distinct from 'completed'
     or new.pack_drawn_at is not null
     or new.client_id is null
     or new.trainer_id is null then
    return new;
  end if;

  -- A fresh completion carries no shortfall until this run decides there is one.
  new.pack_draw_shortfall_at := null;

  -- ── route 1 · a pack the client bought from THIS coach ──────────────────
  --
  -- Asked first and asked as "do they hold one at all", not "do they hold one
  -- with room". Holding an EXHAUSTED pack from this coach is still an answer to
  -- "who is paying for this hour", and it is the answer that must not fall
  -- through onto the gym's money.
  if exists (
    select 1 from public.client_purchases cp
     where cp.client_id = new.client_id
       and cp.trainer_id = new.trainer_id
       and cp.status = 'paid'
       and cp.sessions_total is not null
  ) then

    -- The client booked this themselves and their phone drew the credit at
    -- booking time. Drawing again here would take two for one session — the
    -- silent, systematic error part 193 refused to make.
    if new.series_id is null and new.booking_drew_credit_at is not null then
      return new;
    end if;

    -- The oldest pack with room, held for update — the same rule and the same
    -- lock `redeem_pack_session` uses (part 123). Oldest first so a client who
    -- has bought two packs finishes the first one.
    select cp.id, cp.sessions_used
      into v_id, v_used
      from public.client_purchases cp
     where cp.client_id = new.client_id
       and cp.trainer_id = new.trainer_id
       and cp.status = 'paid'
       and cp.sessions_total is not null
       and cp.sessions_used < cp.sessions_total
     order by cp.created_at asc, cp.id asc
     limit 1
       for update;

    if v_id is null then
      -- They bought a pack from this coach and every session on it is gone.
      -- The coach has just delivered an hour nothing paid for, and this is the
      -- only place that fact is written down.
      new.pack_draw_shortfall_at := now();
      return new;
    end if;

    update public.client_purchases cp
       set sessions_used = cp.sessions_used + 1
     where cp.id = v_id
       and cp.sessions_used = v_used;
    get diagnostics n = row_count;

    -- Zero rows means the row moved between the lock and the write. Marking the
    -- session as drawn anyway would record a credit that was never taken.
    if n = 1 then
      new.pack_drawn_at := now();
      new.pack_drawn_purchase_id := v_id;
      new.pack_drawn_kind := 'coach_pack';
    else
      new.pack_draw_shortfall_at := now();
    end if;
    return new;
  end if;

  -- ── route 2 · a pass this gym sold them that covers PT ──────────────────
  --
  -- Reached only when the client holds NO pack from this coach, which is also
  -- the only state in which the booking-time draw is guaranteed to have taken
  -- nothing: `redeem_pack_session` reads `client_purchases` for this client and
  -- this trainer and nothing else, so with no such row it cannot have drawn.
  -- That is what makes it safe to draw here regardless of how the slot was
  -- booked, and it is a fact about the function rather than a guess about the
  -- app.
  if new.tenant_id is null then
    return new;
  end if;

  -- The day the session actually happened, not today. A pass that was valid on
  -- the day is what paid for that day, and marking an outcome a week late must
  -- not turn a covered session into an uncovered one.
  v_on := (coalesce(new.starts_at, now()))::date;

  select p.id, p.uses_spent, p.uses_total
    into v_pass, v_spent, v_total
    from public.gym_passes p
    join public.gym_pass_types ty on ty.id = p.pass_type_id
   where p.holder_id = new.client_id
     and p.tenant_id = new.tenant_id
     and ty.covers = 'pt'
     and p.uses_spent < p.uses_total
     and (p.expires_on is null or p.expires_on >= v_on)
   -- Soonest to expire first, then oldest. A member with two passes should
   -- spend the one they are about to lose, which is the opposite of the coach-
   -- pack rule only because a coach pack cannot expire and a pass can.
   order by p.expires_on asc nulls last, p.issued_on asc, p.id asc
   limit 1
     -- OF p, not a bare `for update`: a bare one would also lock the
     -- `gym_pass_types` row this joins to, which is a shared price-book row
     -- every concurrent draw in the gym would then queue behind.
     for update of p;

  if v_pass is null then
    -- Do they hold a PT pass here at all? Used up or expired is a shortfall;
    -- never having had one is a member paying another way.
    if exists (
      select 1 from public.gym_passes p
        join public.gym_pass_types ty on ty.id = p.pass_type_id
       where p.holder_id = new.client_id
         and p.tenant_id = new.tenant_id
         and ty.covers = 'pt'
    ) then
      new.pack_draw_shortfall_at := now();
    end if;
    return new;
  end if;

  -- Belt and braces under the row lock: `for update` re-evaluates the predicate
  -- when it is granted, so this cannot fire, and if it ever does the answer is
  -- a shortfall rather than a constraint violation that would refuse to record
  -- that the session happened at all.
  if v_spent >= v_total then
    new.pack_draw_shortfall_at := now();
    return new;
  end if;

  -- Spending a pass is inserting a redemption — part 31's own definition of it.
  -- `uses_spent` is recomputed by that table's trigger, so there is no second
  -- number to keep in step by hand, and the unique index on session_id makes a
  -- second credit for the same session impossible rather than merely unlikely.
  --
  -- The handler is what keeps that index from ever REFUSING TO RECORD THAT THE
  -- SESSION HAPPENED. A unique violation here means a redemption already names
  -- this session — the credit was spent and only the stamp went missing — so it
  -- is adopted rather than spent again, and it is certainly not a shortfall.
  begin
    insert into public.gym_pass_redemptions (tenant_id, pass_id, session_id, redeemed_by)
    values (new.tenant_id, v_pass, new.id, new.outcome_by);
    new.pack_drawn_at := now();
    new.pack_drawn_pass_id := v_pass;
    new.pack_drawn_kind := 'gym_pass';
  exception when unique_violation then
    select r.pass_id into v_pass
      from public.gym_pass_redemptions r
     where r.session_id = new.id;
    if v_pass is not null then
      new.pack_drawn_at := now();
      new.pack_drawn_pass_id := v_pass;
      new.pack_drawn_kind := 'gym_pass';
    end if;
  end;

  return new;
end $fn$;

revoke all on function public.sessions_pack_draw() from public, anon, authenticated;

-- BEFORE, not AFTER, so the marker columns are written as part of the same row
-- update rather than as a second statement that could fail on its own.
drop trigger if exists sessions_pack_draw_on_outcome on public.sessions;
create trigger sessions_pack_draw_on_outcome
  before update of outcome on public.sessions
  for each row execute function public.sessions_pack_draw();


-- ── 7 · the waitlist draw stops being invisible ─────────────────────────────
--
-- Part 126 draws a credit inline when it promotes somebody off a waitlist, and
-- records nothing about it: no session carries the stamp, so the credit cannot
-- be returned to the pack it came off, cannot be shown to either party, and —
-- once this file is applied — would be drawn a SECOND time at delivery, because
-- a promoted session has no `booking_drew_credit_at`.
--
-- Restated whole for the same reason `book_session` is. Everything below is
-- part 126's function unchanged apart from the stamp and the row-count check on
-- the draw, which brings it up to the standard parts 123 and 193 hold every
-- other credit movement to.
create or replace function public._promote_session_waitlist(p_session uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sess record;
  v_cand record;
  v_pack uuid;
  v_used int;
  n int;
begin
  select s.id, s.trainer_id, s.starts_at, s.status
    into v_sess
    from sessions s
   where s.id = p_session
   for update;
  if not found or v_sess.status <> 'available' then
    return null;
  end if;

  -- A session that has already started is not promoted. Handing somebody a slot
  -- that began ten minutes ago books them into a session they cannot attend and
  -- draws a credit off their pack for it. The slot simply stays open.
  if v_sess.starts_at <= now() then
    return null;
  end if;

  for v_cand in
    select w.client_id
      from session_waitlist w
      join clients c on c.id = w.client_id
     where w.session_id = p_session
       and c.trainer_id = v_sess.trainer_id
     order by w.joined_at, w.seq
     for update of w
  loop
    begin
      update sessions
         set client_id = v_cand.client_id, status = 'booked', released = false
       where id = p_session;

      -- The credit. A client promoted off a waitlist is booked by the server
      -- while their phone is in their pocket, so the draw-down `redeemSession`
      -- does at the moment somebody taps Book has to happen here instead —
      -- otherwise the queue is the cheapest way to book, and the coach delivers
      -- a session nobody paid for. Oldest pack first, exactly as redeemSession
      -- orders them. No pack is the ordinary case for a client who pays per
      -- session, and it is not an error.
      select p.id, p.sessions_used
        into v_pack, v_used
        from client_purchases p
       where p.client_id = v_cand.client_id
         and p.trainer_id = v_sess.trainer_id
         and p.status = 'paid'
         and p.sessions_total is not null
         and p.sessions_used < p.sessions_total
       order by p.created_at asc, p.id asc
       limit 1
         for update;

      if v_pack is not null then
        update client_purchases
           set sessions_used = sessions_used + 1
         where id = v_pack and sessions_used = v_used;
        get diagnostics n = row_count;
        -- Stamped only when the database confirms the write, and stamped at
        -- all so that the credit can be given back to the pack it came off and
        -- so that both parties can see which hour it paid for.
        if n = 1 then
          update sessions
             set pack_drawn_at = now(),
                 pack_drawn_purchase_id = v_pack,
                 pack_drawn_kind = 'coach_pack'
           where id = p_session;
        end if;
      end if;

      delete from session_waitlist
       where session_id = p_session and client_id = v_cand.client_id;

      return v_cand.client_id;
    exception when exclusion_violation then
      -- They are already booked with this coach across that hour. Their place
      -- in the queue is kept and the next person is tried, rather than the slot
      -- silently failing to move.
      continue;
    end;
  end loop;

  return null;
end $fn$;

revoke all on function public._promote_session_waitlist(uuid) from public, anon, authenticated;

comment on function public._promote_session_waitlist(uuid) is
  'Internal. Hands a freed slot to the head of its waitlist and draws the credit that pays for it, stamping the session with the pack it came off. Callers must authorise first; this function does not.';


-- ── 8 · a move carries the credit with it ───────────────────────────────────
--
-- Part 243 frees one slot and books another, and says `credit_drawn: false` —
-- which was true because nothing was linked to a session at all. It is still
-- true after this file, but only because the markers are CARRIED: the same
-- person, the same booking, a different hour, and no credit drawn or returned.
--
-- Without this, the released slot would keep the stamp (and hand it to whoever
-- is promoted into it) and the new slot would carry none — so delivery would
-- draw a second credit for a session already paid for.
--
-- Restated whole; everything outside the marked block is part 243 unchanged.
create or replace function public.reschedule_my_session(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_from record;
  v_to record;
  v_applies boolean := false;
  v_notice int := 24;
  v_fee numeric;
  v_currency text;
  v_promoted uuid;
  v_waiting int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_from = p_to then
    return jsonb_build_object('moved', false, 'reason', 'same_slot');
  end if;

  -- Both rows locked, and in a fixed order by id so two members moving into
  -- each other's slots at the same moment cannot deadlock. Part 243's, kept
  -- exactly: the lock ordering is the whole of it and a `for update` on the
  -- select below instead would take them in the order the query names them.
  perform 1 from sessions s
   where s.id in (p_from, p_to)
   order by s.id
     for update;

  -- Part 243's select plus the five markers this file has to carry across. They
  -- are read here, under the lock taken above, because the update that frees
  -- p_from clears them.
  select s.id, s.trainer_id, s.starts_at, s.duration_min,
         s.pack_drawn_at, s.pack_drawn_purchase_id, s.pack_drawn_kind,
         s.pack_drawn_pass_id, s.booking_drew_credit_at
    into v_from
    from sessions s
   where s.id = p_from and s.client_id = v_uid and s.status = 'booked';
  if not found then
    -- Not yours, or not booked. Reported rather than raised, because it is a
    -- refusal and not a fault: somebody may have opened this screen an hour
    -- ago and the session may already have moved.
    return jsonb_build_object('moved', false, 'reason', 'not_yours');
  end if;

  select s.id, s.trainer_id, s.starts_at, s.duration_min
    into v_to
    from sessions s
   where s.id = p_to and s.status = 'available';
  if not found then
    return jsonb_build_object('moved', false, 'reason', 'taken');
  end if;

  -- The same coach. A move to another coach's slot is not a move, it is a
  -- different booking with a different relationship and possibly a different
  -- pack behind it.
  if v_to.trainer_id <> v_from.trainer_id then
    return jsonb_build_object('moved', false, 'reason', 'other_coach');
  end if;

  -- Never into the past, and never into a slot that has already begun.
  if v_to.starts_at <= now() then
    return jsonb_build_object('moved', false, 'reason', 'already_started');
  end if;

  select coalesce(t.late_cancel_applies, false),
         coalesce(t.late_cancel_notice_hours, 24),
         t.late_cancel_fee,
         tn.currency
    into v_applies, v_notice, v_fee, v_currency
    from trainers t
    left join tenants tn on tn.id = t.tenant_id
   where t.id = v_from.trainer_id;

  -- The gate. Measured on the session being MOVED OUT OF, on exactly the rule
  -- `cancel_my_session` uses.
  if v_applies and (v_from.starts_at - now()) < make_interval(hours => v_notice) then
    return jsonb_build_object(
      'moved', false,
      'reason', 'inside_notice',
      'notice_hours', v_notice,
      'fee', v_fee,
      'currency', v_currency);
  end if;

  -- Free first, then book. If booking the new slot violates the no-double-
  -- booking exclusion constraint the whole subtransaction rolls back and the
  -- old session is still theirs.
  begin
    update sessions
       set client_id = null, status = 'available', released = true
     where id = p_from;

    -- ── the markers travel ────────────────────────────────────────────────
    -- Set in the SAME statement that gives the slot its new occupant, which is
    -- what tells `sessions_release_clears_draw` this is a carry and not a
    -- release. A gym-pass redemption follows by its own id.
    update sessions
       set client_id = v_uid, status = 'booked', released = false,
           pack_drawn_at = v_from.pack_drawn_at,
           pack_drawn_purchase_id = v_from.pack_drawn_purchase_id,
           pack_drawn_kind = v_from.pack_drawn_kind,
           pack_drawn_pass_id = v_from.pack_drawn_pass_id,
           booking_drew_credit_at = v_from.booking_drew_credit_at
     where id = p_to;

    update gym_pass_redemptions set session_id = p_to where session_id = p_from;
  exception when exclusion_violation then
    return jsonb_build_object('moved', false, 'reason', 'clash');
  end;

  -- The freed slot goes to whoever is first in line, in this same transaction,
  -- so it is never observable as bookable while somebody is waiting.
  v_promoted := public._promote_session_waitlist(p_from);
  select count(*) into v_waiting from session_waitlist where session_id = p_from;

  return jsonb_build_object(
    'moved', true,
    'reason', null,
    'from_at', v_from.starts_at,
    'to_at', v_to.starts_at,
    'notice_hours', v_notice,
    'policy_applies', v_applies,
    'charged', false,
    -- Still false, and now for a stronger reason: the credit that was already
    -- on this booking moved with it, so nothing was drawn and nothing returned.
    'credit_drawn', false,
    'promoted', v_promoted,
    'waiting', v_waiting);
end $fn$;

revoke all on function public.reschedule_my_session(uuid, uuid) from public, anon;
grant execute on function public.reschedule_my_session(uuid, uuid) to authenticated;

comment on function public.reschedule_my_session(uuid, uuid) is
  'Move one booked session to another open slot of the SAME coach, atomically. Never charges and never draws or returns a pack credit — a credit already on the booking is carried to the new hour. Refuses a move made inside the coach''s notice window rather than pricing one. See supabase/parts/243 and 370.';


-- ── 9 · a pass a person holds can be read by the people it concerns ─────────
--
-- `gym_pass_types_tenant_r` is `tenant_id = my_tenant() and ACTIVE`. That was
-- fine while the only question asked of a type was "what is on sale at the
-- desk". It is not fine now that `covers` decides whether a pass can pay for a
-- one-to-one, because a gym that retires a PT pass type makes it unreadable to
-- the very people still holding passes sold on it — and the app would then drop
-- those passes out of the member's own balance and show a smaller number than
-- they hold. The same class of defect `packDraw.ts` records for coach packages,
-- pointed at somebody's money instead of at a label.
--
-- The draw itself was never affected: `sessions_pack_draw()` is SECURITY
-- DEFINER and reads the type regardless. This is about what the three apps may
-- SAY, and the two policies below are the narrowest widening that fixes it.
--
-- A holder may read the type of a pass THEY HOLD. Not the price book, not the
-- retired types they never bought: one row per pass they are carrying.
drop policy if exists gym_pass_types_held_r on public.gym_pass_types;
create policy gym_pass_types_held_r on public.gym_pass_types
  for select using (
    exists (
      select 1 from public.gym_passes p
       where p.pass_type_id = gym_pass_types.id
         and p.holder_id = (select auth.uid())
    )
  );

-- And a gym's own staff may read its whole price book, retired rows included —
-- exactly the scope `gym_passes_staff_r` (part 31) already gives them over the
-- passes themselves. A trainer who can see that a member holds a pass and
-- cannot see what it is good for is being shown half a fact.
drop policy if exists gym_pass_types_staff_r on public.gym_pass_types;
create policy gym_pass_types_staff_r on public.gym_pass_types
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));
