-- ═══════════════════════════════════════════════════════════════════════════
-- A coach could mute a whole channel and could not say "not at eleven at night".
--
-- ── What part 251 gave them, and what it left out ────────────────────────
--
-- Part 251 built `notify_channel_prefs`: five per-channel switches, applied
-- server-side in supabase/functions/send-push and notify-message, so a coach
-- who mutes chat still hears that a client's card was declined. That was the
-- right fix for the right problem and it is unchanged here.
--
-- It has no time dimension at all. The complaint behind it — "this arrives at
-- eleven at night" — is answered by muting client messages for ever, which is
-- not what anybody wanted. A coach wants their clients to be able to message
-- them; they want the phone to be quiet while they sleep. Those are the same
-- notification at two different hours, and there was no way to say so.
--
-- ── WHY THIS COULD NOT BE A DEVICE SETTING, AND WHY THE ZONE IS HERE ─────
--
-- src/lib/notifyPrefs.ts already has `inQuietHours` and `whenToDeliver`, and
-- both are explicitly limited to LOCAL notifications — the ones this app
-- schedules on the member's own phone, where the phone knows the hour because
-- it is the phone's own clock.
--
-- Every coach-directed notification is remote. All of them: some are sent by a
-- client's handset, the rest by a trigger or an edge function. The gate has to
-- be where the recipients are resolved, which is a server that has never been
-- told what time it is where the coach is.
--
-- So the zone is carried. `tz` is an IANA name captured from the coach's own
-- device and stored beside the window, and the hour arithmetic is done HERE,
-- in Postgres, against Postgres's own timezone database. The edge functions do
-- no date maths whatever — they read a view that already says who is asleep.
-- That is deliberate: a JS `getHours()` in an edge function would be the hour
-- in the function's region, which is the one hour that is certainly wrong for
-- everybody, and a hand-rolled UTC offset would be right until the clocks go
-- back and then silently wrong for half of Europe for a fortnight.
--
-- The alternative was to scope the feature to what works with no zone, and
-- what works with no zone is nothing at all — there is no local half of a
-- coach's notifications to gate. A switch that reads "quiet" while the phone
-- buzzes is the defect src/lib/pushConsent.ts was written for, so it is either
-- carried properly or not offered.
--
-- ── THE ROLLOUT FLAG, AND WHY A TABLE RATHER THAN A COMMENT ──────────────
--
-- The filter below is inert until supabase/functions/send-push and
-- notify-message are redeployed to read it. Between this part being applied
-- and that deploy happening, a settings screen offering a quiet-hours switch
-- would be offering a control that does nothing — which is exactly the failure
-- this file spends forty lines refusing to ship.
--
-- `notify_quiet_hours_rollout` is how the app finds out. It holds one row, it
-- ships with `enforced = false`, and app/(trainer)/settings.tsx reads it: while
-- it is false the screen does not draw a switch, it says quiet hours are not
-- available on this server yet. Whoever deploys the two functions runs:
--
--     update public.notify_quiet_hours_rollout set enforced = true;
--
-- and every coach's screen gains the control on its next read. Flipping it
-- before the deploy is the one way to make this feature lie, which is why the
-- flag is a row somebody has to change on purpose rather than a constant in a
-- bundle that ships with the client.
--
-- ── WHAT A QUIET HOUR DOES, AND WHAT IT MUST NOT DO ──────────────────────
--
-- It suppresses the PUSH and never the record, exactly as a muted channel
-- does: `notify_users()` (part 122) has already written the `notifications` row
-- before send-push is called, so a notification held at 11pm is in the coach's
-- list and on the bell in the morning. Nothing is deferred and re-sent, and the
-- screen says so — the member's local version SHIFTS a notification to the end
-- of the window because it holds a scheduled trigger it can move, and a push
-- that has already been handed to Expo is not a thing this system can hold.
-- Promising a delayed delivery it cannot perform would be worse than the 11pm
-- buzz.
--
-- A FAILED READ SENDS, for the same reason part 251 gives: a transient fault
-- must not silently swallow the notification that a subscription payment
-- failed. Erring towards the notification is the recoverable error.
--
-- Not coach-only by construction. `user_id` is any profile; a member's quiet
-- hours are local and stay in notifyPrefs.ts today, and nothing about this
-- shape would have to change if they ever moved.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notify_quiet_hours (
  user_id    uuid     primary key references public.profiles(id) on delete cascade,
  -- 0–23, in the coach's own zone. INCLUSIVE: quiet begins at the top of this
  -- hour.
  from_hour  smallint not null check (from_hour between 0 and 23),
  -- 0–23. EXCLUSIVE: quiet ends at the top of this hour, so 22 → 7 is silent
  -- from 22:00 through 06:59. The same convention as NotifyPrefs in
  -- src/lib/notifyPrefs.ts, stated in both places because a disagreement
  -- between them would cost somebody an hour of sleep or an hour of silence.
  to_hour    smallint not null check (to_hour between 0 and 23),
  -- An IANA zone name — 'Europe/London', 'Asia/Dubai'. Validated by the trigger
  -- below rather than by a CHECK, because knowing whether a string is a zone
  -- means asking the catalogue and a CHECK may not.
  --
  -- Stored, not derived. There is no `trainers.timezone` and this deliberately
  -- does not add one: a coach's quiet hours are a fact about where they SLEEP,
  -- which is where their phone was when they set them, and a gym's address
  -- would be the wrong answer for every coach who moved or who travels.
  tz         text     not null check (btrim(tz) <> '' and length(tz) <= 64),
  updated_at timestamptz not null default now(),
  -- A zero-length window is refused rather than stored. `from = to` has no
  -- meaning here: read as "all day" it silences everything with nothing on
  -- screen saying why, and read as "no window" it is a row that does nothing
  -- while the switch beside it says quiet hours are on. The way to have no
  -- quiet hours is to have no row.
  constraint notify_quiet_hours_nonzero check (from_hour <> to_hour)
);

