-- ─────────────────────────────────────────────────────────────────────────
-- Ad spend, collected instead of typed.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- Part 98 gave a coach the three figures that answer "which channel returns
-- money": who joined by which code, what they paid, and what the code cost.
-- The third one is the only one a human has to supply — `set_code_spend`
-- exists because nothing in Repple has ever seen an Instagram invoice.
--
-- A number a person has to re-type every month is a number that goes stale,
-- and a stale spend figure does not read as stale: it reads as a channel that
-- got cheaper. So this part lets the coach connect the ad account itself and
-- have the figure arrive on its own.
--
-- ── Matching is done by the LINK, not by a mapping screen ────────────────
--
-- The coach already puts `https://…/join?c=CODE` in their Instagram bio (see
-- src/lib/joinCode.ts). The same link is what they set as the ad's destination.
-- So the ad already carries the code, and the sync reads `?c=` out of the
-- creative's destination URL. Nothing is mapped by hand, which matters because
-- a mapping screen is a thing that is correct on the day it is filled in and
-- silently wrong every day after.
--
-- ── Absent is not zero, here more than anywhere ──────────────────────────
--
-- Part 98's rule — a missing spend row means UNKNOWN, a zero row means "this
-- cost me nothing" — is what makes an unmeasured campaign show a dash instead
-- of an infinite return. Automatic collection introduces three new ways to be
-- wrong about that, and each one gets its own record here rather than being
-- allowed to collapse into a zero:
--
--   · an ad whose destination carries no `?c=` is UNMATCHED. Its spend is real
--     money that left the coach's account and could not be attributed. It is
--     recorded, with the ad's name and its destination, so the coach sees the
--     money the app could not place rather than believing it does not exist.
--   · a sync that FAILED is not a sync that found nothing. `coach_ad_sync_runs`
--     carries a status and the provider's own words, and a failed run writes no
--     spend at all — it cannot, because it does not know any.
--   · an ad whose spend figure could not be read is recorded with a NULL
--     amount, which is not zero either.
--
-- ── Organic posts are invisible here, and that is not "free" ─────────────
--
-- A code handed out in a class, read into a podcast or posted without a budget
-- behind it will never appear in an ad account. It therefore gets no synced
-- row, keeps whatever the coach typed, and where they typed nothing it stays
-- unknown. The absence of a code from a sync says nothing about what it cost.
--
-- ── Currency ────────────────────────────────────────────────────────────
--
-- An ad account has a currency of its own, set when it was opened, and there is
-- no reason it matches what the coach charges in. Part 98 already refuses to
-- subtract one currency from another; the synced figure is stored in the AD
-- ACCOUNT's currency, honestly labelled, and that refusal then does its job.
-- Nothing here converts, because a converted figure would carry a rate nobody
-- chose on a date nobody recorded.
-- ─────────────────────────────────────────────────────────────────────────

/* ── 1. The token store ──────────────────────────────────────────────────
 *
 * SERVICE ROLE ONLY. There is deliberately no policy of any kind for
 * `authenticated` on this table, and the grants are revoked as well, so the
 * absence of a policy cannot be "fixed" later by somebody adding a grant.
 *
 * The lesson is written down in supabase/functions/ocr-scan/index.ts:
 * EXPO_PUBLIC_OCR_API_KEY was inlined into the app bundle at build time and
 * shipped readable to anyone who unpacked the app. A Meta access token is worse
 * than an OCR key by some distance — it spends money and reads a business's
 * customer data — so it never reaches the device at all. The screen learns
 * whether an account is connected through my_ad_account() below, which returns
 * everything about the connection EXCEPT the two token columns.
 */
