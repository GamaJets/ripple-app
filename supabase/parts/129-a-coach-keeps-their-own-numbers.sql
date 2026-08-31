-- ── Everything a coach told the app about themselves stayed on the handset ──
--
-- Three roadmap items, one defect. A coach's own settings and their own figures
-- were written to AsyncStorage and nowhere else, so a reinstall erased them, a
-- second phone had a different set, and nothing the coach had said about their
-- own business survived a new device:
--
--   1. app/(trainer)/class-checkin.tsx held the per-attendee pay rate in
--      `useState('')`. It was never persisted anywhere at all — not even to the
--      device — so payroll arithmetic restarted from an empty box on every
--      single visit to the screen, and a coach checking in four classes a day
--      retyped their own rate four times.
--
--   2. src/ui/trainerGoals.ts kept the monthly revenue target and the client
--      target under 'repple.trainer.goals'. A coach who set a target, reinstalled
--      and opened Analytics was told "No targets set" — a sentence about them,
--      produced by a wiped keychain.
--
--   3. src/ui/useMrrHistory.ts kept the whole monthly trend under
--      'repple.trainer.revHistory' / 'repple.owner.sessionsHistory'. That one is
--      the worst of the three, because the trend is the only record of the past
--      that exists: nothing recomputes March from source. A reinstall did not
--      degrade the chart, it deleted five months of a business's history with no
--      way to get them back.
--
-- ── Two tables, and why they are not one ───────────────────────────────────
--
-- `coach_prefs` is one row per account: settings, overwritten in place.
-- `metric_history` is one row per account per metric per month: a ledger, only
-- ever appended to and never rewritten backwards. Folding the second into a
-- jsonb column on the first would make a month's snapshot a read-modify-write
-- of the whole history, which is exactly how two devices open in the same week
-- lose one device's months.
--
-- ── Neither table carries a currency, deliberately ─────────────────────────
--
-- `coach_prefs.class_rate` is a bare number. The check-in screen says so out
-- loud — "Your own arithmetic — Repple is not told your rate and does not
-- process this payment" — and the version before it printed "You'll be paid AED
-- {rate × present}", a payout figure, in a currency left over from a deleted
-- branch list, for a payment this product does not make. Storing the number is
-- what stops the retyping; storing it WITH an assumed unit would put the
-- deleted bug back in the database, where it would outlive the screen. The unit
-- of a coach's pay rate is between the coach and whoever pays them.
--
-- `metric_history.value` is the same: a bare number whose unit is whatever the
-- metric_key means. 'repple.trainer.revHistory' happens to be money — priced at
-- render time from `tenants.currency` (part 99), which may be null, in which
-- case the app shows a dash and asks the owner to set one. Nothing here may
-- ever be printed with a currency this table did not record.
--
-- ── Access ─────────────────────────────────────────────────────────────────
--
-- Self-only, on both, on every verb. There is no coach-reads-coach case and no
-- owner-reads-coach case: a coach's revenue target is not their employer's
-- business, and the class rate is a private number about their own pay. That is
-- narrower than most of this schema and it is meant to be — nothing else needs
-- to read either table, so nothing else may.
--
-- Keyed on auth.users rather than on `trainers`, and not restricted to the
-- trainer role. `metric_history` is used by the OWNER dashboard as well (the
-- sessions trend on app/(owner)/dashboard.tsx and revenue.tsx), and a role
-- check would have needed a SECURITY DEFINER helper to avoid recursing through
-- profiles — a whole new hole to get right for no gain, when `user_id =
-- auth.uid()` already admits exactly one person's rows whatever their role.
--
-- The GRANT is written out rather than left to Supabase's stock default
-- privileges, which hand `anon` the full DML set on every table created in this
-- project (part 119 found that on 80 of 89 tables). RLS narrows a GRANT; it
-- does not confer one, and it is not the thing to lean on when the grant itself
-- has no business existing. `anon` cannot reach either table at all — not
-- refused by a policy, refused at the grant.

create table if not exists public.coach_prefs (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- Per-attendee class pay rate. NULL means the coach has not set one, which is
  -- a different fact from 0 and must render as an empty box, never as a rate of
  -- nothing. numeric, not integer: half-unit rates are ordinary.
  class_rate   numeric(12,2),
  -- Monthly revenue target and client-count target. NULL means never set. The
  -- app's own DEFAULT for an unset goal is 0 and it renders as "no target",
  -- which is the same statement; NULL is kept as the storage form so a coach who
  -- deliberately clears a target is distinguishable from one who never had one.
  goal_revenue integer,
  goal_clients integer,
  updated_at   timestamptz not null default now()
);

