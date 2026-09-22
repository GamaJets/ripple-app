-- ═══════════════════════════════════════════════════════════════════════════
-- A watch you unplug does not erase the nights it measured.
--
-- 154-a-night-a-watch-measured-outlives-the-read.sql exists because "the
-- biggest number on the home screen changes for reasons the member cannot
-- see". It keeps the nights a device measured so that a failed read, an expired
-- token or a new handset cannot take somebody's sleep history away.
--
-- Then `disconnect()` in src/ui/wearables.tsx runs
--
--     delete from device_sleep_nights where user_id = … and provider = …
--
-- and every night that watch ever measured is gone, permanently, from one tap
-- on the Devices screen. app/(client)/devices.tsx:357 says so out loud — "the
-- connection ends AND the nights are removed" — and adds that an Alert is used
-- rather than a toast because "reconnecting the watch does not bring the nights
-- back". The warning is honest. The behaviour it is warning about is the exact
-- disappearance part 154 was written to stop, reintroduced on the one path a
-- member can take deliberately.
--
-- ── the argument for deleting, and what is actually load bearing in it ─────
--
-- The comment on the delete makes a real point: without it, "'disconnect' means
-- the readings keep feeding the home screen from a device the client believes
-- they have unplugged."
--
-- That is true of FUTURE readings and only of future readings. A disconnected
-- provider is not synced, so it contributes no new nights; what the delete
-- actually removes is the PAST — nights already measured, already shown, and
-- already part of the record the member is looking at. Deleting history is not
-- what stops a device reporting. It is what stops the member ever seeing what
-- it reported.
--
-- So the two requirements are not in conflict once they are separated:
--
--   · the live table, which readiness and the Recovery week read, must empty
--     for that provider the moment the member disconnects it;
--   · what it held must still exist, so reconnecting restores it.
--
-- This is the shelf that makes both true. The rows move here on disconnect and
-- move back on reconnect. Nothing about the live read changes, `disconnect()`
-- keeps its delete and keeps its comment, and no night is destroyed by a tap.
--
-- ── what a row here is ───────────────────────────────────────────────────
--
-- Exactly a `device_sleep_nights` row, with the same constraints, plus the
-- moment it was shelved. Same shape deliberately: a retired night that could
-- hold something the live table would refuse — a zero duration, a basis nobody
-- has a word for — is a night that cannot be restored, which makes the shelf a
-- slower way of losing it.
--
-- It is NOT an audit log and NOT a second history. One row per member, per
-- provider, per night, replaced if the same night is shelved twice. The live
-- table is still the only place a night is read from.
--
-- ── why the primary key carries the provider and 154's does not ───────────
--
-- `device_sleep_nights` is keyed (user_id, night) because the merge has already
-- chosen ONE figure for that night and "this is not a log". Here the choosing
-- has already happened and what is being kept is whose it was: a member who
-- disconnects a WHOOP and, a month later, an Oura must get each of them back on
-- its own, and a shared (user_id, night) key would have the second disconnect
-- overwrite the first one's night. The provider is part of the identity of a
-- shelved row in a way it is not part of the identity of a live one.
--
-- ── restoring never overwrites a measurement ─────────────────────────────
--
-- Enforced in src/lib/retiredSleep.ts rather than here, because it is a rule
-- about which rows to send and not about which rows are legal: a night the live
-- table already holds is a night some device measured more recently than this
-- shelf was written, and a restore that upserted over it would replace a
-- current reading with an older one. The restore therefore fills only the
-- nights that are ABSENT, and the test file asserts it.
--
-- ── the same three refusals part 154 proved ───────────────────────────────
--
-- Not re-proved against the live database here: this file is not applied by an
-- agent (see the lane rules) and a claim of a rolled-back exploit transcript
-- that nobody ran is worse than none. What IS claimed is that the policy,
-- grants and constraints below are character-for-character the shape part 154
-- proved, on a table with the same owner column and the same cascade — so the
-- properties it demonstrated are properties of this one for the same reasons.
-- Anything weaker than that would be asserting a result rather than reporting
-- one. Before this reaches production it wants the same transcript part 154
-- carries, run the same way.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.retired_device_sleep_nights (
  -- Cascade, exactly as the live table does: a deleted account's sleep is
  -- nobody's record, and a shelf that outlived the account would be the one
  -- copy of it left standing.
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- The local calendar night, as it was stored live. Copied, never re-derived:
  -- re-computing a night from an instant here would move it across the date
  -- line for every member west of Greenwich, which is the note part 154 puts on
  -- this column.
  night date not null,

  -- The same bounds as the live column. See the header: a shelved night that
  -- the live table would refuse cannot be restored.
  minutes_asleep int not null check (minutes_asleep > 0 and minutes_asleep <= 1440),

  -- Who said so. All three, all NOT NULL, for the reason part 154 gives: a
  -- figure without its source cannot be checked by the person it is about.
  provider text not null,
  source_id text not null,
  source_name text not null,

  -- Which KIND of device, so a restored night still cannot look like
  -- corroboration of a reading that is really itself seen twice.
  family text not null,

  basis text not null check (basis in ('asleep', 'in-bed')),

  -- When Repple first stored the night. Carried across rather than re-stamped,
  -- because it is a fact about the measurement's age and the member reads it
  -- as one.
  recorded_at timestamptz not null,

  -- When it was shelved. A fact about our write, so it may have a default.
  -- Kept because "disconnected in March" is the difference between a history
  -- worth offering back and one nobody wants.
  retired_at timestamptz not null default now(),

  -- One answer per night per device. See the header for why the provider is in
  -- the key here and not in the live table's.
  primary key (user_id, provider, night)
);

-- The only read there is: this member's shelf for one provider. The primary key
-- already indexes (user_id, provider, night), which serves that lookup and the
-- ORDER BY night it is read with — so there is no second index here, and
-- 145-an-index-twice-and-fifteen-policies-that-asked-per-row.sql is the reason
-- that is stated rather than left for somebody to add one.

comment on table public.retired_device_sleep_nights is
  'Nights measured by a device the member has since disconnected, kept so that unlinking a watch ends the connection without destroying the history. Moved here on disconnect and moved back on reconnect; never read as sleep while it sits here. Private to the client, exactly as device_sleep_nights is — see 154.';

comment on column public.retired_device_sleep_nights.retired_at is
  'When the device was disconnected and this night was shelved. Not when it was measured — that is recorded_at, which is carried across unchanged.';

alter table public.retired_device_sleep_nights enable row level security;

-- `for all`, matching device_sleep_nights_own: the member is the only party to
-- this table. They shelve their own nights on disconnect, read them back on
-- reconnect and clear them once restored, and no coach, owner or staff role has
-- any business in it — part 153's rule that a coach reads device sleep through
-- the sharing switch and never through this table applies unchanged to a
-- disconnected device's nights.
drop policy if exists retired_device_sleep_nights_own on public.retired_device_sleep_nights;
create policy retired_device_sleep_nights_own on public.retired_device_sleep_nights for all
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.retired_device_sleep_nights to authenticated;
revoke all on public.retired_device_sleep_nights from anon;