create table if not exists public.coach_ad_accounts (
  trainer_id          uuid        not null references public.trainers(id) on delete cascade,
  -- One provider today. Named rather than free text so a typo cannot create a
  -- second, invisible connection that never syncs.
  provider            text        not null check (provider in ('meta')),
  -- Meta's own id for the ad account, in its `act_…` form. Stored because the
  -- token can grant access to several and the coach chose one; syncing a
  -- different account next month would change the figures with no explanation.
  --
  -- NULLABLE, and null is a real state: the coach has authorised us and has not
  -- yet said WHICH of their ad accounts this is about. The alternative was to
  -- pick the first one for them, which decides where a business's spend figures
  -- come from on their behalf and never says so. The sync refuses to run in
  -- this state and the screen asks.
  external_account_id text,
  account_name        text,
  -- Null until a sync has read it. NOT defaulted to anything: an assumed
  -- currency is the exact failure part 98 refuses.
  account_currency    text,
  access_token        text        not null,
  refresh_token       text,
  expires_at          timestamptz,
  -- What Meta actually granted, which is not always what was asked for. Kept so
  -- a sync failing with "no permission" can say which permission.
  scopes              text,
  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (trainer_id, provider)
);

comment on table public.coach_ad_accounts is
  'OAuth tokens for a coach''s connected ad account. Service role only — no authenticated policy or grant exists, and none may be added.';
comment on column public.coach_ad_accounts.account_currency is
  'The currency the AD ACCOUNT bills in, which need not be what the coach charges in. Null until a sync has read it; never assumed.';

alter table public.coach_ad_accounts enable row level security;

-- Belt and braces. RLS with no policy already refuses `authenticated`; the
-- revoke means a future part that adds a policy by accident still cannot read a
-- token, because the privilege is not there to be policed.
revoke all on public.coach_ad_accounts from authenticated, anon;

/* ── 2. What each sync attempt did ───────────────────────────────────────
 *
 * One row per attempt, successful or not. This table is the difference between
 * "your ads brought in nothing" and "we could not ask", and those two sentences
 * send a coach to opposite decisions.
 *
 * Every count is NULLABLE and every count is null on a failed run. A failed run
 * that reported `matched_ads = 0` would be indistinguishable, on screen and in
 * a query, from an account with no ads in it.
 */
create table if not exists public.coach_ad_sync_runs (
  id               uuid        primary key default gen_random_uuid(),
  trainer_id       uuid        not null references public.trainers(id) on delete cascade,
  provider         text        not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text        not null check (status in ('ok', 'failed')),
  -- The provider's own words where there are any. A flattened "sync failed"
  -- cannot tell a coach whether to reconnect, wait, or ask Meta for review.
  failure          text,
  -- Which days were asked for. A figure with no window is not comparable with
  -- anything, including itself last month.
  window_from      date,
  window_to        date,
  account_currency text,
  ads_seen         integer,
  matched_ads      integer,
  unmatched_ads    integer,
  matched_cents    bigint,
  -- Null where any unmatched ad's own amount could not be read: a partial sum
  -- of unattributed money is worse than no sum, because it looks like the
  -- whole of it.
  unmatched_cents  bigint
);

comment on table public.coach_ad_sync_runs is
  'One row per sync attempt. status ''failed'' with null counts means we could not ask — which is not the same as an account with no ads.';

create index if not exists coach_ad_sync_runs_recent
  on public.coach_ad_sync_runs (trainer_id, started_at desc);

/* ── 3. What a run attributed, per code ──────────────────────────────────
 *
 * Kept separately from `coach_code_spend` even when it agrees with it, because
 * the coach has to be able to see the synced figure BESIDE their own where the
 * two differ. `applied` is that difference made visible: false means a manual
 * figure was left in place and this number was recorded and not used.
 */
create table if not exists public.coach_ad_code_spend (
  run_id       uuid        not null references public.coach_ad_sync_runs(id) on delete cascade,
  trainer_id   uuid        not null references public.trainers(id) on delete cascade,
  -- Null is the coach's default code, exactly as in coach_code_spend.
  code_id      uuid        references public.coach_join_codes(id) on delete cascade,
  code         text        not null,
  amount_cents bigint      not null check (amount_cents >= 0 and amount_cents < 100000000000),
  currency     text        not null,
  ads          integer     not null,
  -- False when the coach's own figure was kept instead. See set_synced_spend().
  applied      boolean     not null,
  primary key (run_id, code)
);

comment on column public.coach_ad_code_spend.applied is
  'False when a manually entered figure was kept and this synced one was not used. The coach is shown both.';