alter table public.coach_prefs drop constraint if exists coach_prefs_class_rate_sane;
alter table public.coach_prefs add constraint coach_prefs_class_rate_sane
  check (class_rate is null or class_rate >= 0);
alter table public.coach_prefs drop constraint if exists coach_prefs_goals_sane;
alter table public.coach_prefs add constraint coach_prefs_goals_sane
  check ((goal_revenue is null or goal_revenue >= 0) and (goal_clients is null or goal_clients >= 0));

alter table public.coach_prefs enable row level security;

drop policy if exists coach_prefs_self on public.coach_prefs;
create policy coach_prefs_self on public.coach_prefs
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.coach_prefs is
  'One row per account: the coach''s own settings. Self-only on every verb — no owner and no other coach may read it. class_rate is a UNITLESS number; the app must never print it with an assumed currency.';
comment on column public.coach_prefs.class_rate is
  'Per-attendee class pay rate as the coach typed it. No currency: Repple is not the payer and does not know one. NULL = not set, which is not 0.';

-- ── The month ledger ───────────────────────────────────────────────────────
--
-- `month` is the 'YYYY-MM' string the app already keys its history by, kept
-- verbatim rather than converted to a date. It is a label for a calendar month
-- in the reader's own local time — the app computes it with `new Date()` on the
-- device — and turning it into a timestamptz would attach a timezone to
-- something that does not have one, which is how a coach in Auckland gets their
-- January filed under December.
--
-- The check constraint is the whole of the validation: a bad key here is a
-- point on a trend chart in the wrong place forever, and there is nothing later
-- that can spot it.
--
-- ON CONFLICT DO UPDATE is how the app writes this, so the current month's
-- snapshot is refreshed as the month goes on and a closed month stops moving.
create table if not exists public.metric_history (
  user_id     uuid  not null references auth.users(id) on delete cascade,
  -- The app's own storage key for the series, reused verbatim so there is no
  -- translation table between what the device wrote and what the server holds.
  metric_key  text  not null,
  month       text  not null,
  -- Bare. The unit is whatever metric_key means; see the note at the top.
  value       numeric not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, metric_key, month)
);

alter table public.metric_history drop constraint if exists metric_history_month_is_ym;
alter table public.metric_history add constraint metric_history_month_is_ym
  check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
alter table public.metric_history drop constraint if exists metric_history_key_sane;
alter table public.metric_history add constraint metric_history_key_sane
  check (char_length(metric_key) between 1 and 64);

alter table public.metric_history enable row level security;

drop policy if exists metric_history_self on public.metric_history;
create policy metric_history_self on public.metric_history
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No secondary index. Every read is `where user_id = ? and metric_key = ?`,
-- which is a left-anchored prefix of the primary key.

comment on table public.metric_history is
  'One monthly snapshot per account per metric. Append-and-refresh: a month absent from this table is UNKNOWN, and the app renders it as a gap in the line rather than carrying the current figure backwards. Self-only on every verb.';
comment on column public.metric_history.month is
  'Calendar month as YYYY-MM in the recording device''s local time. Not a timestamp — it has no timezone.';
comment on column public.metric_history.value is
  'A bare number. Its unit is defined by metric_key and is NOT recorded here; never render it with an assumed currency.';

-- ── The grants ─────────────────────────────────────────────────────────────
--
-- Stock Supabase default privileges would have given `anon` select/insert/
-- update/delete on both of these the moment they were created. Nothing
-- unauthenticated has any business at either table, and no policy above can
-- resolve without auth.uid(), so the grant is removed rather than left to fail
-- closed by luck. TRUNCATE goes with it for the reason part 119 gives: RLS does
-- not apply to TRUNCATE at all.
revoke all on public.coach_prefs    from anon, public;
revoke all on public.metric_history from anon, public;
grant select, insert, update, delete on public.coach_prefs    to authenticated;
grant select, insert, update, delete on public.metric_history to authenticated;
grant all    on public.coach_prefs    to service_role;
grant all    on public.metric_history to service_role;
