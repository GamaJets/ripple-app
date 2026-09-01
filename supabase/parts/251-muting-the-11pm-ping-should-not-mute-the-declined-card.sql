-- ═════════════════════════════════════════════════════════════════════════
-- Muting the 11pm ping should not mute the declined card.
--
-- ── What was measured ───────────────────────────────────────────────────
--
-- app/(trainer)/settings.tsx has ONE switch: "Push Notifications". It does not
-- filter sends — it deletes this handset's row from `push_tokens`, which is
-- the table supabase/functions/send-push resolves recipients from — so it is
-- all-or-nothing by construction, and that was deliberate and right for what
-- it was for.
--
-- Behind it, src/lib/notifyInbox.ts catalogues roughly a dozen coach-directed
-- triggers: a client's chat message, a booking, a cancellation, a slot
-- re-opening, a coaching request, a document accepted, an intake coming back,
-- a subscription starting, a subscription ENDING, a subscription PAYMENT
-- FAILING, a package bought, a release signed, a review left.
--
-- So a coach who turns the switch off to stop chat messages arriving at 11pm
-- also stops being told that a client's card was declined. They will not turn
-- it back on, because turning it back on brings back the 11pm messages — and
-- nothing anywhere tells them they have stopped hearing about their money.
--
-- ── Why this cannot be a device setting ─────────────────────────────────
--
-- src/lib/notifyPrefs.ts is the MEMBER's per-category control and it is
-- scrupulous about its own limit: it offers a switch only for notifications
-- this app schedules locally, and says on the screen that the remote ones
-- follow the single switch. `CategoryDef.local` is that line.
--
-- Every coach-directed notification is remote. All of them. Some are sent by
-- another person's handset (a client's message, a client's booking) and the
-- rest are written server-side by a trigger or an edge function. There is no
-- local half at all, so a device-local preference would be a switch reading
-- "off" while the banner kept arriving — the exact shape of the defect
-- src/lib/pushConsent.ts was written for.
--
-- The answer therefore lives here, and it is applied where the recipients are
-- resolved: supabase/functions/send-push (every sendPush call site at once)
-- and supabase/functions/notify-message (chat, which does not go through it).
-- Same argument the master switch makes about `push_tokens`: the gate goes
-- where a sender cannot route around it, because a check at the call site is a
-- check somebody forgets at the twenty-fifth call site.
--
-- ── THE THREE RULES THE FILTER HOLDS, AND WHY EACH ONE ──────────────────
--
-- 1. NO ROW IS NOT AN ANSWER. Only an explicit `enabled = false` suppresses.
--    The product default is on, the settings screen shows a switch on for an
--    unanswered channel, and the two must agree — a screen showing "on" while
--    the server suppressed the push would be the master switch's original bug
--    pointing the other way.
--
-- 2. A FAILED READ SENDS. The edge functions treat an error reading this table
--    as "not muted". The alternative is that a transient fault silently
--    swallows a coach's notification that a subscription payment failed, with
--    nothing anywhere to find that out from. Erring towards the notification
--    is the recoverable error.
--
-- 3. IT SUPPRESSES THE PUSH AND NEVER THE RECORD. `notify_users()` (part 122)
--    writes the `notifications` row before send-push is ever called, so a
--    muted category is still in the coach's notifications list and still shows
--    on the bell. Muting is "do not buzz my phone about this", not "do not
--    tell me" — and that distinction is what makes it safe to offer for the
--    money channel at all.
--
-- ── Why the channel is TEXT and not an enum ─────────────────────────────
--
-- The list will be tuned by somebody reading a support thread, and adding a
-- value to an enum needs a type change and a lock. A CHECK is edited in one
-- statement. The set mirrors `CoachChannel` in src/lib/coachNotify.ts, and the
-- app drops a channel it does not recognise rather than acting on it — so a
-- newer build writing a channel this one has never heard of cannot mute
-- anything here by accident.
--
-- ── Why this is per ACCOUNT and the master switch is per HANDSET ────────
--
-- They are different questions. "This phone should stop receiving" is about a
-- device — a coach hands their old handset to somebody and wants it silent.
-- "I do not want to be told about paperwork" is about the person, and holding
-- it per device would mean setting it again on every phone they sign into and
-- finding it disagreeing with itself. The screen says which is which.
--
-- Not coach-only by construction: `user_id` is any profile. A member's
-- preferences are src/lib/notifyPrefs.ts today and this table takes no view on
-- whether they ever move here — nothing about the shape would have to change.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.notify_channel_prefs (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  channel    text not null,
  -- The answer. NOT NULL, because a null here would be a third state this
  -- table has no meaning for — "no row" is already the way to say "never
  -- answered", and two ways to say the same thing is how they come to be read
  -- differently by two callers.
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel)
);

alter table public.notify_channel_prefs
  drop constraint if exists notify_channel_prefs_channel_chk;
alter table public.notify_channel_prefs
  add constraint notify_channel_prefs_channel_chk
  check (channel in ('chat', 'bookings', 'money', 'clients', 'admin'));

-- The edge functions ask "which of these recipients has this channel off", so
-- the index leads on the channel and carries the answer. Partial on `not
-- enabled` because that is the only half either function ever looks for, and
-- the table is then a handful of rows however many coaches have answered "on".
create index if not exists notify_channel_prefs_muted
  on public.notify_channel_prefs (channel, user_id) where not enabled;

alter table public.notify_channel_prefs enable row level security;

-- One policy, FOR ALL, and nobody else may read it. A coach's notification
-- preferences are theirs: no gym owner, no client and no other coach has any
-- business knowing which categories somebody has silenced, and a table that
-- admitted an owner would make "why did you not answer me" a thing they could
-- look up. The two edge functions run with the SERVICE ROLE and bypass this
-- entirely, which is the whole reason the filter can live there.
drop policy if exists ncp_self on public.notify_channel_prefs;
create policy ncp_self on public.notify_channel_prefs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.notify_channel_prefs_touch()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  -- The owner is pinned on update for the same reason it is in part 250: the
  -- WITH CHECK would refuse a moved row, and refusing produces an error where
  -- pinning produces the correct row.
  new.user_id := old.user_id;
  return new;
end
$function$;

drop trigger if exists notify_channel_prefs_touch on public.notify_channel_prefs;
create trigger notify_channel_prefs_touch
  before update on public.notify_channel_prefs
  for each row execute function public.notify_channel_prefs_touch();

comment on table public.notify_channel_prefs is
  'Which categories of notification somebody has turned OFF. A row is only ever an explicit answer: no row means never answered, which the product default reads as on. Applied in supabase/functions/send-push and notify-message, where recipients are resolved — never at a call site. It suppresses the push and never the notifications row, so a muted category is still in the inbox.';
comment on column public.notify_channel_prefs.enabled is
  'False means muted. There is deliberately no null: "never answered" is said by the absence of the row, and two ways to say one thing is how two callers come to read it differently.';
comment on column public.notify_channel_prefs.channel is
  'Mirrors CoachChannel in src/lib/coachNotify.ts. A CHECK rather than an enum because this list will be tuned by somebody reading a support thread, and an enum change takes a lock.';