/* ── 4. The money that could not be attributed ───────────────────────────
 *
 * The reason this feature is honest. Every ad the sync saw and could not place
 * against a code is listed with its spend and its destination, so a coach can
 * see what the app failed to attribute instead of reading a smaller total as
 * the truth.
 */
create table if not exists public.coach_ad_unmatched (
  id              uuid   primary key default gen_random_uuid(),
  run_id          uuid   not null references public.coach_ad_sync_runs(id) on delete cascade,
  trainer_id      uuid   not null references public.trainers(id) on delete cascade,
  ad_id           text,
  ad_name         text,
  destination_url text,
  -- Nullable, and null is NOT zero: it is an ad whose spend figure the provider
  -- did not give us in a form we could read.
  amount_cents    bigint check (amount_cents is null or (amount_cents >= 0 and amount_cents < 100000000000)),
  currency        text,
  reason          text   not null check (reason in ('no-link', 'no-code', 'unknown-code', 'no-amount'))
);

comment on column public.coach_ad_unmatched.reason is
  'no-link: the ad had no destination we could read. no-code: the destination carried no ?c=. unknown-code: it carried one that is not this coach''s. no-amount: the spend figure was unreadable.';

create index if not exists coach_ad_unmatched_run on public.coach_ad_unmatched (run_id);
create index if not exists coach_ad_code_spend_run on public.coach_ad_code_spend (run_id);

/* ── Reading your own ────────────────────────────────────────────────────
 *
 * These three carry no secrets, so they are read straight through PostgREST
 * with an owner policy — the same shape as every other coach-owned table here.
 * Writes go through the functions below, for the reason part 81 gives: write
 * access to anything attribution-shaped is stated as a revoked privilege rather
 * than as a policy nobody wrote.
 */
alter table public.coach_ad_sync_runs  enable row level security;
alter table public.coach_ad_code_spend enable row level security;
alter table public.coach_ad_unmatched  enable row level security;

drop policy if exists coach_ad_sync_runs_owner_read on public.coach_ad_sync_runs;
create policy coach_ad_sync_runs_owner_read on public.coach_ad_sync_runs
  for select to authenticated using (trainer_id = (select auth.uid()));

drop policy if exists coach_ad_code_spend_owner_read on public.coach_ad_code_spend;
create policy coach_ad_code_spend_owner_read on public.coach_ad_code_spend
  for select to authenticated using (trainer_id = (select auth.uid()));

drop policy if exists coach_ad_unmatched_owner_read on public.coach_ad_unmatched;
create policy coach_ad_unmatched_owner_read on public.coach_ad_unmatched
  for select to authenticated using (trainer_id = (select auth.uid()));

grant select on public.coach_ad_sync_runs  to authenticated;
grant select on public.coach_ad_code_spend to authenticated;
grant select on public.coach_ad_unmatched  to authenticated;
revoke insert, update, delete on public.coach_ad_sync_runs  from authenticated;
revoke insert, update, delete on public.coach_ad_code_spend from authenticated;
revoke insert, update, delete on public.coach_ad_unmatched  from authenticated;
revoke all on public.coach_ad_sync_runs  from anon;
revoke all on public.coach_ad_code_spend from anon;
revoke all on public.coach_ad_unmatched  from anon;

/* ── Manual beats synced, and says so ────────────────────────────────────
 *
 * THE PRECEDENCE, decided here once so no screen has to guess it:
 *
 *   A figure the coach typed WINS over a figure the sync found, always, and the
 *   synced figure is still recorded and still shown beside it.
 *
 * Why that way round. The synced figure is an inference from an API that can
 * only see ads whose destination happens to carry a `?c=`; the typed figure is
 * a claim a person made about their own money, and may well include the agency
 * fee, the boosted post made from the phone, or the month Meta billed twice.
 * Silently replacing it would change a number the coach is making budget
 * decisions on, without telling them, in the direction of the more ignorant
 * source. The reverse mistake — a stale manual figure sitting there — is
 * visible on the screen, which shows both and offers to take the synced one.
 *
 * `source` is how the rule is enforced, and it is stamped by a TRIGGER rather
 * than by the callers. set_code_spend() in part 98 does not know this column
 * exists and must not have to: a coach typing over a synced figure has to leave
 * a MANUAL row behind, or the next sync would overwrite what they just typed.
 * Every write not explicitly announced as a sync is therefore a manual one,
 * which is the safe direction to be wrong in.
 *
 * Clearing the field (set_code_spend with a null amount) DELETES the row, so it
 * also hands the code back to the sync — the coach has said they do not know,
 * and the sync does. That falls out of the rule rather than being a special
 * case.
 */
