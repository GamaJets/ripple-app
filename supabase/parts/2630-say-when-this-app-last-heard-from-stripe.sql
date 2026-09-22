-- When this app last heard from Stripe.
--
-- ── The two empty screens that look identical ─────────────────────────────
--
-- Every figure under "Taken Through Stripe" in app/(trainer)/payments.tsx is
-- read from `client_purchases` and `client_subscription_payments`. Both tables
-- are written by one thing: supabase/functions/stripe-webhook. Nothing else in
-- this repository inserts into either.
--
-- So when a coach opens Payments and sees nothing, there are two completely
-- different worlds behind that screen and the app draws them the same way:
--
--   · nobody has bought anything yet — a real, ordinary answer, and the one
--     every one of the seven live coaches starts in;
--   · the webhook has never been reached — a wrong endpoint in the Stripe
--     dashboard, a signing secret that does not match, a function deployed
--     WITH jwt verification so Stripe's unsigned POST is refused at the door.
--     Money HAS moved, the client was charged, and this app was never told.
--
-- The second is a production incident that presents as a quiet week. There is
-- no alert for it anywhere in this product and no screen a coach could look at
-- to tell the two apart, because the only evidence either way is in a table no
-- build has ever read.
--
-- `stripe_webhook_events` is that evidence. supabase/parts/97 created it as a
-- replay ledger — the event id is written AFTER its handler succeeds, so a
-- retry of something already done is skipped — and the side effect of that
-- design is a dated record of every webhook this project has ever completed.
-- Three rows are live today. Nothing in `app/` or `src/` reads it.
--
-- ── Why this is a function and not a grant ────────────────────────────────
--
-- Part 147 revoked SELECT on the table from `anon` and `authenticated` and
-- gave it a `using (false)` policy, deliberately, and its header explains what
-- it found: the table had been answering `0 rows` to strangers rather than
-- refusing, because it still carried stock grants and RLS alone was holding
-- it. None of that is being undone here. The rows carry Stripe event ids and
-- event types — `evt_…`, `checkout.session.completed` — which are keys into
-- another company's API and are nobody's business but the webhook's.
--
-- What a coach needs is not a row. It is two scalars: the instant of the most
-- recent handled event, and how many have ever been handled. This function
-- answers exactly those and nothing else, so the ledger stays unreadable and
-- the question stops being unanswerable.
--
-- ── Why every signed-in caller, and not only coaches ──────────────────────
--
-- Because this fact is not tenant-scoped and cannot be made so. The table has
-- three columns — id, type, handled_at — and no tenant, no coach and no
-- customer. There is no per-coach heartbeat to return, and the screen that
-- shows this says so in the coach's own words rather than letting them read it
-- as a fact about their own sales.
--
-- A role gate was written and taken out again. It would have had to read
-- `trainers` or `profiles` to decide, and that read can fail — at which point
-- a diagnostic built to tell two silences apart answers with a third one. The
-- thing being disclosed is "this deployment completed a Stripe webhook at
-- 09:14", to somebody already signed in to the deployment. That is operational
-- weather, it names no person, no amount and no event id, and paying for it
-- with a failure mode inside the diagnostic itself is the wrong trade.
--
-- `anon` is a different question and the answer there is no: an unauthenticated
-- caller holding the publishable key compiled into the shipped app learns
-- nothing from this. Revoked from `public` AND from `anon` by name — Postgres
-- grants EXECUTE to PUBLIC on every new function and Supabase's own default
-- privileges grant it to `anon` separately, so revoking one is not revoking the
-- other. Part 141 measured that and part 940 states it again.

create or replace function public.stripe_last_heard()
returns table (last_at timestamptz, events bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  -- Aggregates over an empty table give exactly one row: `null` and `0`. That
  -- is the whole point — a caller that got no row back could not tell "never
  -- heard" from "the call failed", which is the pair of silences this function
  -- exists to separate.
  select max(e.handled_at) as last_at, count(*)::bigint as events
  from public.stripe_webhook_events e;
$fn$;

revoke all on function public.stripe_last_heard() from public;
revoke all on function public.stripe_last_heard() from anon;
grant execute on function public.stripe_last_heard() to authenticated;
