-- ═══════════════════════════════════════════════════════════════════════════
-- A session pack that never ran out of time.
--
-- `trainer_packages` says how many sessions a pack holds and what it costs, and
-- has never said how long the buyer has to use them. `client_purchases` records
-- `sessions_total` and `sessions_used` and carries nothing about a window. So a
-- ten-pack bought in 2024 is still ten sessions a coach owes somebody in 2026,
-- at 2024's price, and the coach's only way out of that conversation is to have
-- the conversation.
--
-- Every gym in the world sells packs with a validity on them for that reason.
-- This app could not express one.
--
-- ══ 1 · THE TWO THINGS THAT MUST NOT HAPPEN ══════════════════════════════
--
-- ── A pack somebody already bought must not expire retroactively ─────────
--
-- The window is a property of the SALE, not of the package. `expires_on` is
-- stamped on `client_purchases` at checkout, computed from the package's
-- `validity_days` AS IT STOOD THAT DAY, and nothing recomputes it afterwards.
--
-- That is not a convenience, it is the whole safety property. If the window
-- lived only on `trainer_packages`, then a coach adding a ninety-day validity
-- to a package they have been selling for two years would, at the instant they
-- pressed Save, void every unspent credit every one of those clients is
-- holding. Nobody would have agreed to that and nobody would have been told.
--
-- The same rule gives the migration its answer for free: every row already in
-- `client_purchases` has `expires_on` NULL, NULL means no window, and this pass
-- never touches a row that has none. Switching this feature on expires nothing.
--
-- ── A pack that expires with sessions left is a conversation ─────────────
--
-- Not a silent zero. Somebody paid for six sessions they did not take, and the
-- honest outcome is that their coach finds out on the day, by name, with the
-- number in the sentence — so the coach can decide to extend it, sell them
-- something, or say no, which is a decision that belongs to a person.
--
-- So `sessions_expired` is a COLUMN and not an absence. The count is kept, the
-- day it happened is kept, and `packBalance` in src/lib/packDraw.ts renders both
-- to the client and to the coach rather than showing a pack that quietly holds
-- nothing.
--
-- ══ 2 · HOW AN EXPIRED CREDIT STOPS BEING SPENDABLE ══════════════════════
--
-- This is the part that decided the shape of the columns, so it is written out.
--
-- FOUR functions draw a credit off `client_purchases`, in three parts:
-- `redeem_pack_session` and `refund_pack_session` (part 123), `sessions_pack_draw`
-- (part 370, which supersedes part 193's) and `_promote_session_waitlist`
-- (part 370). Together they are about four hundred lines of plpgsql, and every
-- one of them selects with the same two predicates:
--
--     cp.status = 'paid'   and   cp.sessions_used < cp.sessions_total
--
-- There were three ways to make them stop at an expired pack and only one of
-- them is safe.
--
--   COPY THE FOUR FUNCTIONS IN HERE with an `expires_on` predicate added.
--   Four hundred lines of duplicated plpgsql, free to drift from the parts that
--   own them, in the two functions that decide whether somebody's paid-for
--   session was spent. Refused.
--
--   MOVE `status` TO 'expired'. One word, and every draw site already filters
--   on it — which is exactly why it is wrong. `status` is the MONEY fact on
--   this row: `my_code_returns()` (part 98) joins `status = 'paid'` to work out
--   what a coach's join codes earned, and `refundableRow` in src/lib/refunds.ts
--   reads it to decide whether a sale was ever charged. A pack expiring would
--   silently drop its price out of the coach's marketing attribution and make
--   the app tell them "this one was never charged" when they went to refund it.
--   The money landed. It is still landed. Refused.
--
--   REDUCE `sessions_total` TO `sessions_used`, which is what this part does.
--   The pack keeps its status, its amount, its currency and its used count —
--   every fact about the money and about what the client actually took is
--   untouched — and `sessions_used < sessions_total` becomes false, so all four
--   draw sites stop without one line of them being rewritten.
--
-- The cost is stated rather than hidden: `sessions_total` no longer means "how
-- big the pack was when it was sold", it means "how many credits this pack can
-- ever be drawn on". `sessions_expired` is what makes the original
-- reconstructible — `sessions_total + sessions_expired` is what they bought —
-- and `packLabel` is handed the sum so a ten-pack is not relabelled a
-- seven-pack on the client's own screen. The column comments below say so.
--
-- Two consequences worth having written down before somebody finds them:
--
--   · `redeem_pack_session` answers a booking against an expired pack with
--     'exhausted', not with a word of its own, and src/lib/packDraw.ts renders
--     that as "every session on your pack is already used". For a pack that
--     expired with credits left that sentence is not the reason. The Packages
--     screen is where the expiry is explained, off `sessions_expired` and
--     `expired_at`, and adding a fifth outcome word to an RPC four screens read
--     is not worth doing for a toast.
--   · `refund_pack_session` (part 123) hands a credit BACK by decrementing
--     `sessions_used`, and it does not know about windows. So cancelling a
--     session that was drawn off a pack whose window has since closed puts one
--     credit back on that pack and makes it briefly spendable again — the
--     constraint `sessions_used <= sessions_total` still holds, and the pass
--     will not touch the row a second time because `expired_at` is set. That is
--     left as it is rather than closed off: the client is getting back a credit
--     they were charged for a session that did not happen, and refusing it
--     would be the app keeping somebody's money because a date passed in
--     between. It is written down here so it reads as a decision.
--   · `sessions_pack_draw` (part 370) asks "does this client hold a pack from
--     this coach at all" before it considers the gym's credits, and an expired
--     pack still answers yes. So a session delivered after the window closes is
--     recorded as `pack_draw_shortfall_at` — an hour the coach delivered that
--     nothing paid for — rather than quietly falling through onto the gym's
--     money. That is the right answer and it is the reason the row is kept
--     rather than deleted.
--
-- ── Why nightly, and what a missed night costs ───────────────────────────
--
-- The event is the ABSENCE of a write: nobody inserts a row saying "this pack
-- ran out of time". There is nothing to hang a trigger on, which is part 202's
-- and part 471's reasoning unchanged.
--
-- A pack is therefore spendable until the pass runs on the morning after its
-- last day, and a night the cron does not run is a day longer. Erring in the
-- client's favour by hours is the right direction for the one error this
-- feature can make: the alternative is a credit refused at the moment somebody
-- tries to book with it, on a day they still believed they had it.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · the window, on the package ────────────────────────────────────────

alter table public.trainer_packages add column if not exists validity_days integer;

-- Nullable with NO default, and this is the same refusal part 188 made about a
-- payment term: thirty days, ninety days and a year are conventions in
-- somebody's trade in somebody's country, and a default of any number would put
-- an expiry on every pack every coach on this platform is already selling. NULL
-- is "the coach did not state one", which means the pack does not expire, which
-- is what every pack in this database does today.
alter table public.trainer_packages drop constraint if exists trainer_packages_validity_positive;
alter table public.trainer_packages add constraint trainer_packages_validity_positive
  check (validity_days is null or (validity_days > 0 and validity_days <= 3650));

-- And it is only meaningful on a pack. A membership has no credits to run out
-- of; it is stopped by cancelling it, and a validity on one would be a second,
-- silent way for it to end.
alter table public.trainer_packages drop constraint if exists trainer_packages_validity_is_for_packs;
alter table public.trainer_packages add constraint trainer_packages_validity_is_for_packs
  check (validity_days is null or sessions is not null);

comment on column public.trainer_packages.validity_days is
  'How many days a buyer has to use this pack, from the day they buy it. NULL means it does not expire — there is no default and there must never be one, because a default would put a window on every pack already on sale. Read ONCE, at checkout, and copied onto client_purchases.expires_on; changing it here never touches a pack somebody has already bought.';

-- ── 2 · the window, on the sale ───────────────────────────────────────────

alter table public.client_purchases add column if not exists expires_on date;
alter table public.client_purchases add column if not exists expired_at timestamptz;
alter table public.client_purchases add column if not exists sessions_expired integer not null default 0;

alter table public.client_purchases drop constraint if exists client_purchases_expiry_coherent;
alter table public.client_purchases add constraint client_purchases_expiry_coherent
  check (
    sessions_expired >= 0
    -- A count of credits taken away with no day it happened on is the shape a
    -- half-finished write leaves behind. NOT the reverse, and the asymmetry is
    -- deliberate: a pack whose window closed after the client used every
    -- session has an `expired_at` and a `sessions_expired` of nought, which is
    -- an ordinary and common row. Writing this as an equivalence — the shape
    -- part 192 uses for `refunded_cents` / `refunded_at`, where it is right —
    -- would make `run_pack_expiry` fail on the happiest case it handles.
    and (sessions_expired = 0 or expired_at is not null)
    -- Nothing can expire on a pack that never had a window. This is the
    -- constraint that makes the retroactive case unreachable rather than merely
    -- unwritten: no future pass can take credits off a row that carries no
    -- expiry date.
    and (expired_at is null or expires_on is not null)
  );

comment on column public.client_purchases.expires_on is
  'The last day the credits on this pack can be used, copied from the package''s validity_days at CHECKOUT and never recomputed. NULL means this pack does not expire, which is every pack sold before part 612 and every pack of a package whose coach set no validity. A later edit to the package does not reach this column — see the header of part 612.';
comment on column public.client_purchases.sessions_expired is
  'How many credits the window closed on unspent. Zero means none were lost, never unknown. sessions_total + sessions_expired is what the client originally bought, and packLabel() is handed that sum so the pack keeps its own name.';
comment on column public.client_purchases.expired_at is
  'When run_pack_expiry() closed the window on this pack. NULL means it has not been closed — either it has no window, or its last day has not passed yet.';

comment on column public.client_purchases.sessions_total is
  'How many credits this pack can EVER be drawn on. Written at checkout as what the client bought, and reduced to sessions_used by run_pack_expiry() when a validity window closes — which is how every draw site stops at an expired pack without one of them being rewritten. Add sessions_expired to get what was originally sold.';

-- The nightly pass reads "packs with a window, still open, whose last day has
-- passed". Partial on `expires_on`, because a pack with no window is a pack
-- this query can never want and indexing the nulls would be indexing every row
-- in the table.
create index if not exists client_purchases_expires_idx
  on public.client_purchases (expires_on)
  where expires_on is not null and expired_at is null;

-- ── 3 · the pass ──────────────────────────────────────────────────────────

create or replace function public.run_pack_expiry()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_closed integer := 0;
  v_told   integer := 0;
  v_lost   integer;
  r        record;
begin
  for r in
    select cp.id, cp.client_id, cp.trainer_id, cp.expires_on
      from public.client_purchases cp
     where cp.expires_on is not null
       and cp.expired_at is null
       and cp.sessions_total is not null
       -- The day AFTER the last day. `expires_on` is the last day the credits
       -- can be used, so a pack is still live all of the day it names.
       and cp.expires_on < current_date
       -- A pack that was never paid for has nothing to expire. A pending or
       -- failed checkout is not a window closing on somebody.
       and cp.status = 'paid'
  loop
    -- The count that goes in the message comes back out of the WRITE, not out
    -- of the select above. A booking between the two would draw a credit the
    -- select had already counted as lost, and the coach would be told a number
    -- one too high about somebody's money. Postgres evaluates every SET
    -- expression against the OLD row, so `sessions_total - sessions_used` here
    -- is the balance as it stood the instant this statement locked it.
    --
    -- `expired_at is null` in the WHERE is what makes a second run of this pass
    -- — a retry, or two schedules firing — a no-op rather than a second write
    -- that would zero `sessions_expired` on a pack it had already closed.
    v_lost := null;
    update public.client_purchases cp
       set sessions_total    = coalesce(cp.sessions_used, 0),
           sessions_expired  = greatest(0, cp.sessions_total - coalesce(cp.sessions_used, 0)),
           expired_at        = now()
     where cp.id = r.id
       and cp.expired_at is null
    returning cp.sessions_expired into v_lost;

    -- Nothing returned means somebody else closed it first. Not an error, and
    -- not a reason to tell the coach about a pack already dealt with.
    if v_lost is null then
      continue;
    end if;
    v_closed := v_closed + 1;

    -- ── the conversation ────────────────────────────────────────────────
    --
    -- Only when credits were actually lost. A pack that ran out of time with
    -- nothing on it is not news: part 163 already told the coach on the day the
    -- last session was used, and a second message about the same pack a month
    -- later is the nagging this whole family of notifications refuses.
    --
    -- `notifications.user_id` is `not null references profiles(id)`, so a pack
    -- whose coach deleted their account has nobody to tell. Guarded rather than
    -- left to throw: this runs as a scheduled job, and an exception here costs
    -- every pack after it in the loop.
    if v_lost > 0 and r.trainer_id is not null then
      insert into public.notifications (user_id, title, body, icon, route)
      values (
        r.trainer_id,
        'A session pack has run out of time',
        left(
          -- The name is theirs to give: the coach can already read it through
          -- `profiles_trainer_r_clients`, so this states nothing the recipient
          -- could not already see. A blank or missing name falls back to "A
          -- client", never to an empty string that would render a sentence
          -- starting with a space.
          coalesce(
            (select nullif(btrim(coalesce(p.full_name, '')), '') from public.profiles p where p.id = r.client_id),
            'A client'
          )
          || ' had ' || v_lost || ' session' || case when v_lost = 1 then '' else 's' end
          || ' left on a pack whose validity ran out on ' || to_char(r.expires_on, 'DD Mon YYYY') || '.'
          || ' Those credits can no longer be booked against, and they paid for them.'
          || ' Whether you extend it, sell them something else or leave it is yours to decide — but they will notice, and it is better that you raise it.'
          || ' Payments & Packages has the pack and what it was worth.',
          500),
        'grid',
        '/(trainer)/payments'
      );
      v_told := v_told + 1;
    end if;
  end loop;

  return jsonb_build_object('closed', v_closed, 'told', v_told);
end $fn$;

revoke all on function public.run_pack_expiry() from public, anon, authenticated;

comment on function public.run_pack_expiry() is
  'Nightly. Closes the window on any session pack whose expires_on has passed: sessions_total drops to sessions_used, the difference lands in sessions_expired and the day lands in expired_at. Tells the COACH, by name and with the number, whenever credits were actually lost. Never touches a pack with no expires_on, which is every pack sold before part 612.';

-- ── 4 · the schedule ──────────────────────────────────────────────────────

create extension if not exists pg_cron;

-- Unschedule first so re-running this file does not accumulate duplicate jobs
-- each firing the same pass, exactly as parts 48, 135, 202 and 471 do.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'pack-expiry') then
    perform cron.unschedule('pack-expiry');
  end if;
end $$;

-- 07:33 UTC. Morning rather than the small hours for part 202's reason — this
-- wakes a phone, and a coach whose notifications arrive at 03:17 is a coach who
-- turns notifications off — and seven minutes clear of part 471's 07:26 so the
-- passes do not contend.
select cron.schedule(
  'pack-expiry',
  '33 7 * * *',
  $cron$ select public.run_pack_expiry(); $cron$
);