alter table public.coach_code_spend
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coach_code_spend_source_known'
  ) then
    alter table public.coach_code_spend
      add constraint coach_code_spend_source_known check (source in ('manual', 'synced'));
  end if;
end $$;

comment on column public.coach_code_spend.source is
  'Who put this figure here. Existing rows are ''manual'' because every figure predating ad sync was typed by a person. A manual figure is never overwritten by a synced one.';

create or replace function public.coach_code_spend_stamp_source()
returns trigger language plpgsql set search_path = public as $$
begin
  -- A transaction-local setting, not auth.uid(): both set_code_spend() and the
  -- sync writer are SECURITY DEFINER, so the row itself cannot say who wrote it
  -- and the caller has to. Anything that has not announced itself is manual —
  -- being wrong that way keeps a coach's typing, being wrong the other way
  -- destroys it.
  new.source := case
    when coalesce(current_setting('repple.ad_sync', true), '') = 'on' then 'synced'
    else 'manual'
  end;
  return new;
end; $$;

drop trigger if exists coach_code_spend_source_stamp on public.coach_code_spend;
create trigger coach_code_spend_source_stamp
  before insert or update on public.coach_code_spend
  for each row execute function public.coach_code_spend_stamp_source();

/**
 * Write one code's spend as the SYNC, following exactly the rules
 * set_code_spend() follows — same table, same bounds, same upsert-onto-a-
 * partial-index shape, same refusal to store an amount with no currency.
 *
 * It cannot BE set_code_spend(): that function is scoped by auth.uid(), and the
 * edge function runs as the service role where auth.uid() is null. So it takes
 * the trainer explicitly and is revoked from every role a person can hold.
 *
 * Returns true when the figure was written, false when a manual figure was
 * found and kept. The caller records that answer against the run so the screen
 * can show the coach both numbers and which one is in use.
 */