comment on table public.notify_quiet_hours is
  'When a person will not accept a push. The zone is stored WITH the window because the server resolving recipients has no other way to know what hour it is where they are. Applied through notify_quiet_now in supabase/functions/send-push and notify-message, where recipients are resolved — never at a call site. It suppresses the push and never the notifications row, and nothing is re-sent later.';
comment on column public.notify_quiet_hours.tz is
  'IANA zone name, captured from the coach''s device. Validated against pg_timezone_names on write, so notify_quiet_now can never raise on a bad value mid-query and take a whole send down with it.';
comment on column public.notify_quiet_hours.to_hour is
  'EXCLUSIVE. 22 to 7 is silent from 22:00 through 06:59 — the same convention NotifyPrefs uses for the member''s local version.';

-- ── The zone is checked on the way in ────────────────────────────────────
--
-- A row holding 'Europe/Londn' would make `now() at time zone tz` raise, and it
-- would raise inside the view — during a query the edge function runs over
-- every recipient of a send. One coach's typo would then stop everybody else's
-- notification. So it is refused at the write, where exactly one person is
-- affected and they are looking at the screen.
create or replace function public.notify_quiet_hours_check()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from pg_timezone_names where name = new.tz) then
    raise exception 'not a timezone this server knows: %', new.tz
      using hint = 'send an IANA zone name such as Europe/London';
  end if;
  new.updated_at := now();
  -- Pinned on update for the reason part 251 gives: the WITH CHECK would refuse
  -- a moved row, and refusing produces an error where pinning produces the
  -- correct row.
  if tg_op = 'UPDATE' then new.user_id := old.user_id; end if;
  return new;
end
$function$;

drop trigger if exists notify_quiet_hours_check on public.notify_quiet_hours;
create trigger notify_quiet_hours_check
  before insert or update on public.notify_quiet_hours
  for each row execute function public.notify_quiet_hours_check();

alter table public.notify_quiet_hours enable row level security;

-- One policy, FOR ALL, and nobody else may read it — the same reasoning part
-- 251 gives for notify_channel_prefs. When somebody sleeps is not a thing a gym
-- owner, a client or another coach has any business looking up. The two edge
-- functions run with the SERVICE ROLE and bypass this entirely, which is what
-- lets the filter live there.
drop policy if exists nqh_self on public.notify_quiet_hours;
create policy nqh_self on public.notify_quiet_hours for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Who is asleep right now ──────────────────────────────────────────────
--
-- The whole point of this part. The edge functions read this and nothing else:
-- one `select user_id from notify_quiet_now where user_id in (...)`, no date
-- arithmetic in JavaScript, no offset table, no DST to get wrong.
--
-- The wrap is the ordinary case and is why this is a CASE rather than a
-- BETWEEN: 22 → 7 means 22, 23, 0, 1 … 6. `from = to` cannot occur — the table
-- refuses it — so there is no third branch to argue about.
--
-- security_invoker, so a coach reading this view reads it under their own
-- policy and sees only themselves. Without it the view would run as its owner
-- and hand any authenticated caller the sleeping habits of every coach on the
-- platform, which is precisely what the single policy above exists to prevent.
drop view if exists public.notify_quiet_now;
create view public.notify_quiet_now
  with (security_invoker = true) as
