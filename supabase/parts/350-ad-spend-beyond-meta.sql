-- ─────────────────────────────────────────────────────────────────────────
-- Ad spend beyond Meta: Google Ads and TikTok, and the arithmetic of three.
--
-- ── What part 100 could not say ──────────────────────────────────────────
--
-- Part 100 collected ad spend from Meta and wrote it, per code, into
-- `coach_code_spend`, where part 98 divides it into revenue to produce a
-- cost-per-client. One channel makes that easy: there is one figure, it is
-- either read or it is not, and `set_synced_spend` writes it or keeps the
-- coach's own.
--
-- A coach who also advertises on Google and TikTok breaks that in a way nothing
-- in part 100 would have noticed. Three channels write to the SAME row. The
-- last sync to run would overwrite the other two, so a coach spending £400 on
-- Meta and £250 on Google would be shown whichever of the two happened to sync
-- most recently — and shown it as their ad spend, with no mark on it. There is
-- no error state in that. It is simply a smaller number.
--
-- ── The rule this part adds ──────────────────────────────────────────────
--
--   The figure in `coach_code_spend` is the SUM across every channel the coach
--   has connected and chosen an account on — and it is written ONLY when every
--   one of those channels has been read and they all bill in the same currency.
--   Where any of them has not, the synced figure is REMOVED rather than left
--   standing, and part 98 reports the code's cost as unknown.
--
-- Removed, not left, and that is the decision worth arguing with. The
-- alternative is to leave the last complete figure in place, which sounds
-- kinder and is the failure this whole feature exists to prevent: a coach who
-- connects TikTok on Tuesday and whose first TikTok check fails would keep
-- seeing Monday's Meta-only figure, unchanged, on a screen that now claims to
-- cover three channels. A smaller number that looks exactly like a real one is
-- how the £600 campaign came to be reported as £0 in the first place. A dash is
-- a worse-looking answer and a true one, and part 98 already renders it: a
-- missing spend row is UNKNOWN there, never nought, and a code with no spend
-- shows no return rather than an infinite one.
--
-- The coach's own typed figure is untouched by all of this. It always was the
-- one that wins (part 100), it is `source = 'manual'`, and nothing here deletes
-- or overwrites a manual row. A coach who wants a number on the screen while a
-- channel is down types one, exactly as they did before any of this existed.
--
-- ── What is NOT changed ──────────────────────────────────────────────────
--
-- The Meta App Review gate. `ads_read` is still granted only after review, the
-- screen still says so first, and nothing here weakens it. Google Ads and
-- TikTok are separate APIs with separate credentials and separate approvals;
-- one being gated says nothing about the other two, which is why they did not
-- wait for it.
--
-- `my_ad_account()` keeps its shape and now names Meta explicitly. It returned
-- every row for the coach and the app took the first, which was correct while
-- one provider existed and would silently start reporting a Google connection
-- as a Meta one the day a second appeared — in a build shipped before this
-- part, on a phone nobody is going to update first. So it is pinned to 'meta'
-- and `my_ad_channels()` below is what a current build reads.
-- ─────────────────────────────────────────────────────────────────────────

/* ── 1. Two more providers ──────────────────────────────────────────────── */

do $$
begin
  alter table public.coach_ad_accounts drop constraint if exists coach_ad_accounts_provider_check;
  alter table public.coach_ad_accounts
    add constraint coach_ad_accounts_provider_check
    check (provider in ('meta', 'google', 'tiktok'));
end $$;

-- Google alone needs this. A Google Ads login usually reaches its accounts
-- THROUGH a manager account, and every call then has to carry the manager's id
-- in a `login-customer-id` header as well as the customer id in the path.
-- Without it a perfectly valid token is refused for a perfectly valid account,
-- with an error about permissions that reads like the App Review gate and is
-- not. Null for a direct account, and null is correct there — the header is
-- omitted rather than sent empty.
alter table public.coach_ad_accounts
  add column if not exists manager_account_id text;

comment on column public.coach_ad_accounts.manager_account_id is
  'Google Ads only: the manager account a customer is reached through, sent as login-customer-id. Null for an account the login owns directly.';