create or replace function public.set_synced_spend(
  p_trainer_id uuid,
  p_code_id uuid,
  p_amount_cents bigint,
  p_currency text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ccy       text := nullif(btrim(upper(coalesce(p_currency, ''))), '');
  existing  text;
begin
  if p_trainer_id is null then
    raise exception 'no trainer';
  end if;
  -- No fallback to the coach's own selling currency here, deliberately. This
  -- figure is denominated in whatever the AD ACCOUNT bills in; borrowing the
  -- currency of their packages would relabel dollars as dirhams and part 98
  -- would then happily subtract one from the other.
  if ccy is null or length(ccy) not between 3 and 4 then
    raise exception 'a synced spend must carry the ad account''s own currency';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents >= 100000000000 then
    raise exception 'that is not an amount of ad spend';
  end if;
  if p_code_id is not null and not exists (
    select 1 from public.coach_join_codes c where c.id = p_code_id and c.trainer_id = p_trainer_id
  ) then
    raise exception 'that code is not one of theirs';
  end if;

  select s.source into existing
  from public.coach_code_spend s
  where s.trainer_id = p_trainer_id and s.code_id is not distinct from p_code_id;

  -- The precedence, in one line. A row the coach typed stays.
  if existing = 'manual' then
    return false;
  end if;

  perform set_config('repple.ad_sync', 'on', true);
  update public.coach_code_spend s
     set amount_cents = p_amount_cents, currency = ccy, updated_at = now()
   where s.trainer_id = p_trainer_id and s.code_id is not distinct from p_code_id;
  if not found then
    insert into public.coach_code_spend (trainer_id, code_id, amount_cents, currency)
    values (p_trainer_id, p_code_id, p_amount_cents, ccy);
  end if;
  perform set_config('repple.ad_sync', 'off', true);
  return true;
end; $$;

/**
 * Record one sync attempt, whole, in one transaction.
 *
 * Written as a single call rather than as inserts from the edge function so a
 * run cannot be half-recorded: a run row with no unmatched rows beside it would
 * tell a coach every penny was attributed.
 *
 * p_matched:   [{ "code_id": uuid|null, "code": text, "cents": number, "ads": number }]
 * p_unmatched: [{ "ad_id": text, "ad_name": text, "url": text, "cents": number|null,
 *                 "reason": 'no-link'|'no-code'|'unknown-code'|'no-amount' }]
 *
 * A FAILED run writes no spend at all, and its counts stay null. It knows
 * nothing; recording zeros would be inventing an answer for it.
 */
create or replace function public.record_ad_sync(
  p_trainer_id uuid,
  p_provider text,
  p_status text,
  p_failure text,
  p_from date,
  p_to date,
  p_currency text,
  p_ads_seen integer,
  p_matched jsonb,
  p_unmatched jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  run_id      uuid;
  m           jsonb;
  u           jsonb;
  applied     boolean;
  n_matched   integer := 0;
  n_unmatched integer := 0;
  sum_matched bigint  := 0;
  sum_unmatch bigint  := 0;
  -- Any unreadable amount makes the unmatched TOTAL unknown rather than short.
  any_no_amt  boolean := false;
  ccy         text    := nullif(btrim(upper(coalesce(p_currency, ''))), '');
begin
  if p_trainer_id is null then raise exception 'no trainer'; end if;
  if p_status not in ('ok', 'failed') then raise exception 'a run either worked or it did not'; end if;

  insert into public.coach_ad_sync_runs (trainer_id, provider, finished_at, status, failure, window_from, window_to, account_currency)
  values (p_trainer_id, p_provider, now(), p_status, nullif(btrim(coalesce(p_failure, '')), ''), p_from, p_to, ccy)
  returning id into run_id;

  if p_status <> 'ok' then
    return run_id;
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_matched, '[]'::jsonb)) loop
    applied := public.set_synced_spend(
      p_trainer_id,
      nullif(m->>'code_id', '')::uuid,
      (m->>'cents')::bigint,
      ccy
    );
    insert into public.coach_ad_code_spend (run_id, trainer_id, code_id, code, amount_cents, currency, ads, applied)
    values (run_id, p_trainer_id, nullif(m->>'code_id', '')::uuid, upper(m->>'code'),
            (m->>'cents')::bigint, ccy, coalesce((m->>'ads')::integer, 0), applied)
    on conflict (run_id, code) do nothing;
    n_matched := n_matched + coalesce((m->>'ads')::integer, 0);
    sum_matched := sum_matched + (m->>'cents')::bigint;
  end loop;

  for u in select * from jsonb_array_elements(coalesce(p_unmatched, '[]'::jsonb)) loop
    insert into public.coach_ad_unmatched (run_id, trainer_id, ad_id, ad_name, destination_url, amount_cents, currency, reason)
    values (run_id, p_trainer_id, u->>'ad_id', u->>'ad_name', u->>'url',
            case when u->>'cents' is null then null else (u->>'cents')::bigint end,
            case when u->>'cents' is null then null else ccy end,
            u->>'reason');
    n_unmatched := n_unmatched + 1;
    if u->>'cents' is null then
      any_no_amt := true;
    else
      sum_unmatch := sum_unmatch + (u->>'cents')::bigint;
    end if;
  end loop;

  update public.coach_ad_sync_runs
     set ads_seen = coalesce(p_ads_seen, n_matched + n_unmatched),
         matched_ads = n_matched,
         unmatched_ads = n_unmatched,
         matched_cents = sum_matched,
         unmatched_cents = case when any_no_amt then null else sum_unmatch end
   where id = run_id;

  return run_id;
end; $$;

/**
 * Store a freshly exchanged token. Called only by the ads-oauth function.
 *
 * Separate from a bare upsert so the edge function never needs table privileges
 * of its own, and so reconnecting keeps `connected_at` — the coach's own memory
 * of when they linked the account — while everything else is replaced.
 */