select q.user_id
  from public.notify_quiet_hours q
 cross join lateral (
   select extract(hour from (now() at time zone q.tz))::int as h
 ) local_now
 where case
         when q.from_hour < q.to_hour
           then local_now.h >= q.from_hour and local_now.h < q.to_hour
         else local_now.h >= q.from_hour or local_now.h < q.to_hour
       end;

comment on view public.notify_quiet_now is
  'The people whose quiet hours are running at this instant, in their own zone. Read by supabase/functions/send-push and notify-message alongside notify_channel_prefs; a user_id present here is not pushed to. security_invoker, so an ordinary caller sees only their own row.';

-- ── Whether the server actually applies any of this ──────────────────────
--
-- See the header. This ships FALSE and the app draws no switch while it is
-- false, because a quiet-hours setting the server cannot apply is worse than
-- no quiet hours at all. It is flipped by whoever deploys the two edge
-- functions, in the same sitting, by hand:
--
--     update public.notify_quiet_hours_rollout set enforced = true;
create table if not exists public.notify_quiet_hours_rollout (
  -- One row, enforced by the primary key and the CHECK together. A second row
  -- would be a second answer, and the app would read whichever came back first.
  only_row boolean primary key default true check (only_row),
  enforced boolean not null default false,
  note     text
);

insert into public.notify_quiet_hours_rollout (only_row, enforced, note)
values (true, false, 'Flip to true only once supabase/functions/send-push and notify-message have been deployed reading notify_quiet_now. Until then the app draws no quiet-hours switch, because a switch that does nothing is worse than none.')
on conflict (only_row) do nothing;

alter table public.notify_quiet_hours_rollout enable row level security;

-- Readable by anybody signed in, writable through the API by nobody. There is
-- deliberately no insert, update or delete policy: this is a statement about
-- the deployment and the only person who may make it is somebody with a SQL
-- console, at the moment they deploy. A coach who could set it to true would be
-- turning on a filter that is not running.
drop policy if exists nqh_rollout_read on public.notify_quiet_hours_rollout;
create policy nqh_rollout_read on public.notify_quiet_hours_rollout for select
  to authenticated using (true);

drop policy if exists nqh_rollout_write on public.notify_quiet_hours_rollout;

comment on table public.notify_quiet_hours_rollout is
  'Whether supabase/functions/send-push and notify-message have been deployed reading notify_quiet_now. The app draws no quiet-hours control while this is false. Set by hand at deploy time; there is no write policy, because the only honest author of this row is the person doing the deploy.';

-- ── What the two edge functions have to do ───────────────────────────────
--
-- Neither is deployed by this part and neither can be — this is SQL. Written
-- out so the change is unambiguous when somebody makes it.
--
-- supabase/functions/send-push, immediately after the notify_channel_prefs
-- filter it already runs, and against `recipients` rather than `user_ids` so
-- the two filters compose:
--
--     const { data: quiet, error: quietErr } = await supa
--       .from('notify_quiet_now').select('user_id').in('user_id', recipients);
--     if (!quietErr && quiet) {
--       const asleep = new Set((quiet as { user_id: string }[]).map((r) => r.user_id));
--       if (asleep.size) {
--         const before = recipients.length;
--         recipients = recipients.filter((id) => !asleep.has(id));
--         muted += before - recipients.length;
--       }
--     }
--
-- supabase/functions/notify-message, the same three lines against whatever it
-- calls its recipient list, because chat does not go through send-push and chat
-- is the notification the whole complaint was about.
--
-- `!quietErr` is the rule from part 251 and it is not an oversight: a failed
-- read of this table SENDS. A database fault must not be able to swallow the
-- notification that somebody's payment failed, and there would be nothing
-- anywhere to discover that from.