/* ── 2. The latest run on each channel ───────────────────────────────────
 *
 * Every question this part asks starts here: for each channel the coach has
 * connected, what does its most recent sync say. `chosen` is the distinction
 * that keeps a half-made connection from poisoning the total — a coach who has
 * authorised Google and not yet said WHICH ad account it is about has nothing
 * to read and will not have until they choose, so that connection is not an
 * unread channel, it is an unfinished one, and the screen asks about it
 * separately.
 *
 * `status` is 'never' where no sync has ever run. Deliberately not left null:
 * "never checked" and "checked and failed" are both UNKNOWN for the purposes of
 * a total and they are different sentences to a coach, so both are named rather
 * than one being an absence.
 *
 * Takes a trainer id, so it is service-role only and is called by the SECURITY
 * DEFINER functions below on behalf of a coach who has already been identified.
 */
create or replace function public.latest_ad_runs(p_trainer_id uuid)
returns table (
  provider text, run_id uuid, status text, account_currency text,
  started_at timestamptz, chosen boolean
)
language sql stable security definer set search_path = public as $$
  select a.provider,
         r.id,
         coalesce(r.status, 'never'),
         r.account_currency,
         r.started_at,
         (a.external_account_id is not null)
    from public.coach_ad_accounts a
    left join lateral (
      select x.id, x.status, x.account_currency, x.started_at
        from public.coach_ad_sync_runs x
       where x.trainer_id = p_trainer_id and x.provider = a.provider
       order by x.started_at desc
       limit 1
    ) r on true
   where a.trainer_id = p_trainer_id;
$$;

comment on function public.latest_ad_runs is
  'Each connected channel and its most recent sync. status ''never'' means connected and never checked, which is unknown rather than nothing.';

/* ── 3. The combined figure, or none at all ──────────────────────────────
 *
 * Called after every sync, after a channel is connected, and after one is
 * disconnected — because all three change what the sum is made of.
 *
 * Returns null when the combined figure was written, and the reason in the
 * coach's terms when it was not. The reason is returned rather than raised: a
 * sync that read Meta correctly and could not produce a TOTAL has still done
 * something worth recording, and rolling its run row back would leave the
 * screen showing the previous check's date as though nothing had been tried.
 */