create or replace function public.store_ad_account(
  p_trainer_id uuid,
  p_provider text,
  p_external_account_id text,
  p_account_name text,
  p_account_currency text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scopes text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_trainer_id is null or coalesce(btrim(p_access_token), '') = '' then
    raise exception 'a connection needs a trainer and a token';
  end if;
  if not exists (select 1 from public.trainers t where t.id = p_trainer_id) then
    raise exception 'no trainer profile for this account';
  end if;

  insert into public.coach_ad_accounts
    (trainer_id, provider, external_account_id, account_name, account_currency,
     access_token, refresh_token, expires_at, scopes, updated_at)
  values
    (p_trainer_id, p_provider, p_external_account_id, nullif(btrim(coalesce(p_account_name, '')), ''),
     nullif(btrim(upper(coalesce(p_account_currency, ''))), ''),
     p_access_token, p_refresh_token, p_expires_at, nullif(btrim(coalesce(p_scopes, '')), ''), now())
  on conflict (trainer_id, provider) do update
    set external_account_id = excluded.external_account_id,
        account_name        = excluded.account_name,
        account_currency    = excluded.account_currency,
        access_token        = excluded.access_token,
        refresh_token       = excluded.refresh_token,
        expires_at          = excluded.expires_at,
        scopes              = excluded.scopes,
        updated_at          = now();
end; $$;

/**
 * Say which of the coach's ad accounts this connection is about.
 *
 * Split from store_ad_account() so that choosing an account never has to carry
 * a token: the token is already stored, the app has only ever seen the account
 * list (an id, a name, a currency — none of it secret), and the coach's choice
 * comes back as an id. The edge function verifies with Meta that the id really
 * is on the token before calling this.
 */
create or replace function public.choose_ad_account(
  p_trainer_id uuid,
  p_provider text,
  p_external_account_id text,
  p_account_name text,
  p_account_currency text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(coalesce(p_external_account_id, '')), '') = '' then
    raise exception 'an ad account needs an id';
  end if;
  update public.coach_ad_accounts a
     set external_account_id = p_external_account_id,
         account_name        = nullif(btrim(coalesce(p_account_name, '')), ''),
         account_currency    = nullif(btrim(upper(coalesce(p_account_currency, ''))), ''),
         updated_at          = now()
   where a.trainer_id = p_trainer_id and a.provider = p_provider;
  if not found then
    raise exception 'there is no connection to attach that account to';
  end if;
end; $$;

/**
 * The connection, without the token.
 *
 * This is the only way the app learns anything about `coach_ad_accounts`, and
 * it returns no token column. `expires_soon` is computed here rather than by
 * handing the app an expiry to reason about, because "reconnect" is the only
 * action a coach can take and the server is the one that knows when it is due.
 */
create or replace function public.my_ad_account()
returns table (
  provider text, external_account_id text, account_name text,
  account_currency text, connected_at timestamptz, updated_at timestamptz,
  scopes text, expires_soon boolean
)
language sql security definer stable set search_path = public as $$
  select a.provider, a.external_account_id, a.account_name,
         a.account_currency, a.connected_at, a.updated_at, a.scopes,
         -- Null expiry means a token with no stated end. Reported as not-soon
         -- rather than as unknown because the coach's only remedy is the same
         -- either way, and the sync says plainly when a token is refused.
         (a.expires_at is not null and a.expires_at < now() + interval '7 days') as expires_soon
  from public.coach_ad_accounts a
  where a.trainer_id = (select auth.uid());
$$;

/**
 * Where each recorded spend figure came from.
 *
 * my_code_returns() reports the figure and part 98 owns it; it does not report
 * who put it there, and it cannot be asked to without editing part 98. The
 * screen needs the answer, because "£400, which you typed" and "£400, which we
 * read off Meta this morning" are different claims and only one of them is
 * about to be replaced by the next sync.
 *
 * Reads only rows the coach owns, so it is safe as SECURITY DEFINER.
 */
create or replace function public.my_spend_sources()
returns table (code_id uuid, source text, amount_cents bigint, currency text, updated_at timestamptz)
language sql security definer stable set search_path = public as $$
  select s.code_id, s.source, s.amount_cents, upper(s.currency), s.updated_at
  from public.coach_code_spend s
  where s.trainer_id = (select auth.uid());
$$;

/**
 * Disconnect. Deletes the token row — there is no policy that would let the app
 * do this itself, which is the point of the table.
 *
 * The sync history is deliberately kept. What a campaign cost last month did
 * not stop being true because the account was unlinked, and part 98's figures
 * are computed off `coach_code_spend`, which also stays. Cascading the deletes
 * would quietly rewrite the coach's own history of what their channels cost.
 */
create or replace function public.disconnect_ad_account(p_provider text default 'meta')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n   integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.coach_ad_accounts a where a.trainer_id = uid and a.provider = p_provider;
  get diagnostics n = row_count;
  return n > 0;
end; $$;

/**
 * Hand one code back to the sync: take the synced figure and use it.
 *
 * The coach's way of resolving the override the screen shows them. It writes
 * the most recent synced figure for that code with source 'synced', so the next
 * sync keeps it current rather than stopping at a manual row again.
 *
 * Raises where there is no synced figure to take, rather than clearing the
 * manual one — "use the synced figure" must never be a way to end up with no
 * figure at all.
 */
create or replace function public.use_synced_spend(p_code_id uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  cents bigint;
  ccy   text;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select s.amount_cents, s.currency into cents, ccy
  from public.coach_ad_code_spend s
  join public.coach_ad_sync_runs r on r.id = s.run_id and r.status = 'ok'
  where s.trainer_id = uid and s.code_id is not distinct from p_code_id
  order by r.started_at desc
  limit 1;

  if cents is null then
    raise exception 'no synced figure has been found for that code yet';
  end if;

  perform set_config('repple.ad_sync', 'on', true);
  update public.coach_code_spend s
     set amount_cents = cents, currency = ccy, updated_at = now()
   where s.trainer_id = uid and s.code_id is not distinct from p_code_id;
  if not found then
    insert into public.coach_code_spend (trainer_id, code_id, amount_cents, currency)
    values (uid, p_code_id, cents, ccy);
  end if;
  perform set_config('repple.ad_sync', 'off', true);
  return cents;
end; $$;

/* Only the service role runs the two writers; only a signed-in coach runs the
 * three readers and the two actions. `public` is revoked first in every case —
 * execute is granted to public by default, and a function that spends money or
 * holds a token must not rely on nobody having noticed. */
revoke all on function public.set_synced_spend(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.record_ad_sync(uuid, text, text, text, date, date, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.store_ad_account(uuid, text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.choose_ad_account(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.coach_code_spend_stamp_source() from public, anon;
revoke all on function public.my_ad_account() from public, anon;
revoke all on function public.my_spend_sources() from public, anon;
revoke all on function public.disconnect_ad_account(text) from public, anon;
revoke all on function public.use_synced_spend(uuid) from public, anon;

grant execute on function public.set_synced_spend(uuid, uuid, bigint, text) to service_role;
grant execute on function public.record_ad_sync(uuid, text, text, text, date, date, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.store_ad_account(uuid, text, text, text, text, text, text, timestamptz, text) to service_role;
grant execute on function public.choose_ad_account(uuid, text, text, text, text) to service_role;
grant execute on function public.my_ad_account() to authenticated;
grant execute on function public.my_spend_sources() to authenticated;
grant execute on function public.disconnect_ad_account(text) to authenticated;
grant execute on function public.use_synced_spend(uuid) to authenticated;

comment on function public.record_ad_sync is
  'Records one sync attempt whole: the run, what it attributed per code, and every ad it could not attribute. A failed run records no spend and no counts.';
comment on function public.set_synced_spend is
  'Writes a synced spend figure unless the coach typed one. Returns false when theirs was kept — the coach is shown both.';
comment on function public.my_ad_account is
  'Whether this coach has an ad account connected, and which. Returns no token — the tokens are readable by the service role alone.';
comment on function public.use_synced_spend is
  'Replaces the coach''s own figure for one code with the latest synced one, at their explicit request.';
