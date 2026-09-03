-- ═════════════════════════════════════════════════════════════════════════
-- A coach heard about everybody except themselves.
--
-- ── What was measured ───────────────────────────────────────────────────
--
-- Part 251 gave a coach five notification channels — chat, bookings, money,
-- clients, admin — and `CoachChannel` in src/lib/coachNotify.ts mirrors them.
-- Read the five together and they have one thing in common that is not an
-- accident of how the list was written: every single one is SOMEBODY ELSE
-- doing something. A client messages, books, cancels, pays, asks to be
-- coached, signs a release, leaves.
--
-- That was not a choice about what a coach wants to know. It is the whole of
-- what the platform was ABLE to tell them, because every one of those has
-- another person's action behind it, and another person's action is what a
-- trigger or a sending handset needs in order to exist.
--
-- So the four things most likely to cost a coach money were the four the app
-- would never mention:
--
--   · a session whose outcome nobody recorded. `settlementBlocker` in
--     src/lib/gymSessions.ts refuses to settle a period containing one, and
--     the statement, the payroll figure and the analytics revenue line are all
--     short by exactly those sessions until they are marked.
--   · a session pack running out from under a client, who then arrives with
--     nothing left to draw on.
--   · an invoice ageing past its due date — money already earned, not
--     collected, and getting older.
--   · a client who has stopped training, which src/lib/clientDrift.ts computes
--     and app/(trainer)/nudges.tsx already renders to anybody who opens it.
--
-- The app computes all four. It computed all four before this part. Every one
-- of them was on a screen a coach had to go and look at, and the coach who
-- most needs them is by definition the one who has not opened the app.
--
-- ── Why the sixth channel is LOCAL and the other five are not ───────────
--
-- Part 251 says, correctly, that every coach-directed notification is remote
-- and that a device-local preference would therefore be a switch reading "off"
-- while the banner kept arriving. That argument holds for the five it was
-- written about and does not extend to this one, for the reason above: there
-- is no other person's action here to hang a trigger on. Nothing in the
-- database knows that a coach's Monday has three unmarked sessions in it —
-- the figure is composed on the handset out of reads it already makes.
--
-- So `book` is scheduled by the coach's own phone (src/ui/coachReminders.ts,
-- through `bookAlert` in src/lib/coachNotify.ts, which is pure and tested) and
-- the ANSWER still lives here, in this table, alongside the other five.
-- `CoachChannelDef.local` is the field that says which is which, and it is the
-- same field, meaning the same thing, as `CategoryDef.local` in
-- src/lib/notifyPrefs.ts.
--
-- Keeping the preference server-side rather than in AsyncStorage is not
-- ceremony. It is the difference between a coach answering this question once
-- and answering it again on every phone they sign into, and then finding the
-- two phones disagreeing. The screen already tells them these follow the
-- account rather than the handset (`CHANNEL_ACCOUNT_WIDE`), and one channel
-- quietly behaving differently would make that sentence false.
--
-- ── What this part actually does ────────────────────────────────────────
--
-- Widens one CHECK. The table, the index, the RLS policy and the touch trigger
-- from part 251 are all unchanged and are not restated here.
--
-- The three rules part 251 states about the filter are unaffected and worth
-- restating only to say so: no row is still not an answer, a failed read still
-- sends, and muting still suppresses a push and never a record. The first is
-- what makes this part safe to apply before any client build ships with the
-- sixth switch in it — a coach who has never seen the switch has no row, no
-- row means never answered, and never answered reads as on.
--
-- The two edge functions need no change and are not touched: they filter
-- REMOTE sends, `book` is never sent remotely, and a channel name they never
-- see in a send is a channel name they never look up.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

-- Dropped and recreated rather than altered: a CHECK cannot be widened in
-- place, and this is the same two statements part 251 uses for the same
-- constraint, so re-running either part in either order leaves one definition
-- standing rather than two.
alter table public.notify_channel_prefs
  drop constraint if exists notify_channel_prefs_channel_chk;
alter table public.notify_channel_prefs
  add constraint notify_channel_prefs_channel_chk
  check (channel in ('chat', 'bookings', 'money', 'clients', 'admin', 'book'));

comment on column public.notify_channel_prefs.channel is
  'Mirrors CoachChannel in src/lib/coachNotify.ts. A CHECK rather than an enum because this list will be tuned by somebody reading a support thread, and an enum change takes a lock. Five of the six are applied in supabase/functions/send-push and notify-message, where remote recipients are resolved; ''book'' is the coach''s own handset telling them about their own book — an unmarked session, an overdue invoice, a client who has stopped — which has no other person''s action behind it and so no trigger to send it. The answer lives here anyway so it follows the coach between phones.';