create or replace function public.apply_synced_spend(p_trainer_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  n_chosen integer;
  n_unread integer;
  n_ccy    integer;
  ccy      text;
  rec      record;
begin
  if p_trainer_id is null then raise exception 'no trainer'; end if;

  select count(*) filter (where l.chosen),
         count(*) filter (where l.chosen and l.status <> 'ok')
    into n_chosen, n_unread
    from public.latest_ad_runs(p_trainer_id) l;

  -- Nothing connected. The recorded figures are left exactly as they are: what
  -- a campaign cost last month did not stop being true because the account was
  -- unlinked, and part 100 makes the same promise on the screen.
  if n_chosen = 0 then
    return 'no ad account is connected';
  end if;

  -- The refusal this part exists for. One unread channel and there is no sum,
  -- so the synced rows go rather than standing as a total that leaves a channel
  -- out. Manual rows are not touched — a figure the coach typed is theirs.
  if n_unread > 0 then
    delete from public.coach_code_spend s
     where s.trainer_id = p_trainer_id and s.source = 'synced';
    return 'a connected channel has not been read, so there is no total';
  end if;

  select count(distinct l.account_currency), min(l.account_currency)
    into n_ccy, ccy
    from public.latest_ad_runs(p_trainer_id) l
   where l.chosen and l.account_currency is not null;

  -- Two currencies do not add, and are never converted: the rate would be one
  -- nobody chose, sitting inside a figure a coach makes budget decisions on.
  if n_ccy > 1 then
    delete from public.coach_code_spend s
     where s.trainer_id = p_trainer_id and s.source = 'synced';
    return 'the connected channels bill in different currencies, which do not add together';
  end if;

  -- Every channel answered and not one named a currency, which is what happens
  -- when every connected account has no ads in it. There is nothing to add and
  -- no unit to add it in, and a bare nought would be a figure in no money.
  if n_ccy = 0 then
    delete from public.coach_code_spend s
     where s.trainer_id = p_trainer_id and s.source = 'synced';
    return 'no connected channel has any ads in it';
  end if;

  -- The sum, one code at a time. set_synced_spend() is reused rather than
  -- reimplemented: it already holds the bounds, the refusal to store an amount
  -- with no currency, and — the one that matters — the rule that a manual
  -- figure is kept. A second writer would be the one that forgot.
  for rec in
    select cs.code_id, sum(cs.amount_cents)::bigint as cents
      from public.coach_ad_code_spend cs
      join public.latest_ad_runs(p_trainer_id) l on l.run_id = cs.run_id and l.chosen
     where cs.trainer_id = p_trainer_id
     group by cs.code_id
  loop
    perform public.set_synced_spend(p_trainer_id, rec.code_id, rec.cents, ccy);
  end loop;

  -- A code that had a synced figure and appears in none of the current runs.
  -- Every channel answered and not one of them spent anything against it, so
  -- nought is what they reported and nought is honest — this is the ONE place
  -- in this feature where an absence is written as a zero, and it is only ever
  -- reached when every channel is known to have been read. Leaving the old
  -- figure would keep charging a coach for an ad they deleted in March.
  perform set_config('repple.ad_sync', 'on', true);
  update public.coach_code_spend s
     set amount_cents = 0, currency = ccy, updated_at = now()
   where s.trainer_id = p_trainer_id
     and s.source = 'synced'
     and not exists (
       select 1
         from public.coach_ad_code_spend cs
         join public.latest_ad_runs(p_trainer_id) l on l.run_id = cs.run_id and l.chosen
        where cs.trainer_id = p_trainer_id and cs.code_id is not distinct from s.code_id
     );
  perform set_config('repple.ad_sync', 'off', true);

  return null;
end; $$;

comment on function public.apply_synced_spend is
  'Writes each code''s spend as the sum across every connected channel — and removes the synced figure entirely where a channel is unread or the currencies disagree, so part 98 shows unknown rather than a total that leaves a channel out.';

/* ── 4. Recording a run, now that a run is one channel of several ───────── */

/**
 * Unchanged in signature, and every caller keeps working: the Meta sync in
 * supabase/functions/ads-sync calls this exactly as it did, and the two new
 * channel functions call it the same way.
 *
 * What changed is the last third. It used to write this run's figures straight
 * into `coach_code_spend`, one code at a time, as though this run were the whole
 * of the coach's ad spend. It now records the run and then asks
 * apply_synced_spend() what the coach's spend actually is across all of their
 * channels — which may be "nothing that can be totalled", and that is a real
 * answer this function is not entitled to overrule.
 *
 * `applied` is then set from what is actually in use, rather than from what this
 * run alone wanted: true means the figure part 98 is dividing into revenue is a
 * synced one that this run is part of.
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
  v_run_id    uuid;
  m           jsonb;
  u           jsonb;
  n_matched   integer := 0;
  n_unmatched integer := 0;
  sum_matched bigint  := 0;
  sum_unmatch bigint  := 0;
  any_no_amt  boolean := false;
  ccy         text    := nullif(btrim(upper(coalesce(p_currency, ''))), '');
begin
  if p_trainer_id is null then raise exception 'no trainer'; end if;
  if p_status not in ('ok', 'failed') then raise exception 'a run either worked or it did not'; end if;

  insert into public.coach_ad_sync_runs (trainer_id, provider, finished_at, status, failure, window_from, window_to, account_currency)
  values (p_trainer_id, p_provider, now(), p_status, nullif(btrim(coalesce(p_failure, '')), ''), p_from, p_to, ccy)
  returning id into v_run_id;

  if p_status <> 'ok' then
    -- A failed channel makes the whole total unknown, so the coach's synced
    -- figures are withdrawn here too rather than standing as a complete answer.
    perform public.apply_synced_spend(p_trainer_id);
    return v_run_id;
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_matched, '[]'::jsonb)) loop
    insert into public.coach_ad_code_spend (run_id, trainer_id, code_id, code, amount_cents, currency, ads, applied)
    values (v_run_id, p_trainer_id, nullif(m->>'code_id', '')::uuid, upper(m->>'code'),
            (m->>'cents')::bigint, ccy, coalesce((m->>'ads')::integer, 0), false)
    on conflict (run_id, code) do nothing;
    n_matched := n_matched + coalesce((m->>'ads')::integer, 0);
    sum_matched := sum_matched + (m->>'cents')::bigint;
  end loop;

  for u in select * from jsonb_array_elements(coalesce(p_unmatched, '[]'::jsonb)) loop
    insert into public.coach_ad_unmatched (run_id, trainer_id, ad_id, ad_name, destination_url, amount_cents, currency, reason)
    values (v_run_id, p_trainer_id, u->>'ad_id', u->>'ad_name', u->>'url',
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
   where id = v_run_id;

  -- The figures this run found are now on record. What the COACH's spend is,
  -- across every channel they connected, is a different question and is asked
  -- of the one function entitled to answer it.
  perform public.apply_synced_spend(p_trainer_id);

  update public.coach_ad_code_spend cs
     set applied = exists (
       select 1 from public.coach_code_spend s
        where s.trainer_id = p_trainer_id
          and s.code_id is not distinct from cs.code_id
          and s.source = 'synced'
     )
   where cs.run_id = v_run_id;

  return v_run_id;
end; $$;

/* ── 5. Taking the synced figure, across all of the channels ─────────────
 *
 * Same signature, same promise, one correction: it used to take the single most
 * recent synced figure for the code, which on a coach with three channels is
 * whichever channel synced last. "Use the synced figure instead" would then
 * have replaced the coach's own number with one channel's share of it — a
 * smaller figure, at the coach's own request, with nothing saying so.
 *
 * It now takes the sum across every connected channel, and refuses outright
 * where that sum does not exist. Refusing is the point: "use the synced figure"
 * must never be a way to end up with a figure that is missing a channel.
 */
create or replace function public.use_synced_spend(p_code_id uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  cents    bigint;
  ccy      text;
  n_unread integer;
  n_ccy    integer;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select count(*) filter (where l.chosen and l.status <> 'ok') into n_unread
    from public.latest_ad_runs(uid) l;
  if n_unread > 0 then
    raise exception 'one of your connected ad channels has not been read, so the synced figure would be missing what you spent there';
  end if;

  select count(distinct l.account_currency), min(l.account_currency)
    into n_ccy, ccy
    from public.latest_ad_runs(uid) l
   where l.chosen and l.account_currency is not null;
  if n_ccy > 1 then
    raise exception 'your ad accounts bill in different currencies, and those do not add together';
  end if;
  if n_ccy = 0 then
    raise exception 'no synced figure has been found for that code yet';
  end if;

  select sum(cs.amount_cents)::bigint into cents
    from public.coach_ad_code_spend cs
    join public.latest_ad_runs(uid) l on l.run_id = cs.run_id and l.chosen
   where cs.trainer_id = uid and cs.code_id is not distinct from p_code_id;

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

/* ── 6. Connecting and disconnecting change what the sum is made of ─────── */

/**
 * Unchanged except for the last line, and the last line is the point: the
 * moment a coach chooses an ad account on a second channel, every synced figure
 * they have is a one-channel figure claiming to be a total. It is withdrawn
 * there and then rather than at the next sync, because the next sync might be a
 * month away and the screen would spend that month dividing revenue by a
 * fraction of the spend.
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
  perform public.apply_synced_spend(p_trainer_id);
end; $$;

/**
 * The same in the other direction, and it is the pleasant one: a coach who
 * disconnects the channel that would not read gets their total back, because
 * the sum is now over the channels that remain and all of them answered.
 *
 * The sync history and the recorded runs still stay. Only the figure part 98
 * divides is recomputed.
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
  perform public.apply_synced_spend(uid);
  return n > 0;
end; $$;

/* ── 7. What the app reads ──────────────────────────────────────────────── */

/**
 * Pinned to Meta. See the header: an older build reads the first row this
 * returns and calls it Meta on the screen, so it must not be handed a Google
 * connection. Current builds read my_ad_channels() below.
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
         (a.expires_at is not null and a.expires_at < now() + interval '7 days') as expires_soon
  from public.coach_ad_accounts a
  where a.trainer_id = (select auth.uid()) and a.provider = 'meta';
$$;

/**
 * Every channel this coach has connected, without a token in sight — the same
 * promise my_ad_account() makes, for all three. `coach_ad_accounts` still has
 * no policy and no grant for `authenticated`, and this is still the only way
 * anything about it reaches a device.
 */
create or replace function public.my_ad_channels()
returns table (
  provider text, external_account_id text, account_name text,
  account_currency text, manager_account_id text,
  connected_at timestamptz, updated_at timestamptz,
  scopes text, expires_soon boolean
)
language sql security definer stable set search_path = public as $$
  select a.provider, a.external_account_id, a.account_name,
         a.account_currency, a.manager_account_id, a.connected_at, a.updated_at, a.scopes,
         (a.expires_at is not null and a.expires_at < now() + interval '7 days') as expires_soon
  from public.coach_ad_accounts a
  where a.trainer_id = (select auth.uid())
  order by a.provider;
$$;

/**
 * The most recent sync on each channel.
 *
 * A function rather than a query the app writes, because "the latest run per
 * provider" is a DISTINCT ON and PostgREST cannot express one. The app used to
 * read `coach_ad_sync_runs` ordered by date with a limit of 1, which on a coach
 * with three channels returns the most recently synced channel's run and none
 * of the other two — and the screen would then report one channel's figures as
 * the whole check.
 */
create or replace function public.my_ad_runs()
returns table (
  provider text, run_id uuid, status text, failure text,
  started_at timestamptz, finished_at timestamptz,
  window_from date, window_to date, account_currency text,
  ads_seen integer, matched_ads integer, unmatched_ads integer,
  matched_cents bigint, unmatched_cents bigint
)
language sql security definer stable set search_path = public as $$
  select distinct on (r.provider)
         r.provider, r.id, r.status, r.failure,
         r.started_at, r.finished_at,
         r.window_from, r.window_to, r.account_currency,
         r.ads_seen, r.matched_ads, r.unmatched_ads,
         r.matched_cents, r.unmatched_cents
    from public.coach_ad_sync_runs r
   where r.trainer_id = (select auth.uid())
   order by r.provider, r.started_at desc;
$$;

/* ── 8. Privileges ──────────────────────────────────────────────────────
 *
 * Same shape as part 100 and for the same reason: `public` is revoked first in
 * every case, because execute is granted to public by default and a function
 * that decides what a coach's money reads as must not rely on nobody having
 * noticed.
 *
 * latest_ad_runs() and apply_synced_spend() take a trainer id and are therefore
 * service-role only — handed somebody else's id by a signed-in coach they would
 * report which channels that coach runs and in what currency. The SECURITY
 * DEFINER functions above call them as the owner, which is how a coach reaches
 * them for their own row and no other. */
revoke all on function public.latest_ad_runs(uuid) from public, anon, authenticated;
revoke all on function public.apply_synced_spend(uuid) from public, anon, authenticated;
revoke all on function public.record_ad_sync(uuid, text, text, text, date, date, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.choose_ad_account(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.my_ad_account() from public, anon;
revoke all on function public.my_ad_channels() from public, anon;
revoke all on function public.my_ad_runs() from public, anon;
revoke all on function public.disconnect_ad_account(text) from public, anon;
revoke all on function public.use_synced_spend(uuid) from public, anon;

grant execute on function public.latest_ad_runs(uuid) to service_role;
grant execute on function public.apply_synced_spend(uuid) to service_role;
grant execute on function public.record_ad_sync(uuid, text, text, text, date, date, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.choose_ad_account(uuid, text, text, text, text) to service_role;
grant execute on function public.my_ad_account() to authenticated;
grant execute on function public.my_ad_channels() to authenticated;
grant execute on function public.my_ad_runs() to authenticated;
grant execute on function public.disconnect_ad_account(text) to authenticated;
grant execute on function public.use_synced_spend(uuid) to authenticated;

comment on function public.my_ad_channels is
  'Every ad channel this coach has connected, and never a token. Meta, Google Ads and TikTok.';
comment on function public.my_ad_runs is
  'The most recent sync on each channel. Three channels means three answers, and one of them failing is not the other two failing.';
comment on function public.use_synced_spend is
  'Replaces the coach''s own figure for one code with the synced one — the SUM across every connected channel, and refused outright where a channel is unread.';
