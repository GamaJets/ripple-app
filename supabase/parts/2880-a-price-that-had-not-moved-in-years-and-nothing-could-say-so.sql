-- ─────────────────────────────────────────────────────────────────────────
-- A price that had not moved in years, and nothing could say so.
--
-- A gym's price book is the last thing anybody looks at. Memberships are sold
-- on it, renewals inherit it, and the Gold plan quietly stays at the figure it
-- was given when the doors opened — through two rent reviews and a minimum
-- wage rise. The owner finds out from the accountant, about a year they can no
-- longer re-price.
--
-- Ask this database when a plan's price last changed and there is no answer.
-- `membership_plans` (part 29) carries `created_at` and nothing else:
--
--     id, tenant_id, name, price_cents, currency, interval, active, created_at
--
-- `price_cents` is UPDATED IN PLACE. Part 187's header says so in as many words
-- while explaining a different consequence of it — "a member disputing a charge
-- and an owner reading the price book are looking at different months and
-- cannot tell".
--
-- ── The three things that look like an answer and are not ────────────────
--
--   · `created_at`. It is when the ROW was made, and the price at creation is
--     therefore a lower bound on the FIRST setting, not on the last change. A
--     plan opened two years ago and repriced last Tuesday reads off `created_at`
--     as two years stale. Every plan in a long-running gym would be flagged, the
--     screen would be wrong about most of them, and an owner learns within a
--     week to ignore it — which is worse than not shipping it.
--
--   · A row-wide `updated_at`. This is the one the app must never infer from,
--     and it is the reason this column is named for the price rather than for
--     the row. A plan's name gets corrected, a plan gets retired, a later part
--     adds a column and backfills it: each moves a row-wide stamp, and "Gold
--     was repriced last week" would then be printed because somebody fixed a
--     spelling. A stamp that answers a question it was not asked is a stamp
--     that lies quietly.
--
--   · `gym_events` kind 'price-changed' (part 187). It is the right record of
--     WHAT happened and it cannot answer THIS question. `subject_id` is null on
--     that kind, so the plan is named only inside an English sentence in
--     `summary`; and the log begins when part 187 was applied, so the absence of
--     an event means "no change recorded since we started recording" and never
--     "the price has not moved". Part 187's own header settles it: "It is not a
--     temporal table and it does not reconstruct the price book as at a date."
--
-- ── What this adds, and what it deliberately leaves NULL ─────────────────
--
-- One column. `price_changed_at` is NULL on every row that exists when this is
-- applied, and that is the whole design: nothing in this database knows when
-- those prices were last set, so the honest value is "not known". Filling them
-- with `created_at`, or with `now()`, would manufacture exactly the answer this
-- part exists to stop being guessed — and it would manufacture it as a
-- timestamp, which reads as measurement.
--
-- The default is set AFTER the column is added, in that order and not in one
-- statement, because PostgreSQL fills existing rows with a default given at ADD
-- COLUMN time. So: existing rows NULL, every row inserted from here on stamped.
-- A plan created after this part is applied has a `price_changed_at` that can be
-- trusted, and one created before it never will.
--
-- The trigger moves it when `price_cents` OR `currency` changes. Both, because a
-- price is an amount and the money it is in — a gym that re-denominates its
-- price book from AED to GBP without touching the integer has re-priced every
-- membership it sells, and a stamp that ignored the currency would say nothing
-- had happened.
--
-- ── What reads it ────────────────────────────────────────────────────────
--
-- `priceAge` in src/lib/priceBook.ts, on studio-web/app/members. It keeps three
-- answers apart and never collapses them: a price that has not moved in a year,
-- a price that has, and a plan this database cannot answer for — which is every
-- plan until this part is applied, and every plan older than it afterwards. The
-- console reads the column optionally and reports its ABSENCE as "the app cannot
-- tell", so the screen is honest both before this is applied and after.
--
-- No index. A price book is tens of rows and this column is read with the plan
-- it belongs to, never searched on.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.membership_plans
  add column if not exists price_changed_at timestamptz;

-- Second statement, deliberately. See the header: a default given at ADD COLUMN
-- time would be written into every existing row, and a stamp that was invented
-- is indistinguishable afterwards from one that was observed.
alter table public.membership_plans
  alter column price_changed_at set default now();

comment on column public.membership_plans.price_changed_at is
  'When price_cents or currency last changed, as OBSERVED by trg_membership_plan_price. NULL means this database cannot say — the row predates the stamp, or the price has not moved since it was applied. NULL is never to be rendered as "unchanged": a plan with no stamp is a plan nobody can date, and created_at is not a substitute because price_cents is updated in place.';

create or replace function public.stamp_membership_plan_price()
returns trigger
-- SECURITY INVOKER, stated rather than defaulted: this reads and writes only the
-- row the caller is already updating, under the same policies. A definer
-- function here would let a caller stamp a row it cannot otherwise touch.
language plpgsql security invoker set search_path to 'public' as $fn$
begin
  if new.price_cents is distinct from old.price_cents
     or new.currency is distinct from old.currency then
    new.price_changed_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists trg_membership_plan_price on public.membership_plans;
create trigger trg_membership_plan_price
  before update on public.membership_plans
  for each row execute function public.stamp_membership_plan_price();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. Revoked
-- from `anon` BY NAME, because Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon separately from PUBLIC and revoking PUBLIC does not touch it
-- (part 141).
revoke execute on function public.stamp_membership_plan_price() from public, anon, authenticated;

-- ── Deliberately NOT written here ────────────────────────────────────────
--
-- No backfill of any kind. See the header: there is nothing to backfill FROM.
--
-- No history table. This answers "when did this price last move", which is the
-- question an owner acts on, and it does not answer "what was this plan's price
-- in March" — that is a temporal table, it would have to be written before the
-- fact to be worth anything, and part 187 already carries the before-and-after
-- of every change made since it was applied for the dispute that needs it.
--
-- No `gym_events` kind. Part 187 already logs 'price-changed' from its own
-- AFTER UPDATE trigger on this table, and `gym_events_kind_check` is one CHECK
-- holding the whole list — two parts filed in the same wave that both restate it
-- silently drop each other's kinds (part 2730's note, and part 2760 repeats it).
