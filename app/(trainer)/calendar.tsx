// Trainer · Schedule — month calendar of sessions with add & cancel.
// Reads/writes the shared session store so booked/open slots and cancellations
// stay in sync with the client app. Adding a slot that overlaps an existing one
// is rejected (no double-booking). Cancelling a booked session frees the slot
// and re-offers it to the coach's other clients.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same store, same routes, same alerts, same modals — only
// the presentation changed: the two stat tiles and the Georgia serif header
// became one hero figure, the six bordered cards became hairline-separated
// sections, and the day grid now reads through weight and the accent rather
// than through boxes and 800-weight text.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost, Flag, Field, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric } from '../../src/theme/scale';
import { insideNoticeWindow, feeAmountLine, unstatedCurrencyCoach, noticeLabel, openSlotWindow, slotWindowLine, classClashes, classCheckCaveat, type CancellationPolicy } from '../../src/lib/booking';
// "I work Tuesdays 7 to 7", said once instead of forty-eight times. See that
// file's header for why trainer_availability was empty: offering 07:00–19:00 in
// quarters meant forty-eight separate additions for ONE day.
import { expandRange, rangeBlocker, rangeSlotCount, remainderNote, splitAgainstExisting,
  addButtonLabel, rangeSummary, addOutcome, type RangeInput } from '../../src/lib/availabilityRange';
import { useClasses } from '../../src/ui/classes';
import { useSessions, useSessionWaitlistCounts, useLateCancelCharges, useMyCancellationPolicy, promoteWaitlist } from '../../src/ui/sessions';
import { useAvailability, upcomingDates, useRecurringSeries, deviceTimeZone } from '../../src/ui/availability';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
// Why a coach's open slots have stopped being generated, and the one honest
// thing that can be offered about it. See that file's header: this failure
// has no error anywhere in it, so saying it out loud is the whole fix.
import { zoneState, zonelessNote, selfHealLabel, noZoneToOfferNote, selfHealConfirm, selfHealResult }
  from '../../src/lib/slotGeneration';
import {
  DOW_NAMES, SERIES_HORIZON_DAYS, SERIES_MINUTES, RECURRING_CLASH_NOTE, RECURRING_CREDIT_NOTE,
  cancelOptions, clashLine, createdLine, seriesLabel,
  type CancelOption, type RecurringSeries,
} from '../../src/lib/recurring';
import { useRoster } from '../../src/ui/roster';
import type { TrainingSession } from '../../src/lib/types';
import { buildIcs, shareIcs } from '../../src/lib/exportShare';
import { sendPushChecked } from '../../src/ui/pushNotifications';
import { rateCentsToSnapshot } from '../../src/lib/rateSnapshot';
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import type { MyCurrency } from '../../src/lib/currencySource';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { hitSlopFor, MIN_TARGET } from '../../src/lib/a11y';
import { sharePercent } from '../../src/lib/sharePercent';
import { supabase } from '../../src/lib/supabase';
import { useTenant } from '../../src/ui/tenant';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { useNow } from '../../src/ui/today';
// Who is actually in an hour. `roster.find(…)?.name ?? 'Open slot'` presented a
// booked hour whose client the roster read never returned as a free one, on the
// screen where a coach decides what to give away. See the module header.
import { slotLabel, slotWhoName, unnamedSlotNote } from '../../src/lib/slotName';
// The two questions the day sheet could not answer: whose hour this is, and
// what they are due to train in it. Both were reachable only by LEAVING the
// day — the client's record was behind Check In, which marks them present on
// the way through, and their session for the day was three taps further on
// behind the programme tab. See the header of src/lib/daySession.ts; every
// sentence and every refusal below comes out of it, and none of them is
// decided here.
import {
  clientTap, clientTapLabel, trainingOnDay, dayTrainingCaveat, dayPlanHeading, dayPlanUnread,
} from '../../src/lib/daySession';
// The finish half of the hour — see the note on the control below.
import { canFinish } from '../../src/lib/sessionFinish';
import {
} from '../../src/lib/daySession';
// Which programme each client is on, and the day the coach said their block
// begins. The same provider app/(trainer)/client-week.tsx resolves a week
// from, read the same way — there is one answer to "which week" in this app.
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
// The group timetable this screen has always loaded and never drawn. See
// src/lib/dayClasses.ts — the classes a coach teaches were invisible on the
// coach's own day sheet while the same list was silently blocking bookings.
import { classDayCaveat, classDayHeading, classDayNote, classesOnDay } from '../../src/lib/dayClasses';
// Check In is a write made standing next to somebody, usually in a basement.
// It went straight to `markOutcome`, so a check-in made down there failed
// outright and the delivered session — which is money — was lost.
import { useFloorQueue } from '../../src/ui/floorQueue';
import { floorPendingNote, flushResultLine, keptOfflineLine, refusedLine } from '../../src/lib/floorQueue';
// Paging back into a month the read never reached must not draw an empty grid.
// See `monthNote` below. Surgical addition alongside the calendar-sync work in
// this file — three lines of state and one Flag under the grid, nothing else.
import { readBoundary, monthCoverage, monthCoverageNote } from '../../src/lib/sessionHistory';
import { appLocale } from '../../src/lib/locale';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { useCoachReminders } from '../../src/ui/coachReminders';
import { coachMoveRefusalLine, coachMovedLine } from '../../src/lib/reschedule';
// Where a session can be moved TO when the coach has not already opened the
// hour. The Move sheet offered pre-existing open slots and nothing else, so
// "shift Tuesday 7am to 8am" — the single most ordinary thing that happens to a
// diary — was answered with "open one from Weekly Availability first", and the
// coach's real alternative was Cancel. supabase/parts/461 lists what Cancel
// does to a move: the hour goes to a waitlist before the client has been put
// anywhere, the client is told they were cancelled, and re-booking them draws a
// SECOND pack credit. supabase/parts/1830 is the atomic version that takes a
// TIME rather than a destination row; src/lib/moveTimes.ts decides which times
// may honestly be offered and what may be claimed about them.
import {
  workWindows, moveTimes, groupMoveTimes, moveTimesCaveat, emptyMoveTimesLine,
  moveAtRefusalLine, moveAtConfirmBody, type MoveBlocker, type MoveTime,
} from '../../src/lib/moveTimes';
import { moveSessionToTime } from '../../src/ui/coachMoveAt';
// The two things a calendar cannot draw, because both of them are absences: an
// hour with nothing in it that no client can book, and a client who stopped
// appearing. See the headers of both modules — neither is src/lib/clientDrift.ts
// and neither pretends to be.
import {
  dayGaps, sellableGaps, gapsAreKnown, gapsUnknownNote, gapLengthLabel, gapNote, gapsHeading,
} from '../../src/lib/dayGaps';
import {
  unrebooked, rebookingListable, rebookCoverageNote, unrebookedHeading, unrebookedNote,
  noUnrebookedLine, REBOOK_CANCELLED_GAP_NOTE,
} from '../../src/lib/rebooking';
import {
  blockDates, summariseBlocks, blockSummaryLine, blockPlanLabel,
  cancelAndBlockBody, cancelAndBlockLabel, sessionsBlocking,
  type BlockOutcome, type BlockResult, type BlockSummary,
} from '../../src/lib/blockRange';
// The phone's own diary, and the two rules the whole feature rests on.
//
// NOT `import … from 'expo-calendar'`, here or anywhere. That package reaches
// requireNativeModule at module scope, so on an install made before the
// dependency landed the import throws while this file is LOADING and the coach
// has no schedule tab at all — which is what expo-clipboard did to the coach's
// home tab in August. HAS_NATIVE_CALENDAR answers false on those installs by
// design (the version was deliberately not moved), the sheet says so in words,
// and everything else on this screen is untouched.
//
// And the read takes times and nothing else: no title, no attendee, no note,
// no location. See src/lib/deviceBusy.ts, which is where that is enforced and
// asserted.
import { HAS_NATIVE_CALENDAR, CALENDAR_UNAVAILABLE_NOTE } from '../../src/ui/nativeModules';
import { readDeviceBusy, type DeviceBusyRead } from '../../src/ui/deviceBusy';
import {
  busyBlockLabel, busyCandidates, busyWindow, candidateMinutes, candidateTimeLabel, foldByDay,
  BUSY_NOTES, BUSY_PRIVACY_NOTE, type BusyCandidate,
} from '../../src/lib/deviceBusy';
// A second calendar, and the first thing this app has ever written into one.
//
// S6 above reads the diary on the HANDSET. That is the whole of it, and it
// covers nobody whose appointments live in a Google account they read on a
// laptop — for them the phone answers "nothing found", which is the truest
// empty list this app can produce and is still the wrong answer on the screen
// whose job is to stop a double booking.
//
// The two sources are merged BEFORE anything is drawn, on spans, through the
// same `busyCandidates` both already go through. Two lists that disagreed
// would be two rows for one dentist appointment, two `block_time` calls, and
// an 'already-blocked' refusal on the second that a coach reads as a failure.
//
// The read grant is `calendar.freebusy`, which cannot see a title — see
// src/lib/calendarSync.ts. The write grant is asked for separately, only when
// a coach turns writing on, and reaches only a calendar Repple itself made.
import {
  combineBusy, linkState, missingSourceNote, plannedSyncEvents, pushLabel, pushSummaryLine,
  syncClassesNote, type SyncTeaching,
  LINK_NOTES, NO_CALENDAR_LINK, REMOTE_SCOPE_NOTE, WRITE_PRIVACY_NOTE,
  type BusySourceState, type CalendarLink, type SyncSource,
} from '../../src/lib/calendarSync';
// What the coach is told after a slot goes round the roster, and why the count
// in it is the server's rather than the size of the list we sent.
import { reofferConfirmation } from '../../src/lib/reofferCopy';
import {
  CALENDAR_SYNC_CONFIGURED, connectGoogleCalendar, disconnectGoogleCalendar,
  pushAgainSoon, pushIsDue, pushSessions, readCalendarLink, readRemoteBusy,
  setCalendarWrite, type RemoteBusyRead,
} from '../../src/ui/calendarSync';
import { BRAND } from '../../src/lib/brands';
import { fmtDay, fmtTime, monthNames, monthNamesShort, weekdayNameShort } from '../../src/lib/format';
import { useAuth } from '../../src/ui/auth';

// ── the weekday, the month and the clock, in the reader's own language ─────
//
// All three were this file's own and all three were English: `DOW` and `MON`
// were hardcoded arrays read at roughly twenty sites, and `timeLabel` hand-built
// a 12-hour clock with no 24-hour form at all — so a coach in Berlin read every
// hour of their working week as "7pm". app/(trainer)/classes.tsx removed the
// identical three helpers from itself and says why in its own header; this is
// the screen with ten times the traffic, and it kept them.
//
// Four of the sites are PUSHES. A booking confirmation and a cancellation leave
// the coach's phone and arrive on a client's, so the English weekday reached
// somebody who never chose this app — and `scripts/check-locale.mjs` cannot see
// a hand-built table, which is why it passed the whole time.
//
// Computed once at module scope: `appLocale()` is resolved at launch and does
// not change while the app runs (src/lib/locale.ts).
const DOW = Array.from({ length: 7 }, (_, i) => weekdayNameShort(i));
const MON = monthNames();
/** The abbreviated months. NOT `MON_SHORT[m]`, which was what this file
 *  did — three characters off a month name is an abbreviation in English and
 *  nothing at all in most other languages. */
const MON_SHORT = monthNamesShort();

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
/** The reader's own clock — 24-hour where they use one. See src/lib/format.ts. */
const timeLabel = (iso: string) => fmtTime(iso);
/** "Tue 8 Sep", written the way the reader's locale writes it. */
const dateLabel = (iso: string) => fmtDay(iso);
/** The same, for a `Date` that is not a stored instant — the day the coach has
 *  selected on the grid. Never `${d.getDate()}/${d.getMonth() + 1}`: a coach in
 *  the United States reads that month-first, so "Wed 9/12" is 9 December here
 *  and 12 September there, and it was the last sentence before a cancellation. */
const dateOfLabel = (d: Date) => `${DOW[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]}`;

/**
 * A selectable pill. Takes the theme as a prop rather than calling useTheme —
 * the screen's hook order is part of its contract.
 */
function Chip({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: on ? '500' : '400', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

// Every hour of the day.
//
// This was a hand-written list that ran 6am–1pm and then jumped to 4pm, so a
// coach could not book anybody at 2pm or 3pm at all — and nothing said why.
// Any hand-picked window is somebody's assumption about when training
// happens: a 5am lifter, a shift worker training at 11pm, a gym that opens
// at four. The calendar has no business deciding that, so it offers all
// twenty-four and lets the coach pick.
const HOURS = Array.from({ length: 24 }, (_, h) => h);
// Quarter past, half past, quarter to. The time was whole hours only, and
// sessions are not: an 8:30 start had to be booked as 8 or 9 and the record
// was wrong either way. A second row rather than 64 chips in one scroller —
// hour then minute is two short reads; one list of every quarter hour is a
// drag through a haystack.
//
// Taken from src/lib/recurring rather than written out again. It is the grid
// `trainer_availability.minute` uses and the grid `session_series_minute_chk`
// ENFORCES: a standing appointment at 07:03 is refused by the database, so a
// picker that could offer one would be a control whose value the server throws
// away. One list, stated once, and the three sheets below cannot drift from it.
const MINUTES = SERIES_MINUTES;
/**
 * How far ahead Repple writes sessions into a coach's own calendar.
 *
 * Four weeks. It is a WINDOW rather than "everything", because a push is a
 * reconciliation — anything of ours inside the window that is not in the list
 * sent is removed, which is how a cancellation reaches Google — and a window
 * bounds what a single bad read could undo. Four weeks is also what
 * `generateSlots` fills, so the two halves of this screen agree about how far
 * ahead a coach's week is a real thing rather than an intention.
 */
const PUSH_DAYS = 28;
/** An hour of the day as a person says it, including the 24 that means the
 *  end of it. Written once because three places were saying it and only two
 *  of them knew about midnight. */
const hourLabel = (h: number) => (h === 24 ? 'midnight' : `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`);
/** A weekly slot's start, written once so the list row, the heading above the
 *  picker and the Add button cannot drift apart. Minutes are always shown,
 *  including :00 — "Wed 9am" and "Wed 9:15am" side by side reads as two
 *  different kinds of thing. */
const avTime = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
const DURS = [30, 45, 60, 90];

/**
 * Hour, then quarter — the only way this app asks anybody for a time of day.
 *
 * It was written out three times in this file, once per sheet, and the copies
 * had already come apart before: the weekly-availability sheet was still on a
 * hand-picked 6am–8pm list of whole hours long after the Add Session sheet
 * offered all twenty-four, so a coach could book a client at 6:45 but could not
 * OFFER 6:45 every week. A fourth copy for standing appointments is how that
 * happens again, so there is one control and the three sheets pass their own
 * state into it.
 */
function TimeGrid({ t, hour, minute, onHour, onMinute }: {
  t: Theme; hour: number; minute: number; onHour: (h: number) => void; onMinute: (m: number) => void;
}) {
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
        {HOURS.map((h) => (
          <Chip key={h} t={t} label={`${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`} on={hour === h} onPress={() => onHour(h)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        {MINUTES.map((m) => (
          <View key={m} style={{ flex: 1 }}>
            {/* The spoken label is the WHOLE time, not ":15". A row of four
                pills each announcing a bare minute tells a screen-reader user
                nothing about what they are choosing. */}
            <Pressable onPress={() => onMinute(m)} accessibilityRole="button"
              accessibilityState={{ selected: m === minute }}
              accessibilityLabel={avTime(hour, m)}
              style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: m === minute ? t.brand : t.surface2 }}>
              <Text style={{ ...ty.label, ...numeric, fontWeight: m === minute ? '500' : '400', color: m === minute ? t.brandInk : t.ink2 }}>
                :{String(m).padStart(2, '0')}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </>
  );
}


let SEQ = 5000;

export default function TrainerSchedule() {
  const t = useTheme();
  /* `useNow`, not a bare `new Date()` in the render body.
   *
   * A bare call is right at the instant something else happens to redraw, and
   * nothing here redraws for the clock: this tab is never unmounted, and there
   * was no midnight timer and no AppState listener behind this value. `now`
   * feeds `todayKey` — the ring the grid draws around today — and
   * `viewingPastMonth`, which decides whether the coverage warning treats the
   * month on screen as behind or ahead. A schedule left open overnight kept
   * ringing yesterday and kept judging the month boundary against it.
   *
   * `useNow` (src/ui/today.ts) settles on local midnight, on the app coming
   * back to the foreground, and on focus — the three moments this can go
   * stale. Six sibling screens already use it; this one is the tab it matters
   * on most, because the ring is what a coach reads the day off.
   *
   * Nothing on this screen keys an effect off `now`, so the extra settle costs
   * one render. The three `useState` initialisers below read it once at mount
   * and are deliberately not moved by it — the month the coach has scrolled to
   * is theirs, not the clock's. */
  const now = useNow();
  const router = useRouter();
  const { sessions, status: sessionsStatus, addSession, releaseSession, removeSession, refresh, rescheduleClientSession } = useSessions();
  // ── The empty diary that was not empty ───────────────────────────────────
  //
  // Every figure and every empty-state sentence below was built straight off
  // `sessions.length`, and this provider returns an empty list for two entirely
  // different answers: the coach genuinely has nothing scheduled, and the
  // calendar could not be read. Under 'error' this screen therefore told a
  // coach with a full week "Booked — 0 sessions", "Nothing scheduled yet" and,
  // on whichever day they tapped, "No sessions this day" — the standing rule in
  // src/ui/loadStatus.ts, broken on the screen where it costs the most. A coach
  // reading that thirty seconds before a client arrives does not conclude the
  // network is down; they conclude the booking never happened.
  //
  // 'partial' is separated from 'ready' for the other half of the rule: the
  // rows are real but they are not all of them, so they may be listed and must
  // not be counted. Both counts and the percentage go to a dash there.
  const known = sessionsStatus !== 'error';
  const countable = sessionsStatus === 'ready';
  // The other side of this booking happens on somebody else's phone. Re-read on
  // focus so what is on screen is the diary as it stands, not as it stood at
  // launch — including a slot that has just been taken.
  // ── the focus refresh that would not stop ─────────────────────────────
  //
  // This was `useFocusEffect(useCallback(() => { refresh(); }, [refresh]))`,
  // and on the live edge logs it read the diary roughly twice a second for as
  // long as Schedule was the focused tab — 782 responses in five idle minutes
  // from one handset, measured. The lap: `refresh()` hydrates, `setSessions`
  // takes a new array, `SessionsProvider` re-renders, its context value is an
  // object literal (src/ui/sessions.tsx:754) so `refresh` is a new function,
  // this `useCallback` changes identity, the effect re-runs, `refresh()`.
  //
  // `useRefreshOnFocus` exists for exactly this and its header argues the whole
  // case: the refresh is held in a ref, the callback handed to
  // `useFocusEffect` never changes, and the hook runs on FOCUS and on nothing
  // else — which is all its name ever promised. The latest `refresh` is still
  // the one that runs, because the ref is written every render.
  //
  // This is the defensive half. The root cause is the unmemoised context value
  // in src/ui/sessions.tsx, which is read by app/(client)/** as well and is not
  // this lane's file to change; the same loop is live at
  // app/(client)/calendar.tsx:290 and app/(client)/standing.tsx:160 until it is
  // fixed there.
  useRefreshOnFocus(refresh);

  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  /* ── what each of them is due to train ──────────────────────────────────
   *
   * The day sheet listed a time, a duration and a status, and a coach standing
   * in front of the day they were about to work could not find out from it what
   * the 8am was supposed to be. It was on the client screen, behind the
   * programme tab, three taps on.
   *
   * This provider already holds it — the programme and the coach's own start
   * date for every client on the book — and `trainingOnDay` resolves the day
   * out of it through `blockPosition`, `clientWeek` and `scheduledDay`, which
   * is the machinery app/(trainer)/client-week.tsx already uses. Its own
   * status is carried into every answer: a null programme under a failed read
   * is UNKNOWN, and drawing it as a rest day is the one thing this must not do.
   */
  const ap = useAssignedPrograms();
  /* ── the group timetable, which this screen never asked about ───────────
   *
   * `addSession` checks `overlaps` against the `sessions` list and nothing
   * else. Classes are rows in `gym_classes` behind a separate provider, so
   * Generate Open Slots would put a bookable PT hour on top of the class the
   * coach was running, a client would take it, and both would turn up. The
   * double-booking guard the whole booking side rests on had a hole the size of
   * the group timetable.
   *
   * `classStatus` is carried for the same reason every other status on this
   * screen is: an empty class list under 'error' is a read that did not happen,
   * and the one thing this must not do is report a clear hour it never checked.
   */
  const { classes: gymClasses, status: classStatus, refresh: refreshClasses } = useClasses();
  const classesKnown = classStatus !== 'error';
  // Who is waiting on which of these hours. A booked slot with somebody behind
  // it is not the same object as one with nobody behind it: cancelling the
  // first hands it straight over, and the coach should be able to see that
  // before they do it rather than after.
  const bookedIds = sessions.filter((x) => x.status === 'booked').map((x) => x.id).sort();
  const { counts: waitCounts, status: waitStatus, reload: reloadWaits } = useSessionWaitlistCounts(bookedIds);
  // The fees this coach's clients have actually been charged — rows in
  // `charges`, which nothing in this product wrote until part 126. The coach is
  // the one who collects them, so they are the one who has to be able to see
  // them, and to let one off.
  const { charges: lateFees, status: feeStatus, waive: waiveFee, unwaive: unwaiveFee, reload: reloadFees } = useLateCancelCharges();
  const lcPolicy = useMyCancellationPolicy();
  // Pulled out because the hook hands back a fresh object every render; the
  // callback inside it is stable, and depending on the object would rebuild the
  // refresh control on every frame.
  const reloadPolicy = lcPolicy.reload;
  // The fee was recorded by the CLIENT's cancellation, on their phone, and the
  // waitlist moved with it. Neither shows up here without asking again.
  // `useRefreshOnFocus` for the same reason as the diary re-read above:
  // `reloadFees` comes out of the same object-literal context value in
  // src/ui/sessions.tsx, so its identity changes on every render of that
  // provider and a dependency array on it is an unbounded read loop waiting
  // for the provider to change state. Skipping the FIRST focus is correct
  // here — `useLateCancelCharges` loads itself on mount, so the old shape was
  // buying a duplicate read on the way in.
  useRefreshOnFocus(reloadFees);
  const { tenant } = useTenant();
  /* ── what a checked-in session is filed as being worth ───────────────────
   *
   * Two halves, and this screen was missing BOTH of them for a coach with no
   * gym. It snapshotted `tenant?.sessionFee` alone, where the marking queue and
   * the log screen both fall back to the coach's own rate; and it converted by
   * `tenant?.currency`, which is null for a coach with no gym, so the figure
   * had no unit and no rate was written at all.
   *
   * Both are the same fix and they are made together on purpose. The three
   * screens that write `sessions.rate_cents` must agree — a coach who checks a
   * client in here, marks the next one from the queue and finishes a third from
   * the log screen would otherwise have one hour of the same work filed three
   * different ways, with nothing on any screen saying which was right. All
   * three now call `rateCentsToSnapshot`, and the currency comes from the one
   * precedence rule in src/lib/currencySource.ts: the gym is the authority, and
   * `trainers.currency` (part 940) applies if and only if there is no gym.
   *
   * The read is skipped where the tenant provider already holds a gym currency
   * — that IS the authoritative answer, and it is the copy that survives a
   * check-in made in a basement.
   */
  const { sessionFee: ownFee } = useMyTrainerProfile();
  const gymCcy = (tenant?.currency || '').trim() || null;
  const [myCcy, setMyCcy] = useState<MyCurrency | null>(null);
  useEffect(() => {
    let live = true;
    if (gymCcy) { setMyCcy(null); return; }
    void (async () => { const c = await fetchMyCurrency(); if (live) setMyCcy(c); })();
    return () => { live = false; };
  }, [gymCcy]);
  /* ── who is in an hour, and the answer that used to be guessed ──────────
   *
   * This was `roster.find((c) => c.id === id)?.name ?? 'Open slot'`, and those
   * three words came out of two entirely different facts: a slot with no client
   * in it, and a booked slot whose client this screen's roster read did not
   * return. The second was drawn as the first in the day sheet, the cancel
   * confirmation, the move sheet and the fee list — the four places a coach
   * decides whether an hour is theirs to give away.
   *
   * `nameOf` is the form that goes inside a sentence and `slotOf` the one that
   * goes on a row; src/lib/slotName.ts holds both, and the reason they are two
   * functions rather than one. `rosterStatus` is passed because a missing id
   * under a whole read is a client who has left the book, and under any other
   * read is a list that did not come back — different sentences.
   */
  const nameOf = (id: string | null) => slotWhoName(id, roster, rosterStatus);
  const slotOf = (id: string | null) => slotLabel(id, roster, rosterStatus);
  /**
   * Whether a booked row opens onto somebody, and what to route with.
   *
   * The third reading off the SAME roster and the same status as the two
   * above, from the same vocabulary — a fourth answer to "who is in this hour"
   * invented here is how a row could say "Booked · not on your book any more"
   * and still push at a record that cannot be drawn.
   */
  const tapOf = (id: string | null) => clientTap(id, roster, rosterStatus);
  /** Open the client's record. `name` is passed ONLY when it is a name: the
   *  record prints what it is handed as a title, and `slotWhoName` returns
   *  noun phrases. Same rule and same route as `checkIn` below, minus the
   *  write — a coach reading somebody's injuries before a session has not
   *  marked them present. */
  const openClient = (tap: ReturnType<typeof clientTap>) => {
    if (!tap.can || !tap.clientId) return;
    router.push({
      pathname: '/(trainer)/client',
      params: tap.name ? { clientId: tap.clientId, name: tap.name } : { clientId: tap.clientId },
    });
  };

  // ── The one person in the transaction this app never reminded ───────────
  //
  // `scheduleLocal` is wired into three places and all three are the CLIENT's:
  // their booking, their class, their streak. A client who forgets their 6:30
  // has wasted their own hour; a coach who forgets it has stood somebody up.
  //
  // Armed off THIS screen's own read rather than a second query — same rows,
  // same status, so the phone's reminders and the grid can never describe
  // different diaries. Under 'error' the provider hands back an empty list and
  // nothing is passed at all: null means "the read did not answer" and the sync
  // then does nothing, which is the important half. Cancelling every armed
  // reminder because one query failed would leave a coach with a silent phone
  // and no way to know it.
  //
  // The window handed in is the window that was actually READ, so an arming for
  // a session outside it is left alone rather than cancelled on the strength of
  // a query that never asked about it. See src/lib/coachReminders.ts.
  const { user } = useAuth();
  /** The signed-in coach. Named rather than read inline, because it decides
   *  which classes on the gym's board are this coach's to be double-booked by. */
  const coachId = user?.id ?? null;
  /* ── the queue Check In was not going through ───────────────────────────
   *
   * `markOutcome` wrote straight to the server, so a check-in made in a
   * basement failed outright: the coach was told it did not save, the client
   * was standing in front of them, and the delivered session — which is what
   * the gym pays on — was lost. src/lib/floorQueue.ts exists for exactly this
   * and already carried the same write from app/(trainer)/sessions.tsx.
   *
   * Nothing here softens rule 1: a kept check-in is reported as kept, in the
   * queue's own words, and never as saved.
   */
  const floor = useFloorQueue(coachId);
  const [floorSending, setFloorSending] = useState(false);
  const [floorNote, setFloorNote] = useState<string | null>(null);
  const sendFloorNow = async () => {
    if (floorSending) return;
    setFloorSending(true);
    setFloorNote(null);
    try { setFloorNote(flushResultLine(await floor.flush())); } finally { setFloorSending(false); }
  };
  const remindable = known
    ? sessions.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      status: s.status,
      // `TrainingSession` carries no outcome — this provider reads the diary
      // rather than the delivery record. Null is the honest value and it is
      // also the safe one: `toArm` only refuses a session whose outcome is
      // KNOWN to be set, and the arming window is seven days ahead, where
      // nothing has an outcome yet by definition.
      outcome: null as string | null,
      clientName: s.clientId ? (roster.find((c) => c.id === s.clientId)?.name ?? null) : null,
    }))
    : null;
  // The provider reads from the start of the current month forward, and the
  // grid pages through months, so the honest window is "everything this screen
  // has looked at". Taken from the rows themselves rather than assumed.
  const readFrom = remindable && remindable.length
    ? Math.min(...remindable.map((s) => Date.parse(s.startsAt)).filter(Number.isFinite))
    : Date.now();
  const readTo = remindable && remindable.length
    ? Math.max(...remindable.map((s) => Date.parse(s.startsAt)).filter(Number.isFinite))
    : Date.now();
  useCoachReminders(user?.id ?? null, remindable, readFrom, readTo);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selKey, setSelKey] = useState(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);
  const [addOpen, setAddOpen] = useState(false);
  const [addHour, setAddHour] = useState(9);
  const [addMinute, setAddMinute] = useState(0);
  const [addDur, setAddDur] = useState(60);
  const [addClient, setAddClient] = useState<string | null>(null);
  // Opened from a client's own profile ("Book a Session"), the coach has already
  // said who this is for. Asking them again on the next screen is the step that
  // made booking-for-a-client feel like it did not exist.
  const params = useLocalSearchParams();
  const bookFor = typeof params.clientId === 'string' && params.clientId ? params.clientId : null;
  useEffect(() => {
    if (!bookFor) return;
    setAddClient(bookFor);
    setAddOpen(true);
  }, [bookFor]);
  // `status` as well as the slots, and this screen is the ONLY consumer of this
  // provider — so it was the one provider on the page whose status was
  // destructured away, on a screen that already refuses to act on an unread
  // CALENDAR (see `generateSlots` below). `useAvailability` sets 'error' on
  // three separate paths (src/ui/availability.ts), and under every one of them
  // `slots` is empty for want of a read. The sheet then said "No weekly slots
  // yet" and the row beneath the calendar said "Set the times you offer every
  // week" — to a coach whose week is set and whose clients can still book it.
  const { slots: availSlots, status: availStatus, addSlot: addAvail, removeSlot: removeAvail,
          zoneless, deviceZone: phoneZone, setZoneOnUnzoned, reload: reloadAvail } = useAvailability();
  /** Whether `availSlots` is the whole of this coach's week. Under 'partial'
   *  the slots listed are real but there are more, so it is still not a set
   *  anything may be counted from or declared empty. */
  const availKnown = isWhole(availStatus);
  /**
   * How many people are waiting on this coach's booking screen, or null.
   *
   * NULL under anything but a whole roster read, and that is the point of it.
   * `openSlotWindow` reaches 'never-set' — the state that tells a coach their
   * clients cannot book them — only when this is a real, positive count, and
   * stays silent on a number nobody could read. A 'partial' roster is the
   * dangerous one: it holds real people, so it is tempting to count, but a
   * truncated book counted as the whole book is a figure this screen would then
   * print in a sentence at somebody.
   */
  const clientsOnBook = isWhole(rosterStatus) ? roster.length : null;

  /**
   * How much bookable diary is left, and whether to say anything about it.
   *
   * `known` and not `countable`: a partial read still holds real open slots and
   * the furthest one it did return is a floor on the window, so the warning it
   * produces is conservative rather than wrong. Under 'error' the state is
   * 'unknown' and nothing is drawn at all — an unread calendar is not an empty
   * one, and this is the screen where that mistake sends a coach to regenerate
   * a diary that is already full.
   *
   * `availKnown` gates the OTHER half: a coach whose weekly times could not be
   * read has not been shown to have none, so they are not told their generated
   * slots have run out either.
   */
  const slotWindow = openSlotWindow(sessions, {
    known, hasWeekly: availKnown && availSlots.length > 0, clientsOnBook,
  });
  const slotLine = slotWindowLine(slotWindow, clientsOnBook);
  const [availOpen, setAvailOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blkFrom, setBlkFrom] = useState(9);
  const [blkTo, setBlkTo] = useState(17);
  const [blkAllDay, setBlkAllDay] = useState(false);
  const [blkBusy, setBlkBusy] = useState(false);
  // ── Blocking more than one day ──────────────────────────────────────────
  //
  // `doBlock` blocked ONE day per confirmation, so a coach going away for a
  // fortnight tapped through fourteen sheets and a coach who never works Sunday
  // blocked this Sunday and then had to remember again next week.
  //
  // This is NOT the roadmap's "block time from the phone's own calendar":
  // reading the device calendar needs `expo-calendar`, which is not a
  // dependency, so it is a new native module and a new binary — the same
  // objection that took two-way sync off this wave. What was actually painful
  // was the fourteen sheets, and that half needs nothing new.
  //
  // Both default to 1, which is exactly the behaviour that was there before.
  const [blkDays, setBlkDays] = useState(1);
  const [blkWeeks, setBlkWeeks] = useState(1);
  // ── Blocking what the phone already knows ───────────────────────────────
  //
  // Everything above starts from the coach REMEMBERING. A coach whose Repple
  // availability does not know about their dentist appointment double-books
  // once, and after that they stop trusting the availability generator, which
  // is the feature the whole booking side of this app rests on.
  //
  // `busyAsked` is not a spinner flag. Nothing is read, and no operating-system
  // prompt is raised, until the coach has had the chance to read what will be
  // taken off their calendar — which is a start and an end, and nothing else.
  const [busyOpen, setBusyOpen] = useState(false);
  const [busyAsked, setBusyAsked] = useState(false);
  const [busyDays, setBusyDays] = useState(14);
  const [busyRead, setBusyRead] = useState<DeviceBusyRead>({ status: 'loading', permission: 'unknown', candidates: [], spans: [] });
  /** What the linked Google account said, kept apart from the phone's answer
   *  all the way to `combineBusy`. Folding them together earlier would lose the
   *  one fact the sheet has to keep: WHICH source failed. */
  const [remoteRead, setRemoteRead] = useState<RemoteBusyRead>({ status: 'ready', spans: [] });
  /** The one list on screen, built from both sources' spans at load time.
   *  Held in state rather than recomputed in render because it belongs to the
   *  window that was read, and the selected day moves under the sheet. */
  const [busyCands, setBusyCands] = useState<BusyCandidate[]>([]);
  /** The periods the coach has picked, by key. Empty on purpose and never
   *  seeded: nothing found in somebody's diary is blocked unless they chose it
   *  one row at a time. An all-day "Birthday" is not a reason to close a
   *  Tuesday, and this app is not the judge of which entry is which. */
  const [busyPicked, setBusyPicked] = useState<string[]>([]);
  const [busyBusy, setBusyBusy] = useState(false);
  /* ── The Google connection ──────────────────────────────────────────────
   *
   * `syncStatus` is 'error' when the link itself could not be read, and that
   * is NOT the same as "not connected": offering a Connect button to a coach
   * who is already connected would walk them through a consent screen for a
   * grant they have, and the sheet says which of the two it is knowing.
   */
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncLink, setSyncLink] = useState<CalendarLink>(NO_CALENDAR_LINK);
  const [syncStatus, setSyncStatus] = useState<LoadStatus>('loading');
  const [syncBusy, setSyncBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [avDow, setAvDow] = useState(1);
  const [avHour, setAvHour] = useState(9);
  const [avMinute, setAvMinute] = useState(0);
  // A stretch of the day, rather than one slot at a time. Defaulted ON: the
  // single-slot form is the one nobody could face using, so it is the
  // alternative now rather than the only way in.
  const [avRange, setAvRange] = useState(true);
  const [avDays, setAvDays] = useState<number[]>([1]);
  const [avFrom, setAvFrom] = useState(7);
  const [avTo, setAvTo] = useState(19);
  // Quarter-hour precision on both ends. Whole hours alone cannot express
  // 06:30–19:30, which is an ordinary gym day and was simply unreachable.
  const [avFromMin, setAvFromMin] = useState(0);
  const [avToMin, setAvToMin] = useState(0);
  const [avDur, setAvDur] = useState(60);
  const [avBusy, setAvBusy] = useState(false);
  /* ── Standing appointments ────────────────────────────────────────────────
   *
   * "Ana trains with me at seven every Tuesday" — the single most common fact
   * about a personal trainer's week, and until supabase/parts/135 there was
   * nowhere in this product to put it. What a coach did instead was press
   * Generate, wait for Ana to book each slot by hand, and press Generate again
   * next month. The arrangement now lives on the server and a daily job writes
   * it out as ordinary booked sessions eight weeks ahead, so nothing on this
   * screen generates anything and nobody re-taps anything.
   *
   * `seriesStatus` carries the same discipline as every other read here, and it
   * matters more on this one than almost anywhere: an empty list under 'error'
   * means the arrangements COULD NOT BE READ. "You have no standing
   * appointments" said to a coach who has five is how somebody gets stood up.
   */
  const { series, status: seriesStatus, reload: reloadSeries, create: createSeries, end: endSeries } = useRecurringSeries();
  // Either party may end a standing appointment — an agreement one side cannot
  // leave is not one — so the arrangement a coach is looking at may have been
  // ended on the client's phone since this screen loaded. Re-read on focus, the
  // same reason the calendar and the fees are.
  // Same swap, same argument. `useRecurringSeries` (src/ui/availability.ts)
  // also loads itself on mount, so nothing is lost by not firing on the first
  // focus.
  useRefreshOnFocus(reloadSeries);

  /* ── pull to refresh ─────────────────────────────────────────────────────
   *
   * This screen is the one a coach comes back to. Everything on it was written
   * somewhere else: a client books on their phone, a client cancels and the fee
   * is recorded by their cancellation, the gym schedules a class into the hour a
   * one-to-one wants, a standing arrangement is ended from the other side.
   * Focus effects already re-read the fees and the standing series, but a coach
   * who leaves this screen open — which is what it is for — sits on a diary that
   * stops moving, and the calendar itself, the classes, the waitlists and the
   * weekly grid had no way of being asked again at all.
   *
   * Eight reads and all eight of them, because this screen crosses them
   * constantly: `classClashes` compares the diary against the gym's classes,
   * the slot-window warning above compares the diary against the weekly grid
   * AND the roster, and the fee rows are read against the policy. A refresh
   * that moved one and left another would produce a clash warning about an hour
   * that no longer holds either thing in it. */
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    refresh(), refreshRoster(), Promise.resolve(refreshClasses()),
    Promise.resolve(reloadWaits()), Promise.resolve(reloadFees()),
    Promise.resolve(reloadSeries()), Promise.resolve(reloadAvail()),
    Promise.resolve(reloadPolicy()),
    // The plan on each booked row is resolved from these. A pull that moved
    // the diary and left the assignments would redraw the day against the
    // programmes this phone was already holding — which under a failed read is
    // exactly the state the row's own caveat is about, and a coach who pulls
    // to clear it should actually be clearing it.
    Promise.resolve(ap.reload()),
  ]), [refresh, refreshRoster, refreshClasses, reloadWaits, reloadFees, reloadSeries, reloadAvail, reloadPolicy, ap]));
  // What is running. An ended arrangement stays in the table for the record and
  // is not listed — a coach's screen is their week, not their history — but it
  // is counted, so the empty state can tell "you have never made one" apart
  // from "the one you had, you ended".
  const standing = series.filter((s) => s.active);
  const endedCount = series.length - standing.length;
  // The zone a new arrangement would be stored against. Null when the runtime
  // cannot say, and `create` refuses rather than guessing at UTC — an
  // appointment pinned to the wrong zone is seven in the morning somewhere
  // nobody involved lives.
  const devTz = deviceTimeZone();
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [srClient, setSrClient] = useState<string | null>(null);
  const [srDow, setSrDow] = useState(1);
  const [srHour, setSrHour] = useState(9);
  const [srMinute, setSrMinute] = useState(0);
  const [srDur, setSrDur] = useState(60);
  const [srBusy, setSrBusy] = useState(false);
  // The arrangement the two-option sheet is open for. There is deliberately no
  // "which option is selected" state to go with it: a sheet that remembers a
  // choice is a sheet that can be confirmed without being read, and the two
  // choices here have different consequences and different prices.
  const [endFor, setEndFor] = useState<RecurringSeries | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  // `addSession(...).ok` means only that the slot did not overlap one already on
  // this screen. Whether it reached the server is `saved`, and that is the half
  // that decides whether a client can ever see the slot — so a slot the server
  // refused used to be counted in "12 open slots added" and then be bookable by
  // nobody. The count now says how many are actually open.
  // ── the slots that stopped coming ────────────────────────────────────────
  //
  // Part 650's nightly job skips an availability row with no timezone, and part
  // 650 filled none in for the rows that already existed. There is no error
  // anywhere in that state: the job runs, reports a count, and the count
  // silently excludes this coach. Their clients find nothing to book and are
  // told nothing, because an empty day is what an empty day looks like.
  const zones = zoneState(zoneless, availSlots.length, availStatus);
  const zoneNote = zonelessNote(zones, zoneless);
  const healLabel = selfHealLabel(zones, phoneZone);
  const noHealNote = noZoneToOfferNote(zones, phoneZone);

  const applyPhoneZone = () => {
    if (!phoneZone || !zoneless) return;
    Alert.alert(
      'Record this timezone?',
      selfHealConfirm(zoneless, phoneZone),
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Record it',
          onPress: async () => {
            const asked = zoneless;
            const saved = await setZoneOnUnzoned();
            Alert.alert(saved ? 'Timezone recorded' : 'Not saved', selfHealResult(saved, asked, phoneZone));
          },
        },
      ],
    );
  };

  const generateSlots = async () => {
    // The asymmetry this fixes was the giveaway. Twelve lines below, an unread
    // CALENDAR stops this function with an explicit "could not be read" — but
    // an unread AVAILABILITY fell straight through to a flat "No availability
    // set. Add at least one weekly slot first", which is an instruction to
    // re-enter a week that is already on the server. Following it walks the
    // coach into the unique index: the duplicate check in `addSlot` runs
    // against the empty local list, so every re-added slot is refused
    // server-side and reported as saved-on-this-phone-only.
    if (!availKnown) {
      Alert.alert(
        'Can’t generate slots yet',
        'Your weekly availability could not be read, so Repple does not know which times you offer — and an empty list here does not mean you have none set.\n\nNothing has been changed and nothing has been lost. Pull down to refresh and try again once you are connected.',
        [{ text: 'OK' }],
      );
      return;
    }
    if (!availSlots.length) { Alert.alert('No availability set', 'Add at least one weekly slot first.'); return; }
    // Generating against a calendar we could not read would open slots on top of
    // sessions that are already there: `addSession`'s overlap check runs against
    // the list this screen holds, and under 'error' that list is empty for want
    // of a read rather than for want of bookings. The result is a coach offering
    // a client an hour somebody else already has.
    if (!known) {
      Alert.alert(
        'Can’t generate slots yet',
        'Your calendar could not be read, so Repple does not know what you already have booked — and generating now could open slots on top of existing sessions.\n\nYour weekly availability is safe. Pull down to refresh and try again.',
        [{ text: 'OK' }],
      );
      return;
    }
    const saves: Promise<boolean>[] = [];
    // Two quite different reasons a time is skipped, and they were reported as
    // one sentence: "you already have something booked then". Generating twice —
    // which a coach does without thinking, because the button does not say it
    // has been pressed — skipped every date against the OPEN slots the first
    // press created, and then announced that the coach's empty week was fully
    // booked. Counted apart so each can be said truthfully.
    let clash = 0;
    let alreadyOpen = 0;
    // Times skipped because the coach is TEACHING then. A third reason, and
    // until it existed this loop happily opened a bookable hour on top of the
    // class the coach was running — a client took it and both turned up.
    let teaching = 0;
    // Classes at one of these times that nobody is recorded against. Not a
    // reason to skip, and not a thing to keep quiet about either.
    let unattributed = 0;
    for (const sl of availSlots) {
      for (const d of upcomingDates(sl.dow, sl.hour, sl.minute, 4)) {
        const iso = d.toISOString();
        const cl = classClashes(iso, sl.dur, gymClasses, coachId);
        if (cl.mine.length > 0) { teaching++; continue; }
        unattributed += cl.unattributed.length;
        const ses: TrainingSession = { id: 'ms' + (SEQ++), trainerId: '', clientId: null, startsAt: iso, durationMin: sl.dur, status: 'available', released: false };
        const res = addSession(ses);
        if (res.ok) { saves.push(res.saved ?? Promise.resolve(false)); continue; }
        // `addSession` refuses on any overlap. Ask the same list it asked which
        // KIND of thing is in the way — a booking or a block the coach must deal
        // with themselves, or simply the offer they already made.
        const blocking = sessions.some((x) => (x.status === 'booked' || x.status === 'blocked')
          && Date.parse(x.startsAt) < Date.parse(iso) + sl.dur * 60_000
          && Date.parse(iso) < Date.parse(x.startsAt) + x.durationMin * 60_000);
        if (blocking) clash++; else alreadyOpen++;
      }
    }
    setAvailOpen(false);
    const results = await Promise.all(saves);
    const added = results.filter(Boolean).length;
    const lost = results.length - added;
    const lines = [
      added + ' open slot' + (added === 1 ? '' : 's') + ' added across the next 4 weeks — your clients can book ' + (added === 1 ? 'it' : 'them') + ' now.',
    ];
    if (alreadyOpen) lines.push(alreadyOpen + ' time' + (alreadyOpen === 1 ? ' was' : 's were') + ' already open on your calendar, so ' + (alreadyOpen === 1 ? 'it was' : 'they were') + ' left as ' + (alreadyOpen === 1 ? 'it is' : 'they are') + '. Nothing was lost.');
    if (clash) lines.push(clash + ' time' + (clash === 1 ? ' was' : 's were') + ' skipped because you already have a session booked or time blocked then.');
    if (teaching) lines.push(teaching + ' time' + (teaching === 1 ? ' was' : 's were') + ' skipped because you are teaching a class then. Nothing was opened on top of a class you are running.');
    // Never folded into the count above. One is "we checked and skipped it",
    // the other is "we could not check", and reporting them as one sentence
    // would let a coach believe an hour was cleared that was not.
    {
      const caveat = classCheckCaveat(classesKnown, unattributed);
      if (caveat) lines.push(caveat);
    }
    if (lost) lines.push(lost + ' slot' + (lost === 1 ? '' : 's') + ' could not be saved to the server, so ' + (lost === 1 ? 'it is' : 'they are') + ' not open to anyone. Try generating again.');
    Alert.alert(added ? 'Slots generated' : 'No slots opened', lines.join('\n\n'));
  };

  // ── the stretch, and what it would do ─────────────────────────────────────
  const rangeInput: RangeInput = {
    days: avDays,
    fromMin: avFrom * 60 + avFromMin,
    toMin: avTo * 60 + avToMin,
    durationMin: avDur,
  };
  // What the coach already holds, so the ceiling is on the WEEK rather than
  // on one gesture. Zero under an unread week: claiming they are near a limit
  // on the strength of a list we could not read is the wrong way to be wrong.
  const rangeRefusal = rangeBlocker(rangeInput, availKnown ? availSlots.length : 0);
  const rangeSlots = rangeRefusal ? [] : expandRange(rangeInput, availKnown ? availSlots.length : 0);
  // Split against the week the coach already has, so re-entering a morning they
  // already offer is counted and skipped rather than refused row by row by the
  // unique index. Under an unread week `availSlots` is empty for want of a read,
  // so nothing is claimed as a duplicate and the server does the deciding.
  const rangeSplit = splitAgainstExisting(rangeSlots, availKnown ? availSlots : []);
  const rangeNote = rangeRefusal ?? rangeSummary(rangeInput, rangeSplit.fresh.length, rangeSplit.duplicates);
  const rangeLeftover = rangeRefusal ? null : remainderNote(rangeInput);

  /**
   * Add every slot in the stretch, and report what the SERVER took.
   *
   * Counted from the outcomes, never from the length of what was sent:
   * `addSlot` answers 'local' for a row that never reached the server, and a
   * coach told "48 slots added" over twelve that landed has a week their
   * clients cannot see three quarters of.
   */
  /**
   * Every slot the coach offers, grouped by day.
   *
   * The flat list was fine when a week was six slots typed in by hand. A range
   * puts fifty on one day, and fifty rows with a minus each is the form this
   * whole feature exists to abolish, pointed backwards.
   */
  const availByDay = DOW.map((_, dow) => availSlots.filter((sl) => sl.dow === dow))
    .map((slots, dow) => ({ dow, slots }))
    .filter((g) => g.slots.length > 0);

  /**
   * The slots the CURRENT range selection already covers.
   *
   * Matched on the day and on the start time falling inside the window — not on
   * the duration, deliberately. A coach who set 07:00-19:00 in hours and now
   * wants it gone selects the same stretch; asking them to also remember they
   * were 60-minute slots would make removal harder than adding, which is the
   * asymmetry this whole sheet exists to remove.
   */
  const rangeExisting = availKnown
    ? availSlots.filter((sl) => {
        if (!avDays.includes(sl.dow)) return false;
        const at = sl.hour * 60 + sl.minute;
        return at >= rangeInput.fromMin && at < rangeInput.toMin;
      })
    : [];

  /** Take everything in the selected stretch off the week. */
  const removeRange = () => {
    const n = rangeExisting.length;
    if (n === 0) return;
    const dayNames = [...new Set(avDays)].sort((a, b) => a - b).map((d) => DOW[d]).join(', ');
    Alert.alert(
      `Remove ${n} slot${n === 1 ? '' : 's'}?`,
      `This takes every weekly slot between ${avTime(avFrom, avFromMin)} and ${avTime(avTo, avToMin)} off ${dayNames}. `
      + 'Open slots already generated from them are NOT withdrawn — anything a client has booked stays booked, '
      + 'and anything still open stays open until it passes. This only stops new ones being generated.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: `Remove ${n}`,
          style: 'destructive',
          onPress: async () => {
            setAvBusy(true);
            let gone = 0;
            for (const sl of rangeExisting) { if (await removeAvail(sl.id)) gone++; }
            setAvBusy(false);
            if (gone < n) {
              Alert.alert(
                'Some are still there',
                `${gone} of ${n} were removed. The rest are still on your week and still generating open slots — try again when you have a connection.`,
                [{ text: 'OK' }],
              );
            }
          },
        },
      ],
    );
  };

  /** Take a whole day off the week, with the count named before it happens. */
  const clearDay = (dow: number, count: number) => {
    Alert.alert(
      `Remove ${DOW[dow]}?`,
      `This takes all ${count} weekly slot${count === 1 ? '' : 's'} off ${DOW[dow]}. `
      + 'Open slots already generated from them are NOT withdrawn — a client who has booked one keeps it, '
      + 'and anything still open stays open until it passes. This only stops new ones being generated.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: `Remove ${count}`,
          style: 'destructive',
          onPress: async () => {
            const mine = availSlots.filter((sl) => sl.dow === dow);
            let gone = 0;
            for (const sl of mine) { if (await removeAvail(sl.id)) gone++; }
            // Counted from what the server confirmed, like every other write on
            // this screen: `removeSlot` resolves true only when the row is
            // actually gone, and a coach told "removed" over slots still on the
            // server is bookable at an hour they think they closed.
            if (gone < mine.length) {
              Alert.alert(
                'Some are still there',
                `${gone} of ${mine.length} were removed. The rest are still on your week and still generating open slots — try again when you have a connection.`,
                [{ text: 'OK' }],
              );
            }
          },
        },
      ],
    );
  };

  const addRange = async () => {
    if (rangeRefusal || avBusy) return;
    const { fresh, duplicates } = rangeSplit;
    if (fresh.length === 0) {
      Alert.alert('Nothing to add', addOutcome(0, 0, duplicates), [{ text: 'OK' }]);
      return;
    }
    setAvBusy(true);
    // Sequential rather than Promise.all: these hit one unique index on one
    // table and the hook keeps its list in React state, so firing forty-eight
    // at once races its own duplicate check.
    let saved = 0;
    for (const sl of fresh) {
      const res = await addAvail(sl.dow, sl.hour, sl.minute, sl.dur);
      if (res === 'saved') saved++;
    }
    setAvBusy(false);
    Alert.alert(saved ? 'Weekly hours added' : 'Not added', addOutcome(saved, fresh.length, duplicates), [{ text: 'OK' }]);
  };

  const addWeekly = async () => {
    const when = `${DOW[avDow]} ${avTime(avHour, avMinute)}`;
    const res = await addAvail(avDow, avHour, avMinute, 60);
    if (res === 'saved') return;
    if (res === 'duplicate') {
      Alert.alert('Already on your week', `You already offer ${when} every week, so nothing was added.`, [{ text: 'OK' }]);
      return;
    }
    // "Remove and re-add it" is the right advice for a slot the server never
    // saw, and exactly the wrong advice for one it already has. When the week
    // could not be read, `addSlot`'s duplicate check ran against an empty local
    // list, so a time the coach genuinely already offers sails past it and is
    // refused by the unique index instead — reported here as 'local'. Telling
    // them to remove it would delete a slot their clients can book.
    if (!availKnown) {
      Alert.alert(
        'Not added',
        `${when} was not added, and this may be because you already offer it — your weekly times could not be read, so Repple could not check first.\n\nNothing has been lost and nothing on your week has changed. Try again once you are connected, and do not remove anything on the strength of this.`,
        [{ text: 'OK' }],
      );
      return;
    }
    Alert.alert(
      'Saved on this phone only',
      `${when} is in your weekly list here, but it did not reach the server — so it is not on your other devices, and generating open slots from it may not work.\n\nIt has not been lost. Check your connection and remove and re-add it once you are back online.`,
      [{ text: 'OK' }],
    );
  };

  /** Who a standing appointment is with. `my_session_series` hands the coach the
   *  client's profile name; the roster is the fallback for a client whose
   *  profile carries no name, so a row never renders a blank where a person is. */
  const seriesWho = (s: RecurringSeries) =>
    s.clientName ?? roster.find((c) => c.id === s.clientId)?.name ?? 'this client';

  /**
   * The concrete session that the next occurrence IS.
   *
   * A series row knows WHEN the next one starts; cancelling it needs the
   * session row itself, because an occurrence is an ordinary booked session and
   * goes through the ordinary button. Matched on the instant and the client
   * rather than guessed at, and null is a real answer this screen handles: the
   * calendar may not have been read, or the occurrence may have been cancelled
   * already. The sheet then offers the option without an action and says which
   * of those it is, rather than wiring a destructive button to a hope.
   */
  const nextOccurrenceOf = (s: RecurringSeries): TrainingSession | null => {
    if (!s.nextAt) return null;
    const at = Date.parse(s.nextAt);
    if (!Number.isFinite(at)) return null;
    return sessions.find((x) => x.status === 'booked' && x.clientId === s.clientId
      && Date.parse(x.startsAt) === at) ?? null;
  };

  /**
   * Agree a standing appointment.
   *
   * Everything the server did is reported, INCLUDING the dates that did not
   * take. A clash is not a failure — part 135 skips that one date, keeps the
   * arrangement and creates every other date — but the skipped dates are the
   * coach's to place by hand, so a report that said only "8 sessions booked"
   * would be hiding the two hours a client is expecting and will not get.
   */
  const createSeriesNow = async () => {
    if (!srClient) return;
    const who = nameOf(srClient);
    const when = seriesLabel({ dow: srDow, hour: srHour, minute: srMinute });
    // The same client at the same time twice is not refused anywhere: there is
    // no unique index on the arrangement. What a coach would see is a second
    // series whose every date clashed with the first, reported as "8 dates were
    // skipped because you were already booked then" — true, and baffling. Only
    // claimed when the list was actually read; under 'error' we do not know.
    if (seriesStatus === 'ready' && standing.some((s) => s.clientId === srClient
      && s.dow === srDow && s.hour === srHour && s.minute === srMinute)) {
      Alert.alert(
        'Already standing',
        `${who} already has ${when.charAt(0).toLowerCase()}${when.slice(1)} with you, so nothing was changed.`,
        [{ text: 'OK' }],
      );
      return;
    }
    setSrBusy(true);
    const res = await createSeries({
      clientId: srClient, dow: srDow, hour: srHour, minute: srMinute, durationMin: srDur,
    });
    setSrBusy(false);
    if (!res.ok) {
      Alert.alert(
        'Not set up',
        `${when} with ${who} was not created, so nothing has changed and ${who} has not been booked.\n\n${res.error}`,
        [{ text: 'OK' }],
      );
      return;
    }
    setSeriesOpen(false);
    // The occurrences were written on the server inside that same call, so the
    // calendar this screen is holding is a read that predates every one of
    // them. Without this the coach is told eight sessions are booked and can
    // see none of them on the grid they are looking at.
    await refresh();
    const rep = res.report;
    const made = createdLine(rep.created);
    const skipped = clashLine(rep.skipped, rep.clashedOn);
    const lines = [`${when} with ${who} is standing. Neither of you has to book it again.`];
    // `createdLine` returns null rather than "0 sessions booked", so the case
    // where nothing took gets a sentence of its own instead of an announcement
    // of a success that did not happen.
    lines.push(made ?? 'No sessions were booked just now. The arrangement itself is saved.');
    if (skipped) {
      lines.push(skipped);
      // Deliberately not "we will try those again". Nothing does.
      lines.push('Those dates are yours to place by hand if you want them.');
    }
    Alert.alert(
      rep.created ? 'Standing appointment set' : 'Saved, but nothing was booked',
      lines.join('\n\n'),
      [{ text: 'Done' }],
    );
  };

  /**
   * End the arrangement. THIS IS NOT A CANCELLATION AND IT CHARGES NOTHING.
   *
   * The obvious implementation of "stop this repeating" is a loop over the
   * future occurrences calling the ordinary cancellation, and on a year-long
   * arrangement that bills somebody a late-cancellation fee for every session
   * in the horizon — for a decision taken two months in advance.
   * `end_session_series` does not go near `cancel_my_session`, and `charged`
   * comes back from the server stated as false, so the alert below reports what
   * the server did rather than what this screen believes it did.
   *
   * `p_effective` is the date of the NEXT OCCURRENCE, not today. That argument
   * is the whole of the second half of the promise: called with its default,
   * `end_session_series` removes every occurrence after today, next Tuesday
   * included — the one session the sheet has just told the coach will stay
   * booked. Part 143 moved that default into the function itself.
   */
  const endSeriesNow = async (s: RecurringSeries) => {
    const who = seriesWho(s);
    // No date is passed. This screen used to compute the next occurrence's own
    // date and send it, because `end_session_series` defaulted `p_effective` to
    // TODAY and deleted everything after it — next Tuesday included, the one
    // session the sheet has just promised will stay booked.
    //
    // Part 143 moved that default into the function, where it belongs: a
    // function that documents a promise and relies on every caller to supply it
    // is describing the promise rather than keeping it, and this one is
    // reachable from the client app, the SQL editor and whatever is written
    // next. Computing it here as well is now not merely redundant but a
    // liability: the client-side version fell back to the READER's date when
    // their device's Intl did not know the series' zone, so a coach abroad by
    // one calendar day would delete the session that was meant to survive, or
    // leave one extra standing. The server knows the zone without asking.
    setEndBusy(true);
    const res = await endSeries(s.id);
    setEndBusy(false);
    if (!res.ok) {
      Alert.alert(
        'Still standing',
        `${seriesLabel(s)} with ${who} is still running — that did not save, so nothing has changed, no session has been removed and ${who} has not been told.\n\n${res.error}`,
        [{ text: 'OK' }],
      );
      return;
    }
    setEndFor(null);
    // The later occurrences were deleted server-side; this screen is still
    // drawing them on the grid until it re-reads.
    await refresh();
    const r = res.report;
    Alert.alert(
      'Standing appointment ended',
      `${seriesLabel(s)} with ${who} will not repeat again.\n\n`
      + (r.removed
        ? `${r.removed} later session${r.removed === 1 ? '' : 's'} ${r.removed === 1 ? 'was' : 'were'} removed from your calendar and theirs.`
        : 'There were no later sessions on the books, so nothing was removed.')
      + '\n\n'
      // Read from the server rather than asserted here. This branch can only be
      // reached by a server that broke its own promise, and it is said out loud
      // rather than swallowed: a fee that appeared without anybody deciding to
      // charge one is the coach's to find, not ours to hide.
      + (r.charged
        ? `The server reported a charge against this, which it should never do — check Late-Cancellation Fees below before you settle anything with ${who}.`
        : 'Nothing was charged for any of them, however close they were.')
      + (s.nextAt
        ? `\n\nThe next one — ${dateLabel(s.nextAt)} at ${timeLabel(s.nextAt)} — is still booked, on purpose. If that one has to go as well, cancel it on its own from that day and your notice policy prices that session alone.`
        : ''),
      [{ text: 'Done' }],
    );
  };

  const booked = sessions.filter((s) => s.status === 'booked');
  const open = sessions.filter((s) => s.status === 'available');

  const byDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    const k = dayKey(s.startsAt);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s);
  }

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const selDaySessions = (byDay.get(selKey) ?? []).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const [selY, selM, selD] = selKey.split('-').map(Number);
  const selDate = new Date(selY, selM, selD);
  /**
   * The selected day as a padded local `YYYY-MM-DD`.
   *
   * `selKey` is the GRID's key and is `${year}-${monthIndex}-${day}` with no
   * padding — a different string that looks like this one. Passing it to
   * anything that parses a date gives either nothing or a day in the wrong
   * month, and both look like a broken screen rather than like a bug. It was
   * written out by hand in four places; it is built once here so the fifth
   * cannot come out differently.
   */
  const selDay = `${selY}-${String(selM + 1).padStart(2, '0')}-${String(selD).padStart(2, '0')}`;

  /* ── the classes this screen was already reading and never drawing ──────
   *
   * `gymClasses` came in for `classClashes`, which stops Generate Open Slots
   * putting a bookable PT hour on top of a class the coach is running. It was
   * never drawn, so the day sheet — built from `byDay`, which holds sessions
   * and nothing else — showed a coach with a 6pm class an empty Thursday. The
   * screen would then refuse to generate a slot at six, silently, off the same
   * list. The check existed; what it was checking against was invisible.
   *
   * The coach's own classes and the ones with NO coach against them, which is
   * the split `classClashes` already makes: a colleague's class is their
   * business, and an unattributed one is the one nothing can rule in or out.
   * See src/lib/dayClasses.ts.
   */
  const selDayClasses = classesOnDay(gymClasses, selDate, coachId);
  const classCaveat = classDayCaveat(classStatus);

  /* ── what is NOT on this day ────────────────────────────────────────────
   *
   * Everything above draws rows that exist. The two findings below are
   * absences, which is why neither of them has ever appeared on this screen:
   *
   *   · an hour with nothing in it that NO CLIENT CAN BOOK. Not "a free hour"
   *     — a coach knows where those are. In this product a client books a
   *     `sessions` row with `status = 'available'`, so a free hour with no such
   *     row across it is unreachable however free the coach is, and part 731
   *     made that a routine state rather than an exotic one.
   *   · a client who had an appointment and has none.
   *
   * Both are computed from what this screen already holds and neither adds a
   * read. `useNow()` rather than a mounted clock: this is a tab, it stays
   * mounted for days, and a frozen `Date.now()` would report this morning's
   * holes all afternoon.
   */
  const selDayWork = workWindows(availSlots, selDate.getDay());
  /** Everything of this coach's that occupies time. The three obstacles the
   *  server itself checks — `answer_session_request`, supabase/parts/740 — in
   *  the same order and with the same exclusions. `selDayClasses` has already
   *  dropped cancelled classes and colleagues' ones. */
  const selDayBlockers: MoveBlocker[] = [
    ...sessions
      .filter((s) => s.status === 'booked' || s.status === 'blocked')
      .map((s): MoveBlocker => ({
        id: s.id, startsAt: s.startsAt, durationMin: s.durationMin,
        kind: s.status === 'blocked' ? 'blocked' : 'booked',
      })),
    ...selDayClasses.map((c): MoveBlocker => ({
      id: null, startsAt: c.startsAt, durationMin: c.durationMin, kind: 'class',
    })),
  ];
  const openSlots = sessions.filter((s) => s.status === 'available');
  /** Whether the selected day still has any of itself left. A day that is over
   *  has no sellable time in it by definition, and a section reporting what a
   *  coach could have sold last Tuesday is a reproach rather than a tool. */
  const selDayAhead = new Date(selY, selM, selD + 1).getTime() > now.getTime();
  const gapsKnown = gapsAreKnown(sessionsStatus, classStatus, availStatus);
  const selDayGaps = gapsKnown && selDayAhead
    ? sellableGaps(dayGaps({
      year: selY, monthIndex: selM, day: selD,
      work: selDayWork, blockers: selDayBlockers, open: openSlots, nowMs: now.getTime(),
    }))
    : [];
  const gapsNote = selDayAhead ? gapsUnknownNote(sessionsStatus, classStatus, availStatus) : null;

  /* Who had an appointment and has none. 'partial' is admitted here on
   * purpose and src/lib/rebooking.ts holds the argument: the sessions read is
   * newest-first, so the cut is at the OLD end and nothing BOOKED AHEAD can be
   * missing from it. What a truncated read costs is rows that should be on the
   * list, and `rebookCoverageNote` says so rather than letting a short list
   * read as a clean book. */
  const quiet = rebookingListable(sessionsStatus) ? unrebooked(sessions, now.getTime()) : [];

  // Time the coach is NOT available. The database withdraws the open slots
  // inside the period as it writes the block, because an offer left standing
  // that the server will then refuse is the app advertising something it will
  // not honour. A session already booked in there is never quietly removed —
  // somebody arranged to be there, so this refuses and the coach cancels it
  // themselves, which tells the client.
  const doBlock = async () => {
    const mins = blkAllDay ? 24 * 60 : (blkTo - blkFrom) * 60;
    if (mins <= 0) {
      Alert.alert('Pick an end after the start', 'The finish time needs to be later than the start time.');
      return;
    }

    // Every day the plan covers, as a local `YYYY-MM-DD`. `selKey` is already
    // one — the grid builds it — and it is used rather than rebuilt, so this
    // cannot drift from the day the coach tapped.
    //
    // Built by `blockDates` rather than inline, because a range built by adding
    // 86,400,000ms lands an hour out across a daylight-saving change: one day of
    // a fortnight's holiday silently missing and another blocked twice. See
    // src/lib/blockRange.ts, which is run under three time zones.
    const dayList = blockDates({ from: selDay, days: blkDays, repeatWeeks: blkWeeks });
    if (dayList.length === 0) {
      Alert.alert('Nothing to block', 'That range does not cover any days. Pick a length between one day and two months.');
      return;
    }

    setBlkBusy(true);
    const results: BlockResult[] = [];
    for (const day of dayList) results.push(await blockOneDay(day, mins));
    setBlkBusy(false);

    // ONE alert for the whole run, naming each kind of outcome. A fortnight
    // produces a mixture, and the two sentences a coach must never be shown are
    // "blocked" while four days are still bookable and "not blocked" while ten
    // were. Both describe a diary that is not the diary — and a coach skimming
    // an alert takes the SHAPE of it, so the title changes too.
    const summary = summariseBlocks(results);
    setBlockOpen(false);
    await refresh();
    reportBlock(summary, mins);
  };

  /**
   * Ask the server to block one local day, and read its answer honestly.
   *
   * Extracted so the "cancel those and block" path below runs the SAME call on
   * the same days rather than a second copy of it that could drift.
   */
  const blockOneDay = async (day: string, mins: number): Promise<BlockResult> => {
    const [dy, dm, dd] = day.split('-').map(Number);
    const dayStart = new Date(dy, dm - 1, dd);
    dayStart.setHours(blkAllDay ? 0 : blkFrom, 0, 0, 0);
    let outcome: BlockOutcome = 'failed';
    let withdrawn = 0;
    try {
      const { data, error } = await supabase.rpc('block_time', { p_starts_at: dayStart.toISOString(), p_duration_min: mins });
      const row = Array.isArray(data) ? data[0] : data;
      // The server's three answers, kept apart. Only 'failed' means the day
      // may still be bookable and the coach should try again; the other two
      // are the server declining for a reason, and reporting either as a
      // failure would send somebody back to press the same button forever —
      // which is the exact loop part 113 was written to end, when extending a
      // block raised a raw exclusion_violation and the coach was told their
      // time was NOT blocked by the block that was stopping every booking.
      if (error) outcome = 'failed';
      else if (row?.ok) { outcome = 'blocked'; withdrawn = Number(row.withdrawn) || 0; }
      else if (row?.reason === 'booked') outcome = 'booked';
      else if (row?.reason === 'already-blocked') outcome = 'already-blocked';
      else outcome = 'failed';
    } catch { outcome = 'failed'; }
    return { day, outcome, withdrawn };
  };

  /**
   * The result of a block, and the way out of the one outcome that used to be a
   * dead end.
   *
   * `blockSummaryLine` names the days that refused and says "Cancel those
   * yourself — that tells the client — and then block the day." The alert then
   * offered a single Done. A fortnight away with four standing clients meant
   * leaving the sheet, finding four separate days in the grid and repeating a
   * flow this alert could drive from the list it had just printed — and any day
   * the coach gave up on stayed bookable while they were abroad.
   *
   * The second button is only drawn when there is actually something to cancel
   * ON THIS SCREEN'S OWN READ. Under 'error' the diary is unknown and an empty
   * clash list would be the app claiming the days are clear; the coach is left
   * with the sentence they had, which is true.
   */
  const reportBlock = (summary: BlockSummary, mins: number) => {
    const clashes = known ? sessionsBlocking(summary.booked, sessions) : [];
    const title = summary.blocked === 0 ? 'Nothing blocked' : summary.needsAttention ? 'Partly blocked' : 'Time blocked';
    if (clashes.length === 0) {
      Alert.alert(title, blockSummaryLine(summary), [{ text: 'Done' }]);
      return;
    }
    Alert.alert(title, blockSummaryLine(summary), [
      { text: 'Leave Them', style: 'cancel' },
      {
        text: cancelAndBlockLabel(clashes.length),
        onPress: () => { void confirmCancelAndBlock(clashes, summary.booked, mins); },
      },
    ]);
  };

  /** The second confirm, because the first was about blocking and this cancels
   *  somebody's appointment. Every consequence is stated before it happens. */
  const confirmCancelAndBlock = async (clashes: TrainingSession[], days: string[], mins: number) => {
    const who = clashes.map((c) => `${nameOf(c.clientId)} ${timeLabel(c.startsAt)}`);
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert('Cancel these sessions?', cancelAndBlockBody(clashes.length, who), [
        { text: 'Keep Them', style: 'cancel', onPress: () => resolve(false) },
        { text: cancelAndBlockLabel(clashes.length), style: 'destructive', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;

    setBlkBusy(true);
    // Cancelled one at a time and COUNTED, because a release that the server
    // refused leaves that client booked and that day unblockable — and telling
    // a coach their holiday is clear when one client is still coming is the
    // failure this whole flow exists to avoid.
    let cancelled = 0;
    const stillBooked: string[] = [];
    for (const c of clashes) {
      const r = await cancelOne(c);
      if (r.freed) cancelled++;
      else stillBooked.push(`${nameOf(c.clientId)} ${timeLabel(c.startsAt)}`);
    }
    // Only now, and only the days that refused before. A day that blocked
    // cleanly the first time is left alone rather than asked twice.
    const results: BlockResult[] = [];
    for (const day of days) results.push(await blockOneDay(day, mins));
    setBlkBusy(false);
    await refresh();

    const summary = summariseBlocks(results);
    const head = cancelled === 0
      ? 'No session was cancelled.'
      : `${cancelled} session${cancelled === 1 ? ' was' : 's were'} cancelled and ${cancelled === 1 ? 'that client was' : 'those clients were'} told.`;
    const tail = stillBooked.length
      ? ` ${stillBooked.length} did not save, so ${stillBooked.length === 1 ? 'that client is' : 'those clients are'} still booked: ${stillBooked.slice(0, 4).join(', ')}${stillBooked.length > 4 ? '…' : ''}.`
      : '';
    Alert.alert(
      summary.blocked === 0 ? 'Nothing blocked' : summary.needsAttention ? 'Partly blocked' : 'Time blocked',
      `${head}${tail} ${blockSummaryLine(summary)}`,
      [{ text: 'Done' }],
    );
  };

  /* ── Blocking from the phone's own calendar ────────────────────────────
   *
   * The half of S6 that is not `doBlock`: instead of the coach remembering
   * every absence and typing it in, the phone is asked when they are busy and
   * they tick the ones that should stop clients booking.
   *
   * Four rules hold this together, and each of them is somewhere a well-meant
   * shortcut would do real harm:
   *
   *   READ ONLY.  Nothing here writes to anybody's calendar — no event is
   *   created, changed or deleted. The app takes a copy of when the coach is
   *   busy and does its own blocking through `block_time`, which is the same
   *   call the manual sheet above makes.
   *
   *   TIMES ONLY.  A coach's diary holds their medical appointments and other
   *   people's names and addresses. `toBusySpan` in src/lib/deviceBusy.ts is
   *   the only thing in this app that touches a calendar entry and it reads a
   *   start and an end. Nothing on this screen has a title to draw because
   *   nothing in the app ever held one.
   *
   *   NOTHING REACHES A CLIENT.  What comes out of all this is a block, which
   *   is an ABSENCE on the coach's availability. It carries no reason and
   *   nothing derived from the calendar, so there is nothing to leak.
   *
   *   THE COACH CHOOSES.  Never bulk-block what was found. `busyPicked` starts
   *   empty and the button is disabled until something is in it.
   */
  /* ── and the same question asked of a calendar that is not on the phone ──
   *
   * S3 adds a second source and exactly one new way to be wrong, which is the
   * way this whole feature exists to prevent: the phone answers, Google fails,
   * the merged list is short, and a sheet built on `length === 0` tells a coach
   * their fortnight is clear. `combineBusy` is what makes that unsayable — a
   * source that did not answer is never counted as one that found nothing.
   *
   * The two reads run TOGETHER rather than one after the other. A Google round
   * trip on a gym's wifi is seconds, and a coach watching a sheet is not going
   * to wait through two of them in series.
   *
   * They are merged on SPANS and not on rows. A dentist appointment that is on
   * the phone and on the synced account is one absence; merged after the fact
   * it would be two rows, two `block_time` calls, and an 'already-blocked'
   * refusal on the second that reads to a coach as a failure.
   */
  const loadBusy = async (days: number) => {
    setBusyAsked(true);
    setBusyRead({ status: 'loading', permission: 'unknown', candidates: [], spans: [] });
    setRemoteRead({ status: 'loading', spans: [] });
    setBusyCands([]);
    setBusyPicked([]);
    const win = busyWindow(selDay, days);
    // Neither read ever throws — every failure comes back as a status the sheet
    // puts into words. An empty list that cannot say WHY it is empty is the
    // defect this feature would otherwise introduce, on a screen whose whole
    // job is to stop a double booking.
    const [device, remote] = await Promise.all([
      readDeviceBusy(selDay, days),
      syncLink.connected && win
        ? readRemoteBusy(win.fromMs, win.toMs)
        : Promise.resolve<RemoteBusyRead>({ status: 'ready', spans: [] }),
    ]);
    setBusyRead(device);
    setRemoteRead(remote);
    setBusyCands(busyCandidates([...device.spans, ...remote.spans], selDay, days));
  };

  /** The sources in play, and what each of them did. `active` is false for a
   *  source that was never asked — no native calendar in this binary, or no
   *  Google account linked — which is a different thing from one that failed
   *  and must never be counted as one that answered. */
  const busySources: BusySourceState[] = [
    { kind: 'device', active: HAS_NATIVE_CALENDAR, status: busyRead.status, permission: busyRead.permission },
    { kind: 'google', active: syncLink.connected, status: remoteRead.status },
  ];
  /** Whether there is anything to read at all. Not `HAS_NATIVE_CALENDAR`: a
   *  coach on a build made before expo-calendar landed can still link a Google
   *  account, because that half is JavaScript and reaches them over the air. */
  const busyCanRead = HAS_NATIVE_CALENDAR || syncLink.connected;

  const openBusySheet = () => {
    setBusyAsked(false);
    setBusyRead({ status: 'loading', permission: 'unknown', candidates: [], spans: [] });
    setRemoteRead({ status: 'ready', spans: [] });
    setBusyCands([]);
    setBusyPicked([]);
    setBusyOpen(true);
  };

  /* ── the link, and the direction that writes ────────────────────────────
   *
   * Everything below goes through src/ui/calendarSync.ts, which holds no token
   * and never sees one: the code Google hands back is passed straight to the
   * `calendar-sync` edge function, which does the exchange with the client
   * secret and stores the refresh token in a table with no select policy
   * (supabase/parts/360). Nothing token-shaped is ever on this handset.
   */
  const refreshLink = useCallback(async () => {
    if (!CALENDAR_SYNC_CONFIGURED) { setSyncStatus('ready'); return; }
    const res = await readCalendarLink();
    setSyncStatus(res.status);
    // Under 'error' the previous answer is kept rather than replaced with the
    // disconnected default: "we could not ask" must not render as "you have
    // not connected", which would offer a Connect button to somebody who is.
    if (res.status !== 'error') setSyncLink(res.link);
  }, []);

  const doConnectCalendar = async () => {
    setSyncBusy(true);
    try {
      await connectGoogleCalendar(false);
      await refreshLink();
    } catch (e) {
      Alert.alert('Not connected', e instanceof Error ? e.message : 'Google could not be connected.');
    }
    setSyncBusy(false);
  };

  const doDisconnectCalendar = () => {
    Alert.alert(
      'Disconnect Google Calendar?',
      'Repple stops reading when you are busy, and the calendar it made in your Google account is deleted along with every session it put there. Nothing you put in your own calendar is touched, and nothing in Repple changes.',
      [
        { text: 'Keep It' },
        {
          text: 'Disconnect', style: 'destructive', onPress: () => {
            void (async () => {
              setSyncBusy(true);
              try {
                await disconnectGoogleCalendar();
                setSyncLink(NO_CALENDAR_LINK);
                setRemoteRead({ status: 'ready', spans: [] });
              } catch (e) {
                Alert.alert('Still connected', e instanceof Error ? e.message : 'The connection could not be removed.');
              }
              setSyncBusy(false);
              await refreshLink();
            })();
          },
        },
      ],
    );
  };

  /**
   * Turn writing on or off.
   *
   * Turning it ON runs a second Google consent, because the scope that lets
   * Repple make a calendar is not the scope that lets it read free time and
   * asking for both at sign-in would be requesting the power to write to
   * somebody's diary in order to read it. The coach sees Google's own screen
   * naming the new permission at the moment they ask for it.
   */
  const doSetWrite = async (enabled: boolean) => {
    setSyncBusy(true);
    try {
      await setCalendarWrite(enabled, BRAND.label);
      pushAgainSoon();
      await refreshLink();
    } catch (e) {
      Alert.alert(enabled ? 'Not writing yet' : 'Still writing', e instanceof Error ? e.message : 'That could not be changed.');
    }
    setSyncBusy(false);
  };

  /** The sessions Repple would put in the coach's Google calendar: the booked
   *  ones in the four weeks around today, and nothing else. An open slot is an
   *  offer rather than a commitment, and a blocked period is Repple telling the
   *  coach's calendar what the coach's calendar told Repple. */
  const pushWindow = () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    to.setDate(to.getDate() + PUSH_DAYS);
    return { fromMs: from.getTime(), toMs: to.getTime() };
  };
  /**
   * What this coach's Google calendar should contain.
   *
   * The fourth argument is the classes they TEACH, and it was missing from both
   * call sites since `plannedSyncEvents` grew it. `calendarSync.ts` had the
   * whole thing — `SyncTeaching`, `syncClassEventId` with its namespacing so a
   * class can never overwrite a one-to-one, the cancelled-class filter, the
   * not-mine filter — and it was asserted in its own suite. It was simply never
   * passed anything, so a coach's exported calendar showed their one-to-ones
   * and left every hour they were in front of a class looking free.
   *
   * `uid` is the coach's own id: a class attributed to nobody is not silently
   * claimed as theirs, which is the same rule `classClashes` follows above.
   */
  const teachingForSync = (): SyncTeaching => ({ classes: gymClasses, uid: coachId ?? null });
  const plannedEvents = () => {
    const w = pushWindow();
    return plannedSyncEvents(sessions, w.fromMs, w.toMs, teachingForSync());
  };

  /**
   * Send the booked sessions.
   *
   * `isWhole(sessionsStatus)` is the guard that matters and it guards against
   * DELETION. A push is a reconciliation: anything in Repple's calendar that is
   * not in the list sent is removed, because that is how a cancellation reaches
   * Google at all. Under 'error' the session list is empty for want of a read
   * rather than for want of bookings, and under 'partial' it is a truncated
   * fraction of the set (src/ui/loadStatus.ts) — so pushing either one would
   * quietly clear a coach's whole week out of their Google calendar while every
   * session was still in Repple, and the calendar would then be exactly as
   * wrong as it can be: confidently empty.
   *
   * The same sentence the generate-slots path already refuses to say, on the
   * other side of the wire.
   */
  const doPush = async (announce: boolean) => {
    if (!isWhole(sessionsStatus)) {
      if (announce) {
        Alert.alert(
          'Can’t send yet',
          'Your Repple calendar could not be read in full, so Repple does not know what you have booked — and sending now would remove sessions from Google that are still here.\n\nNothing has been changed. Pull down to refresh and try again.',
          [{ text: 'OK' }],
        );
      }
      return;
    }
    const w = pushWindow();
    const events = plannedSyncEvents(sessions, w.fromMs, w.toMs, teachingForSync());
    setPushBusy(true);
    const out = await pushSessions(events, w.fromMs, w.toMs);
    setPushBusy(false);
    if (!announce) return;
    if (!out.ok) Alert.alert('Not sent', out.reason);
    else {
      // A timetable that could not be read means the classes are missing from
      // what was just sent, and the coach has no way to tell from a count of
      // events. Said here rather than swallowed: somebody reading their
      // calendar will see those hours as free.
      const caveat = syncClassesNote(classesKnown);
      Alert.alert('Sent to Google', [pushSummaryLine(out.result), caveat].filter(Boolean).join('\n\n'));
    }
  };

  // The link is read on every visit to this tab, not once on mount. A coach who
  // revoked Repple's access in their Google account this morning must not open
  // this screen to a row that says Connected.
  useFocusEffect(useCallback(() => { void refreshLink(); }, [refreshLink]));

  /**
   * The push nobody has to remember.
   *
   * A sync a coach has to press is a sync that goes stale, and a stale sync on
   * this feature is the double booking the whole item exists to prevent. So
   * when writing is on and the session list is WHOLE, the sessions go across on
   * their own — at most once every fifteen minutes (`pushIsDue` holds that
   * floor at module scope, so navigating away and back does not restart it).
   *
   * Silent on purpose: `announce` is false, so a coach who is doing something
   * else is not interrupted by an alert about a background reconciliation. The
   * button in the sheet is the same call with `announce` true, for when they
   * want to watch it happen.
   */
  useEffect(() => {
    if (!syncLink.connected || !syncLink.writeEnabled || !syncLink.hasWriteCalendar) return;
    if (!isWhole(sessionsStatus)) return;
    if (!pushIsDue()) return;
    void doPush(false);
    // `sessions` rather than a length: a session moved to another hour changes
    // nothing about how many there are, and the whole point of writing is that
    // the time in Google is the time in Repple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, sessionsStatus, syncLink.connected, syncLink.writeEnabled, syncLink.hasWriteCalendar]);

  const toggleBusyPick = (key: string) =>
    setBusyPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const doBlockFromCalendar = async () => {
    const picked = busyCands.filter((c) => busyPicked.includes(c.key));
    if (picked.length === 0) return;

    setBusyBusy(true);
    const results: BlockResult[] = [];
    for (const c of picked) {
      // Local, from the parts. `new Date('2026-09-08')` is UTC midnight and
      // reads back as the 7th west of Greenwich — see src/lib/localDate.ts,
      // which exists because this repo has shipped that bug twice.
      const [dy, dm, dd] = c.day.split('-').map(Number);
      const startsAt = new Date(dy, dm - 1, dd);
      startsAt.setHours(Math.floor(c.startMin / 60), c.startMin % 60, 0, 0);
      let outcome: BlockOutcome = 'failed';
      let withdrawn = 0;
      try {
        const { data, error } = await supabase.rpc('block_time', {
          p_starts_at: startsAt.toISOString(), p_duration_min: candidateMinutes(c),
        });
        const row = Array.isArray(data) ? data[0] : data;
        // The same three answers `doBlock` reads, kept apart for the same
        // reason: only 'failed' means the time may still be bookable.
        if (error) outcome = 'failed';
        else if (row?.ok) { outcome = 'blocked'; withdrawn = Number(row.withdrawn) || 0; }
        else if (row?.reason === 'booked') outcome = 'booked';
        else if (row?.reason === 'already-blocked') outcome = 'already-blocked';
        else outcome = 'failed';
      } catch { outcome = 'failed'; }
      results.push({ day: c.day, outcome, withdrawn });
    }
    setBusyBusy(false);

    // `foldByDay` first. A coach can pick two periods on one Tuesday, and
    // `summariseBlocks` counts DAYS — unfolded, "2 days blocked" would be a
    // sentence about a week with one day in it. The fold is deliberately
    // pessimistic: a day where one period saved and one did not is reported as
    // still bookable, which is true of the part that did not save.
    const summary = summariseBlocks(foldByDay(results));
    setBusyOpen(false);
    await refresh();
    Alert.alert(
      summary.blocked === 0 ? 'Nothing blocked' : summary.needsAttention ? 'Partly blocked' : 'Time blocked',
      blockSummaryLine(summary),
      [{ text: 'Done' }],
    );
  };

  function shiftMonth(delta: number) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  }

  /* ── how far back this grid can honestly draw ─────────────────────────────
   *
   * The arrows go back without limit and the grid is drawn from ONE read: the
   * provider's, newest-first and stopped at the row cap (src/lib/rowCap.ts). A
   * coach with a long diary could therefore page back to March, see nothing
   * under any date, and read it as a month they did not work — when the read
   * stopped in June and March was never asked for. Under 'error' the grid is
   * empty for a third reason again, and the banner at the top of this screen
   * speaks about the counts rather than about the month being looked at.
   *
   * Only for a month that has already been: the boundary of a newest-first read
   * is always behind the reader. And only when the read was actually short —
   * `monthCoverageNote` returns null for a whole read, so a coach whose diary
   * fits inside one read is told nothing.
   */
  const monthEdge = readBoundary(sessions, sessionsStatus === 'partial');
  /* The same boundary, asked a different question: does the read reach back
   * over the four weeks "has not rebooked" is a claim about? A short list under
   * a read that stopped last week is not a clean book, and this is the sentence
   * that stops it being read as one. */
  const quietCoverage = rebookingListable(sessionsStatus)
    ? rebookCoverageNote(monthEdge, sessionsStatus, now.getTime(), dateLabel)
    : null;
  const viewingPastMonth = viewYear < now.getFullYear()
    || (viewYear === now.getFullYear() && viewMonth < now.getMonth());
  const monthNote = viewingPastMonth
    ? monthCoverageNote(
      monthCoverage(viewYear, viewMonth, monthEdge, sessionsStatus),
      monthEdge,
      (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
      },
    )
    : null;

  async function handleAdd() {
    const d = new Date(selY, selM, selD); d.setHours(addHour, addMinute, 0, 0);
    const s: TrainingSession = {
      id: `ms${SEQ++}`, trainerId: '', clientId: addClient,
      startsAt: d.toISOString(), durationMin: addDur,
      status: addClient ? 'booked' : 'available', released: false,
    };
    // The group timetable, before the sessions list. A class the coach is
    // recorded as teaching is as booked as any one-to-one, and `addSession`
    // cannot see one.
    const clash = classClashes(s.startsAt, s.durationMin, gymClasses, coachId);
    if (clash.mine.length > 0) {
      Alert.alert('You are teaching then',
        `${clash.mine[0].title} runs across ${timeLabel(s.startsAt)} on ${dateOfLabel(selDate)}, and you are the coach on it. Pick another time, or call the class off from the Classes screen first.`,
        [{ text: 'OK' }]);
      return;
    }
    const res = addSession(s);
    if (!res.ok) {
      Alert.alert('Time not available', `You already have a session that overlaps ${timeLabel(s.startsAt)} on ${dateOfLabel(selDate)}. Pick another time.`, [{ text: 'OK' }]);
      return;
    }
    setAddOpen(false);
    // Said after the slot is made rather than instead of making it: neither of
    // these is a reason to refuse, and both are reasons not to let the coach
    // believe the hour was checked when it was not. Carried into whichever
    // alert this path ends on rather than raised as a second one, because two
    // stacked dialogs is how the important half gets dismissed unread.
    const caveat = classCheckCaveat(classesKnown, clash.unattributed.length);
    if (!addClient) {
      if (caveat) Alert.alert('Slot opened', caveat, [{ text: 'OK' }]);
      return;
    }
    const who = nameOf(addClient);
    // Two things had to be true for the old alert to be honest and neither was
    // checked: that the session reached the server (until it does, it is on this
    // phone alone and the client's app knows nothing about it) and that the push
    // was accepted. Both are awaited now, and the alert says what happened.
    const saved = await (res.saved ?? Promise.resolve(false));
    if (!saved) {
      Alert.alert(
        'Not booked',
        `${timeLabel(s.startsAt)} with ${who} was not saved, so it is not on your calendar and ${who} has not been booked.\n\n` +
          'Either the save failed, or somebody booked that time while this screen was open — your diary now allows only one session at a time. Pull down to refresh and check before trying again.',
        [{ text: 'OK' }],
      );
      return;
    }
    const push = await sendPushChecked([addClient], 'Session booked', `Your session on ${DOW[selDate.getDay()]} at ${timeLabel(s.startsAt)} is confirmed.`, { route: '/(client)/calendar' });
    Alert.alert(
      'Session booked',
      `${timeLabel(s.startsAt)} with ${who} is confirmed, and it is now on their calendar in the Repple app.\n\n` +
        (push.ok
          ? `${who} was sent a notification — they will see it if they have notifications on.`
          : `We couldn't send ${who} a notification${push.error ? ` (${push.error})` : ''}, so message them to let them know.`) +
        (caveat ? `\n\n${caveat}` : ''),
      [{ text: 'Great' }],
    );
  }

  /**
   * What became of one cancellation. Every arm the alert needs to describe, and
   * nothing about words: the same act is reported one way when a coach cancels
   * one session from the day sheet and another way when the block sheet cancels
   * four in a row, and only one of those may raise four alerts.
   */
  interface CancelOutcome {
    freed: boolean;
    toldClient: boolean;
    promoted: string | null;
    promotedTold: boolean | null;
    /**
     * The re-offer, as the SERVER answered it — never as a count of the list
     * we handed over. Null when no re-offer was made at all, which is either
     * because somebody was promoted off the waitlist or because the roster is
     * not whole; `rosterWhole` is what separates those two.
     */
    offer: {
      asked: number;
      recorded: number | null;
      inboxKept?: boolean;
      partial?: boolean;
      ok: boolean;
    } | null;
    /** Whether the roster the re-offer decision was taken from is the whole
     *  roster. Under anything else "you have no other clients" is a claim
     *  about a read that did not happen. */
    rosterWhole: boolean;
  }

  /**
   * Free one booked session, tell the client, and hand the hour on.
   *
   * Silent. Extracted from `doCancel` so the block sheet can cancel the
   * sessions standing in the way of a holiday without four dialogs in a row,
   * and so that both paths do the SAME three things in the same order. That
   * order is not arbitrary and the comments below are the reason.
   */
  async function cancelOne(s: TrainingSession): Promise<CancelOutcome> {
    // Whether the book this hour is about to be offered round IS the book.
    // `reoffer()` two hundred lines below refuses outright on anything but a
    // whole read and says why; this path made the same fan-out and asked
    // nothing. Under 'error' the provider hands back `[]`, so the list of
    // people to offer it to was empty and the coach — who has just cancelled
    // on somebody — was told "You have no other clients to offer it to."
    // Under 'partial' the hour went silently to whichever fraction of the
    // roster had loaded, and the clients missing from that read never heard.
    const rosterWhole = isWhole(rosterStatus);
    // Free the slot first, and only say so if the server actually freed it.
    // This was fired and forgotten, and the roster was then pushed "first to
    // book it gets it" about a session that was still booked — so the quickest
    // client to respond was the one turned away.
    const freed = await releaseSession(s.id);
    if (!freed) return { freed: false, toldClient: false, promoted: null, promotedTold: null, offer: null, rosterWhole };

    // The queue, before anybody is broadcast at. A client's own cancellation
    // hands the slot over inside the transaction that frees it; a coach frees
    // theirs with a direct update, so for this path the promotion is an
    // explicit second call — and it has to come BEFORE the re-offer, or the
    // roster is invited to race for an hour that already has an owner.
    const promoted = await promoteWaitlist(s.id);
    await reloadWaits();

    const toldClient = s.clientId
      ? await sendPushChecked([s.clientId], 'Session cancelled', `Your ${timeLabel(s.startsAt)} session on ${DOW[new Date(s.startsAt).getDay()]} was cancelled.`, { route: '/(client)/calendar' })
      : { ok: true };

    // Exactly one of these. Where somebody was waiting, one person is told the
    // slot is theirs; where nobody was, the old broadcast stands.
    let promotedTold: boolean | null = null;
    let offer: CancelOutcome['offer'] = null;
    if (promoted) {
      promotedTold = (await sendPushChecked([promoted], 'The slot you were waiting for is yours', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} freed up and you were next on the list — it is booked for you.`, { route: '/(client)/calendar' })).ok;
    } else if (rosterWhole) {
      const openTo = roster.filter((c) => c.id !== s.clientId).map((c) => c.id);
      if (openTo.length) {
        // What the SERVER did with it, not the size of the list handed over.
        // `sendPushChecked` returns `recorded` — the row count `notify_users`
        // itself reports — plus `inboxKept` (this title is one the inbox
        // deliberately does not keep, so `recorded` is 0 by policy on every
        // re-offer and reading that as "nobody was told" is wrong) and
        // `partial` (send-push could only part-read the handset list, so
        // whatever went out is a floor). All three were discarded here and all
        // three are what `reofferConfirmation` needs to say a true sentence.
        const push = await sendPushChecked(openTo, 'A slot just opened', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is available — first to book it gets it.`, { route: '/(client)/calendar' });
        offer = {
          asked: openTo.length,
          recorded: push.recorded,
          inboxKept: push.inboxKept,
          partial: push.partial,
          ok: push.ok,
        };
      }
    }

    return { freed: true, toldClient: toldClient.ok, promoted, promotedTold, offer, rosterWhole };
  }

  async function doCancel(s: TrainingSession) {
    const r = await cancelOne(s);
    if (!r.freed) {
      Alert.alert(
        'Not cancelled',
        `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} is still booked — that did not save, so nothing has changed and nobody has been told. Try again.`,
        [{ text: 'OK' }],
      );
      return;
    }
    const { toldClient, promoted, promotedTold, offer, rosterWhole } = r;
    const when = `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]}`;
    Alert.alert(
      'Session cancelled',
      `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} was cancelled.\n\n` +
      (toldClient
        ? `${nameOf(s.clientId)} was sent a notification. `
        : `We couldn’t notify ${nameOf(s.clientId)} — tell them yourself, especially if this session is soon. `) +
      (promoted
        ? `The hour went straight to the next client on its waitlist${promotedTold === false ? ', though we couldn’t notify them — tell them yourself.' : ' and they have been told. Nobody had to race for it.'}`
        : `The slot is open again on your calendar. ` +
          (!rosterWhole
            ? 'Your clients could not all be read just now, so it has NOT been offered round — that is a connection problem and not an empty book. Use Offer It Round once the list has loaded.'
            : offer === null
            ? 'You have no other clients to offer it to.'
            : offer.ok
            // The server's own sentence, the same one the Offer It Round
            // control prints, so one hour cannot be described two ways.
            ? reofferConfirmation({ offered: offer.asked, recorded: offer.recorded, inboxKept: offer.inboxKept, partial: offer.partial }, when)
            : `We couldn’t tell your other clients about it, so it is open but nobody has been asked.`)) +
      // Nothing is charged, and this sentence used to say the opposite.
      //
      // It read "Inside 24h — your late-cancel policy would apply", off
      // `cancelSession`, which prices a CLIENT's cancellation from
      // `trainers.session_fee`. Three separate things were wrong with it: the
      // session fee is not the late-cancel fee, `?? 0` printed a zero for a
      // coach who had not set a rate, and — worst of the three — the person
      // cancelling here is the COACH. A client does not owe a fee because
      // their coach called off the session. No policy applies to this path at
      // all, so nothing about money is printed on it.
      (insideNoticeWindow(s.startsAt, lcPolicy.noticeHours)
        ? `\n\nThis was inside your ${noticeLabel(lcPolicy.noticeHours)} notice period, but you cancelled it — so nothing is charged to ${nameOf(s.clientId)}.`
        : ''),
      [{ text: 'Done' }]
    );
  }
  function confirmWaive(c: { id: string; clientId: string; amount: number | null; currency: string | null; waivedAt: string | null }) {
    const sum = c.amount == null ? 'this fee' : feeAmountLine(c.amount, c.currency);
    // src/lib/booking.ts:190 writes the rule down: a value SLOT may print the
    // figure alone, because a column heading carries the doubt; a SENTENCE may
    // not. All three sentences below are prose, and all three printed a bare
    // number — on the one list in the app that says what a client owes.
    const unit = c.amount == null ? '' : unstatedCurrencyCoach(c.currency);
    const who = nameOf(c.clientId);
    if (c.waivedAt) {
      Alert.alert('Reinstate this fee?', `${sum} against ${who} would go back to outstanding.${unit}`, [
        { text: 'Leave waived', style: 'cancel' },
        { text: 'Reinstate', onPress: async () => {
          const ok = await unwaiveFee(c.id);
          if (!ok) Alert.alert('Not reinstated', 'That did not save, so the fee is still waived. Try again.', [{ text: 'OK' }]);
        } },
      ]);
      return;
    }
    Alert.alert('Waive this fee?', `${sum} against ${who} would be marked as forgiven. The record stays — it shows as waived rather than disappearing — and neither of you owes anything on it.${unit}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Waive', onPress: async () => {
        // A zero-row update is a success in PostgREST. `waiveFee` counts the
        // rows it changed, so a coach is never told they forgave a fee that
        // is still standing against their client.
        const ok = await waiveFee(c.id);
        if (!ok) Alert.alert('Not waived', `That did not save, so ${sum} is still outstanding against ${who}. Try again.${unit}`, [{ text: 'OK' }]);
      } },
    ]);
  }

  // The date comes off the SESSION rather than off `selKey`. Every caller used
  // to be a row inside the selected day, where the two are the same string —
  // and then the standing-appointment sheet started cancelling the next
  // occurrence of a series, which is whatever day of the week that series falls
  // on and almost never the day the coach has selected. Read from the selected
  // day it asked "cancel 7am with Ana on Tue 1/9?" about a session next Tuesday
  // the 8th, and a coach who checks the date before confirming would have been
  // checking the wrong one.
  /* ── moving a session, rather than cancelling and rebooking it ──────────
   *
   * The coach's only route was `doCancel`, which frees the hour, hands it to
   * the head of its waitlist and pushes "Session cancelled" at the client — so
   * moving Ana from 7am to 8am gave Ana's 7am away, told her she was cancelled,
   * and left the coach to book her back in by hand against a slot anybody could
   * take in the meantime. supabase/parts/461 does the whole thing in one
   * transaction, carries the pack credit rather than drawing a second one, and
   * hands the freed hour on only once Ana is already in her new one.
   */
  const [moveFrom, setMoveFrom] = useState<TrainingSession | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  /* ── where a session could go ────────────────────────────────────────────
   *
   * This was `sessions.filter((x) => x.status === 'available')` and nothing
   * else, and the sheet's own comment stated the consequence: "Nothing here
   * creates an hour: a move goes into a slot that already exists." A coach
   * whose client asks for 8am was therefore sent to Weekly Availability to
   * publish 8am to the whole roster, come back, and hope nobody took it.
   *
   * Now the sheet offers a DAY and the times on it, and an open slot is one
   * kind of time rather than the only kind. Which of the two server functions
   * runs is a fact about the diary and not a preference: `MoveTime.slotId`
   * non-null is an exact open hour and goes through part 461 unchanged;
   * null goes through part 1830, which creates the booking and frees the old
   * hour in one transaction.
   *
   * The day defaults to the day the session is already on, because "an hour
   * later, same day" is the commonest move there is.
   */
  const [moveDayKey, setMoveDayKey] = useState<string | null>(null);
  const openMove = (s: TrainingSession) => { setMoveDayKey(dayKey(s.startsAt)); setMoveFrom(s); };
  const closeMove = () => { setMoveFrom(null); setMoveDayKey(null); };
  /** The fourteen days the sheet offers, from today. Built from local parts, so
   *  "tomorrow" is tomorrow on the coach's own clock across a clock change. */
  const moveDays = Array.from({ length: 14 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  const moveDay = (() => {
    const key = moveDayKey ?? (moveFrom ? dayKey(moveFrom.startsAt) : null);
    if (!key) return null;
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m, d);
  })();
  const moveWork = moveDay ? workWindows(availSlots, moveDay.getDay()) : [];
  const moveBlockers: MoveBlocker[] = moveDay ? [
    ...sessions
      .filter((s) => s.status === 'booked' || s.status === 'blocked')
      .map((s): MoveBlocker => ({
        id: s.id, startsAt: s.startsAt, durationMin: s.durationMin,
        kind: s.status === 'blocked' ? 'blocked' : 'booked',
      })),
    ...classesOnDay(gymClasses, moveDay, coachId).map((c): MoveBlocker => ({
      id: null, startsAt: c.startsAt, durationMin: c.durationMin, kind: 'class',
    })),
  ] : [];
  const moveOptions = moveFrom && moveDay
    ? moveTimes({
      year: moveDay.getFullYear(), monthIndex: moveDay.getMonth(), day: moveDay.getDate(),
      durationMin: moveFrom.durationMin, movingId: moveFrom.id,
      blockers: moveBlockers, open: openSlots, work: moveWork, nowMs: now.getTime(),
    })
    : [];
  const moveGroups = groupMoveTimes(moveOptions);
  const moveCaveat = moveTimesCaveat(sessionsStatus, classStatus);

  /**
   * The confirm in front of the move.
   *
   * A single tap on a row in the sheet moved somebody's hour and pushed a
   * notification at them, with nothing in between — the one act on this screen
   * that reaches another person's phone and the only one of the three that had
   * no confirm. It now reads like `confirmCancel` beside it, and names both
   * hours so a mis-tap two rows down is caught before the client hears about it.
   *
   * `moveConfirm` in src/lib/reschedule.ts is deliberately NOT used here, and
   * neither are `rescheduleLines` or `rescheduleRefusalLine`. Those are the
   * MEMBER's side of the same act and they say so in every sentence — "with the
   * same coach", "no session comes off your pack", "your coach's calendar" —
   * which is the client's voice read back to the coach. The coach's own
   * vocabulary for this is `coachMoveRefusalLine` and `coachMovedLine`, which
   * `doMove` already speaks. This is one confirm, not a second move path: it
   * ends in the same `doMove`, which ends in the same `rescheduleClientSession`.
   *
   * The two facts it states are the two the whole feature rests on and they are
   * the SERVER's, not this screen's — supabase/parts/461 moves the booking and
   * carries its credit in one transaction, and nothing anywhere on the coach's
   * path prices a move.
   */
  function confirmMove(from: TrainingSession, to: TrainingSession) {
    const who = nameOf(from.clientId);
    const fromLabel = `${dateLabel(from.startsAt)} at ${timeLabel(from.startsAt)}`;
    const toLabel = `${dateLabel(to.startsAt)} at ${timeLabel(to.startsAt)}`;
    Alert.alert(
      'Move this session?',
      `${who} moves from ${fromLabel} to ${toLabel}.\n\n`
      + 'Nothing is charged and no session comes off their pack — it is the same session at a different time. '
      + `${fromLabel} goes back on your calendar, or straight to whoever is first in line for it. `
      + 'They are notified once it has moved.',
      [
        { text: 'Leave it', style: 'cancel' },
        { text: 'Move', onPress: () => { void doMove(from, to); } },
      ],
    );
  }

  async function doMove(from: TrainingSession, to: TrainingSession) {
    if (moveBusy) return;
    const who = nameOf(from.clientId);
    const fromLabel = `${DOW[new Date(from.startsAt).getDay()]} ${timeLabel(from.startsAt)}`;
    const toLabel = `${DOW[new Date(to.startsAt).getDay()]} ${timeLabel(to.startsAt)}`;
    setMoveBusy(true);
    try {
      const r = await rescheduleClientSession(from.id, to.id);
      if (!r.moved) {
        Alert.alert('Not moved', coachMoveRefusalLine(r, who, fromLabel), [{ text: 'OK' }]);
        return;
      }
      closeMove();
      // Told AFTER the server has moved it, and only the one person whose hour
      // changed — the client id comes back from the function rather than from
      // this screen's copy of the row, which the move has just made stale.
      const told = r.clientId
        ? await sendPushChecked([r.clientId], 'Your session has moved',
          `${fromLabel} moved to ${toLabel}. Nothing is charged and your session is still paid for.`,
          { route: '/(client)/calendar' })
        : { ok: false };
      await reloadWaits();
      Alert.alert('Session moved', coachMovedLine(r, who, fromLabel, toLabel, told.ok), [{ text: 'Done' }]);
    } finally { setMoveBusy(false); }
  }

  /**
   * The confirm in front of a move to an hour the coach had not opened.
   *
   * A separate confirm from `confirmMove` and not a flag on it, because the act
   * is different in one way the coach has to be told: it PUTS A NEW HOUR IN THE
   * DIARY. `moveAtConfirmBody` is that sentence and the two money facts beside
   * it, and it lives in src/lib/moveTimes.ts with the rest of this vocabulary
   * rather than being written out here.
   */
  function confirmMoveAt(from: TrainingSession, to: MoveTime) {
    const who = nameOf(from.clientId);
    const fromLabel = `${dateLabel(from.startsAt)} at ${timeLabel(from.startsAt)}`;
    const toLabel = `${dateLabel(to.startsAt)} at ${timeLabel(to.startsAt)}`;
    Alert.alert(
      'Move this session?',
      moveAtConfirmBody(who, fromLabel, toLabel, to.inHours),
      [
        { text: 'Leave it', style: 'cancel' },
        { text: 'Move', onPress: () => { void doMoveAt(from, to); } },
      ],
    );
  }

  /**
   * The move itself, when the destination is a time rather than a row.
   *
   * Two writes reach two different people and they are counted separately, the
   * same way `doMove` counts them: the SERVER's report says whether the session
   * moved, and `sendPushChecked` says whether the client heard. A coach must
   * never read "moved" over one that landed and one that did not, so the push
   * result is carried into the sentence rather than assumed, and the move is
   * announced only on the server's own `moved`.
   *
   * `refresh()` is called here and not by a provider: this path goes straight
   * to the RPC (src/ui/coachMoveAt.ts) rather than through the shared session
   * store, so two rows on this device are wrong until the diary is re-read —
   * the hour that was freed may already belong to whoever was first in line.
   */
  async function doMoveAt(from: TrainingSession, to: MoveTime) {
    if (moveBusy) return;
    const who = nameOf(from.clientId);
    const fromLabel = `${DOW[new Date(from.startsAt).getDay()]} ${timeLabel(from.startsAt)}`;
    const toLabel = `${DOW[new Date(to.startsAt).getDay()]} ${timeLabel(to.startsAt)}`;
    setMoveBusy(true);
    try {
      const r = await moveSessionToTime(from.id, to.startsAt);
      if (!r.moved) {
        Alert.alert('Not moved', moveAtRefusalLine(r, who, fromLabel, toLabel), [{ text: 'OK' }]);
        return;
      }
      closeMove();
      await refresh();
      const told = r.clientId
        ? await sendPushChecked([r.clientId], 'Your session has moved',
          `${fromLabel} moved to ${toLabel}. Nothing is charged and your session is still paid for.`,
          { route: '/(client)/calendar' })
        : { ok: false };
      await reloadWaits();
      // The coach's own sentence for a move that worked, shared with the
      // open-slot path so one act is never described two ways. It reads
      // `promoted` and `waiting`, which part 1830 reports exactly as part 461
      // does.
      Alert.alert('Session moved', coachMovedLine(
        { moved: true, reason: null, clientId: r.clientId, promoted: r.promoted, waiting: r.waiting },
        who, fromLabel, toLabel, told.ok), [{ text: 'Done' }]);
    } finally { setMoveBusy(false); }
  }

  function confirmCancel(s: TrainingSession) {
    const d = new Date(s.startsAt);
    // The last sentence before a destructive, client-facing act, and it used to
    // end `${d.getDate()}/${d.getMonth() + 1}` — two readings three months
    // apart, under a weekday that makes it look unambiguous enough to tap
    // through.
    Alert.alert('Cancel this session?', `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} on ${dateOfLabel(d)}.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel session', style: 'destructive', onPress: () => doCancel(s) },
    ]);
  }
  function removeOpen(s: TrainingSession) {
    Alert.alert('Remove open slot?', `${timeLabel(s.startsAt)} is currently open. Remove it from your availability?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeSession(s.id) },
    ]);
  }

  // Send the re-offer and say what actually went out. This was `sendPush`, which
  // discards both outcomes, under an alert that read "Slot re-opened · Notified
  // N clients" — a sentence the code had no way of knowing was true. The coach
  // then waited on a slot nobody had been asked about.
  async function doReoffer(s: TrainingSession, ids: string[]) {
    const when = `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]}`;
    const push = await sendPushChecked(ids, 'A slot just opened', `${when} is available — first to book it gets it.`, { route: '/(client)/calendar' });
    if (!push.ok) {
      Alert.alert(
        'Nobody was told',
        `${when} is still open on your calendar, but the notification did not go out${push.error ? ` (${push.error})` : ''} — so none of your clients has been asked about it. Message them yourself, or try again.`,
        [{ text: 'OK' }],
      );
      return;
    }
    // The count is the SERVER's. This said `All ${ids.length} of your clients
    // were sent a notification`, and `ids.length` is the size of the list we
    // handed over rather than a count of anything that happened —
    // `sendPushChecked` hands back `recorded`, the number `notify_users`
    // itself returns, and it was thrown away. See src/lib/reofferCopy.ts for
    // the sentences and why they are separate.
    //
    // `inboxKept` and `partial` are the two things `recorded` and `ok` cannot
    // say between them. This title is 'A slot just opened', which notifyInbox
    // refuses to keep, so `recorded` is 0 by policy on every re-offer and the
    // coach was reading a working send as "recorded for nobody". `partial` is
    // send-push saying it could only part-read the handsets, so however many
    // phones lit up is a floor.
    Alert.alert(
      'Slot re-offered',
      reofferConfirmation({
        offered: ids.length,
        recorded: push.recorded,
        inboxKept: push.inboxKept,
        partial: push.partial,
      }, when),
      [{ text: 'Done' }],
    );
  }

  // "Push all N of your clients" is a claim about the whole roster, so it may
  // only be made when the roster on this screen IS the whole roster. `ids` was
  // built straight off `roster` with no regard for `rosterStatus`: under 'error'
  // the confirm offered to push "all 0 of your clients" and the result cheerfully
  // reported "Notified 0 clients" — telling a coach with a full book that nobody
  // exists — and under 'partial' it said "all" about however much of the list had
  // come back, leaving the clients missing from that read never hearing the slot
  // was free. When we do not know who everyone is, we say so rather than offer
  // the slot to a fraction of the room.
  function reoffer(s: TrainingSession) {
    if (rosterStatus !== 'ready') {
      Alert.alert(
        'Can’t offer it round yet',
        (rosterStatus === 'loading'
          ? 'Your clients are still loading, so Repple does not yet know who to offer this to.'
          : rosterStatus === 'error'
            ? 'Your clients could not be read, so Repple does not know who to offer this to. This is a connection problem, not an empty book.'
            : 'Only part of your roster loaded, so offering it now would skip the clients that are missing from the list.') +
          '\n\nThe slot stays open on your calendar either way — pull down to refresh and try again.',
        [{ text: 'OK' }],
      );
      return;
    }
    const ids = roster.map((c) => c.id);
    if (!ids.length) {
      Alert.alert('Nobody to offer it to', `${timeLabel(s.startsAt)} stays open on your calendar, but you have no clients on your roster to tell about it. Add one from the Clients tab.`, [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Offer this slot round?', `Push all ${ids.length} of your clients that ${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is open to book.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Notify ${ids.length}`, onPress: () => { void doReoffer(s, ids); } },
    ]);
  }

  /* ── The two things a coach can do to a standing appointment ─────────────
   *
   * CANCELLING ONE OCCURRENCE AND ENDING THE SERIES ARE DIFFERENT ACTS WITH
   * DIFFERENT CONSEQUENCES, and the sheet below never collapses them into one
   * button. `cancelOptions` in src/lib/recurring is the statement of the rule —
   * it prices the single cancellation, it refuses to price the ending under
   * every policy and every notice window, and it says that ending removes every
   * occurrence EXCEPT the next one. Both options are drawn from it so that this
   * screen cannot come to disagree with the module the tests hold the promise
   * against.
   */
  const endPolicy: CancellationPolicy | null = lcPolicy.status === 'ready'
    ? { applies: lcPolicy.applies, noticeHours: lcPolicy.noticeHours, fee: lcPolicy.fee, currency: lcPolicy.currency }
    : null;
  const endNext = endFor ? nextOccurrenceOf(endFor) : null;
  const endOptions = endFor
    // `upcoming` is the count the SERVER reports for the arrangement, not one
    // counted out of `sessions` here: this screen's calendar is capped, and a
    // capped read would understate how much the coach is about to remove.
    ? cancelOptions({ startsAt: endFor.nextAt ?? '', policy: endPolicy, upcoming: endFor.upcoming })
    : [];

  /**
   * What cancelling the ONE session does, said to the person doing it.
   *
   * `occurrenceDetail` from src/lib/recurring is deliberately NOT printed here,
   * and the reason is the whole point of this sheet. That sentence is written
   * for the CLIENT — "your coach doesn't charge…", "ask them", and in the
   * branch that bites, "a late-cancellation fee of 40 is recorded". None of it
   * is true of this button. A coach freeing their own client's hour goes
   * through `releaseSession`, not `cancel_my_session`; part 126 prices a
   * cancellation the CLIENT makes, and nothing is charged to anybody on this
   * path — which is exactly what the ordinary Cancel button on the day below
   * already tells them. Printing a fee against this option would make cancelling
   * one Tuesday look dearer than ending the whole arrangement, and a coach
   * quietly ending a standing agreement to dodge a fee that was never going to
   * be raised is precisely the wrong tap this sheet exists to prevent.
   *
   * The facts still come from the option: `affects` is 1, and the verdict is
   * what decides whether the notice window is worth mentioning at all.
   */
  const occurrenceLine = (o: CancelOption, s: RecurringSeries) => {
    const day = DOW_NAMES[((s.dow % 7) + 7) % 7];
    const base = `Frees that one hour and leaves the standing appointment running — next ${day} is still next ${day}. Whoever is first on that session’s waitlist takes it.`;
    return o.verdict && o.verdict.kind !== 'in-time'
      ? `${base} It is inside your ${noticeLabel(lcPolicy.noticeHours)} notice period, but you are the one cancelling it — so nothing is charged to ${seriesWho(s)}.`
      : base;
  };

  const G = layout.gutter;
  const totalSlots = booked.length + open.length;
  /**
   * The client turned up: record it, then open their record.
   *
   * Marked `completed` at check-in rather than after logging, because that is
   * the fact being asserted — this person is here and the session is
   * happening. A coach who gets interrupted and never opens the log has still
   * delivered the session, and leaving the outcome unset would put it back in
   * the Mark Sessions queue as though nobody knew what happened. A no-show is
   * the other button, and a session marked in error can be re-marked there.
   *
   * The write is awaited and read. Navigating away from a refused update would
   * take the coach to a screen implying the attendance was recorded.
   *
   * ── And it goes through the floor queue ────────────────────────────────
   *
   * It called `markOutcome` directly, which is a write straight to the server
   * from the one screen a coach uses standing next to somebody — and gyms are
   * in basements. A check-in made down there failed outright: the coach was
   * told to try again, the client was in front of them, and the delivered
   * session, which is what the gym settles payroll on, was lost.
   *
   * The three arms are kept apart, because they mean three different things to
   * the person holding the phone:
   *
   *   stored   the gym has it. Open their record.
   *   unsent   nobody answered. This phone now holds the decision, and the
   *            coach is told that in the queue's own words rather than told it
   *            saved — but the session IS happening, so the record still opens.
   *   refused  the server read it and declined. Nothing moves, and the coach is
   *            told it is not waiting to send either.
   */
  const checkIn = async (s: TrainingSession) => {
    if (!s.clientId) return;
    const who = nameOf(s.clientId);
    if (!coachId) {
      // The queue is per account and cannot hold anything without one, so an
      // 'unsent' here would be reported as "kept on this phone" while nothing
      // was kept. A sign-in still being restored is not a signed-out coach, and
      // this says which without sending anybody to sign in again.
      Alert.alert('Not checked in',
        `${who} was not marked present. Your sign-in has not come back yet, so there is nothing to record this against — try again in a moment.`);
      return;
    }
    // The NAME and not the description. `who` is a noun phrase when the roster
    // could not name this client — "a client this screen could not name" — and
    // the client screen would print it as a title. Passed only when it is
    // actually somebody's name; that screen reads its own roster otherwise.
    const realName = roster.find((c) => c.id === s.clientId)?.name?.trim();
    const openRecord = () =>
      router.push({
        pathname: '/(trainer)/client',
        params: realName
          ? { clientId: s.clientId as string, name: realName, checkedIn: '1' }
          : { clientId: s.clientId as string, checkedIn: '1' },
      });
    // `* 100` was wrong everywhere the minor unit is not a hundredth: a
    // ¥6,300 fee snapshotted as 630,000 and a KWD 40 one as 4,000. This is
    // the figure the gym settles payroll against, so it is converted by the
    // currency or it is not written at all — `undefined` leaves `rate_cents`
    // unset, and payrollByTrainer already reads that as unknown rather than
    // as nothing owed. A snapshot already written is a historical fact: this
    // decides what is filed from now on and rewrites nothing behind it.
    const rateCents = rateCentsToSnapshot({
      gymFee: tenant?.sessionFee, ownFee, gymCurrency: tenant?.currency, mine: myCcy,
    }) ?? undefined;
    const out = await floor.attempt({
      kind: 'session-outcome', sessionId: s.id, clientName: who, outcome: 'completed', rateCents,
    });
    if (out === 'refused') {
      Alert.alert('Not checked in', refusedLine(`${who}’s session`, 'Nothing has been recorded against it.'));
      return;
    }
    if (out === 'unsent') {
      Alert.alert('Kept on this phone', keptOfflineLine('This check-in'), [
        { text: 'Open Their Record', onPress: openRecord },
      ]);
      return;
    }
    openRecord();
  };

  const exportSchedule = async () => {
    const evts = booked.map((s) => ({ start: s.startsAt, durationMin: s.durationMin, title: `Session · ${nameOf(s.clientId)}` }));
    await shareIcs(buildIcs(evts, 'Repple — Coaching schedule'), 'repple-schedule.ics', 'Export your schedule');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coaching week</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Schedule</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Tap a day to see sessions · add or cancel any time</Text>
        </View>

        {/* Three different things are drawn on one grid — an open slot, a
            booking, and blocked time — and a coach who reads a blocked hour as
            an offer withdraws availability they never had. One dismissible row;
            src/lib/screenHelp.ts holds the words. */}
        <ScreenHelp screen="coach-schedule" />

        {/* ── the hero: how much of the schedule is spoken for ────────────── */}
        <Hero
          label="Booked"
          figure={countable ? fig(booked.length) : fig(null)}
          unit={countable && booked.length === 1 ? 'session' : 'sessions'}
          note={!known
            ? 'Your calendar could not be read, so this is not a count of your week — it is a dash because the number is unknown. Nothing has been cancelled. Pull down to refresh.'
            : sessionsStatus === 'loading'
              ? 'Reading your calendar…'
              : !countable
                ? 'Only part of your calendar loaded, so it cannot be counted. The days below show what did come back.'
                : totalSlots === 0
                  ? 'Nothing scheduled yet — add a session or set your weekly availability.'
                  // `sharePercent`, not `Math.round(… * 100)`. On a device
                  // this block read "Booked · 1 session" over "248 open slots ·
                  // 0% of your slots are filled" — one booking in 249 slots
                  // rounds to nought, so the screen said in one breath that a
                  // session was booked and that none of the slots were. See
                  // src/lib/sharePercent.ts: a percentage may print 0% only
                  // when the count is actually nought.
                  : `${open.length} open slot${open.length === 1 ? '' : 's'}${
                      // The clause is dropped rather than dashed. `totalSlots
                      // === 0` is already answered above, so a null here can
                      // only mean a total this screen could not read — and
                      // "— of your slots are filled" is a sentence with a hole
                      // in it, not a measurement (check:prose).
                      sharePercent(booked.length, totalSlots)
                        ? ` · ${sharePercent(booked.length, totalSlots)} of your slots are filled`
                        : ''}`}
          // The ring is a proportion, which is a figure like any other. Drawn
          // from a partial read it would show a coach a filled-up week off a
          // fraction of it.
          arc={countable && totalSlots ? booked.length / totalSlots : undefined}
          // Said as "of today's slots booked", and the ring measures nothing of
          // the kind: `booked` and `open` are filtered from the WHOLE loaded
          // calendar (this screen pages through months), so the proportion is
          // over every slot the coach has, not over one day. The visible note
          // beside it already says "of your slots are filled", with no day in
          // it — so the sighted reading and the spoken one disagreed, and only
          // the spoken one was wrong. arcLabel is the screen reader's entire
          // sentence for this ring ("33% of today's slots booked"), which makes
          // it the one place a scope can be misstated with nothing on screen to
          // contradict it.
          arcLabel="of your slots booked"
        />

        {/* ── the diary running out, said before it does ──────────────────
            Open slots are written four weeks at a time by a button somebody has
            to remember to press, and when the window empties the failure is
            silent and total: every client opens the booking screen, sees
            nothing, and is told nothing. A coach back from three weeks away
            reads the empty diary as a demand problem.

            Nothing here is drawn on a calendar that could not be read — an
            unread diary is 'unknown', not empty, and `generateSlots` refuses
            to run on one for the same reason. */}
        {slotLine ? (
          <View style={{ paddingTop: sp.md }}>
            <Notice tone={t.warn} kicker="Bookings"
              title={slotWindow.state === 'never-set' ? 'Your clients cannot book you'
                : slotWindow.state === 'empty' ? 'Nobody can book you'
                  : 'Your open slots are running out'}
              note={slotLine}>
              <View style={{ marginTop: sp.md }}>
                {/* Same sheet, different label, and the label is the fix. A
                    coach who has never set weekly hours cannot generate
                    anything — `generateSlots` refuses them with "No
                    availability set. Add at least one weekly slot first." —
                    so offering them a button named after the second step is
                    offering them a refusal. Under 'never-set' the button is
                    named after the step they are actually missing. */}
                <Ghost
                  label={slotWindow.state === 'never-set' ? 'Set Your Weekly Hours' : 'Generate Open Slots'}
                  onPress={() => setAvailOpen(true)} />
              </View>
            </Notice>
          </View>
        ) : null}

        <Rule />

        {/* ── month grid ─────────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.lg }}>
            <Ghost icon="back" onPress={() => shiftMonth(-1)} />
            <Text style={{ ...ty.head, color: t.ink }}>{MON[viewMonth]} {viewYear}</Text>
            <Ghost icon="chevron" onPress={() => shiftMonth(1)} />
          </View>

          <View style={{ flexDirection: 'row', marginBottom: sp.sm }}>
            {DOW.map((d) => <Text key={d} style={{ ...ty.micro, flex: 1, textAlign: 'center', color: t.ink3 }}>{d[0]}</Text>)}
          </View>

          {Array.from({ length: cells.length / 7 }).map((_, row) => (
            <View key={row} style={{ flexDirection: 'row' }}>
              {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
                if (d == null) return <View key={i} style={{ flex: 1, aspectRatio: 1 }} />;
                const k = `${viewYear}-${viewMonth}-${d}`;
                const daySess = byDay.get(k) ?? [];
                const isSel = k === selKey;
                const isToday = k === todayKey;
                const hasBooked = daySess.some((s) => s.status === 'booked');
                const hasOpen = daySess.some((s) => s.status === 'available');
                return (
                  <Pressable key={i} onPress={() => setSelKey(k)} accessibilityRole="button" accessibilityState={{ selected: isSel }}
                    style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    {/* Selected reads as the accent; today reads as weight and
                        accent ink — no border pretending to be a state. */}
                    <View style={{ width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? t.brand : 'transparent' }}>
                      <Text style={{
                        ...ty.body, ...numeric,
                        fontWeight: isSel || isToday ? '600' : '400',
                        color: isSel ? t.brandInk : isToday ? t.brand : t.ink2,
                      }}>{d}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 3, height: 6, marginTop: 2 }}>
                      {hasBooked && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.brand }} />}
                      {hasOpen && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.ink3 }} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Booked</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3 }} />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Open</Text>
            </View>
          </View>

          {/* A past month the read did not reach. Under the grid rather than
              over it: some of the month may be drawn, and it is still worth
              showing — but never without this. */}
          {monthNote ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{monthNote}</Flag> : null}
        </Section>

        <Rule />

        {/* ── the things you do from here ─────────────────────────────────
            Below the calendar, not above it. Two of these read the SELECTED
            DATE — "Add a Session" is captioned with it and books into it — so
            above the grid they asked a coach to act before choosing the day
            they were acting on, and the caption named whatever date happened
            to be selected already. The order now matches the order of the
            decision: pick the day, then do the thing. */}
        <Section>
          <SectionHead title="Manage" />
          <ListRow icon="plus" title="Add a Session"
            note={`Book a client or open a slot on ${DOW[selDate.getDay()]} ${selD} ${MON_SHORT[selM]}`}
            onPress={() => { setAddClient(null); setAddOpen(true); }} />
          {/* Three notes, not two. "Set the times you offer every week" is an
              instruction, and giving it to a coach whose week we simply could
              not read sends them to re-enter times that are already on the
              server — where the unique index refuses each one. */}
          <ListRow icon="clock" title="Weekly Availability"
            note={!availKnown
              ? (availStatus === 'loading' ? 'Reading the times you offer…' : 'Your weekly times could not be read in full — this is not "none set"')
              : availSlots.length
                ? `${availSlots.length} weekly slot${availSlots.length === 1 ? '' : 's'} · generate the next 4 weeks`
                : 'Set the times you offer every week'}
            onPress={() => setAvailOpen(true)} />
          <ListRow icon="clock" title="Block Out Time"
            note={`Mark ${DOW[selDate.getDay()]} ${selD} ${MON_SHORT[selM]} as unavailable so nobody can book it`}
            onPress={() => setBlockOpen(true)} />
          {/* The row is offered on every build, including the ones that cannot
              do it. HAS_NATIVE_CALENDAR is false on every install made before
              expo-calendar landed — the version was deliberately not moved, so
              those installs receive this JavaScript and none of the native
              half — and hiding the row there would leave a coach reading a
              release note about a feature they cannot find. The note says what
              is missing instead, and the sheet says it again in full. */}
          {/* ── two rows that say the feature is not here, drawn as though
                 it were ────────────────────────────────────────────────────
              Seen on a device: this row and Google Calendar below it, adjacent,
              both saying the thing does not exist on this build, and both
              drawing the brand-coloured icon and the same chevron as every
              working row above them. A coach reads two live-looking rows that
              lead nowhere and concludes the screen is broken rather than the
              build is old.

              They stay tappable — the argument above still holds, and the
              sheet says it in full — but the icon goes to the quiet ink, which
              is the difference between "here is a thing you can do" and "here
              is a thing you cannot do yet, and here is why". The chevron stays
              because there IS somewhere to go: the explanation. */}
          <ListRow icon="calendar" title="Block Time From Your Calendar"
            tone={HAS_NATIVE_CALENDAR ? undefined : t.ink3}
            note={HAS_NATIVE_CALENDAR
              ? 'Read when your phone says you are busy, times only, and pick what to block'
              : 'Needs a newer build of the app. Blocking time by hand is unaffected'}
            onPress={openBusySheet} />
          {/* Offered on every build, and its note is the state rather than an
              instruction. Three of the six states are NOT "the coach has not
              connected": a build with no client id cannot offer this at all, a
              link we could not read is unknown rather than absent, and a grant
              with no refresh token is a connection that dies within the hour.
              A row that said "Not connected" for any of them would send a
              coach to sign in to something they are already signed in to. */}
          <ListRow icon="calendar" title="Google Calendar"
            tone={CALENDAR_SYNC_CONFIGURED ? undefined : t.ink3}
            note={!CALENDAR_SYNC_CONFIGURED
              ? 'Not available in this version of Repple yet'
              : syncStatus === 'error'
                ? 'Your connection could not be read, so this is not "not connected"'
                : syncStatus === 'loading'
                  ? 'Checking your connection…'
                  : LINK_NOTES[linkState({ configured: CALENDAR_SYNC_CONFIGURED, connecting: false, link: syncLink })]}
            onPress={() => setSyncOpen(true)} />
          <ListRow icon="people" title="Group Classes" note="Schedule & fill classes across branches"
            onPress={() => router.push('/(trainer)/classes')} />
          {booked.length > 0 ? (
            <ListRow icon="share" title="Export Schedule" note="Send your booked sessions to your calendar app"
              onPress={exportSchedule} />
          ) : null}
        </Section>

        <Rule />

        {/* ── standing appointments ────────────────────────────────────────
            Listed here rather than inside the weekly-availability sheet
            because availability is an OFFER and this is an AGREEMENT. The
            sessions already exist — booked, on both calendars, eight weeks
            out — and nobody presses Generate to keep them coming. */}
        <Section>
          <SectionHead title="Standing Appointments"
            note={seriesStatus === 'error' ? 'Not read' : 'Set one up'}
            onPress={seriesStatus === 'error' ? undefined : () => { setSrClient(null); setSeriesOpen(true); }} />

          {/* An empty list under 'error' means the arrangements could not be
              READ, and "you have no standing appointments" said to a coach who
              trains somebody every Tuesday is the named recurring bug in
              src/ui/loadStatus.ts. Warn as a mark rather than as label ink,
              for the same contrast reason as the day above. */}
          {seriesStatus === 'error' ? (
            <Flag tone={t.warn}>
              Your standing appointments could not be read, so none can be listed. This is a connection problem, not a statement that you have none — every arrangement you have agreed is still running, and its sessions are still on your calendar and your clients’. Setting a new one up is off until the list loads, so you can’t agree the same hour twice without seeing it.
            </Flag>
          ) : seriesStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your standing appointments…</Text>
          ) : standing.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {seriesStatus === 'partial'
                ? 'Nothing came back, but only part of the list loaded — so this is not a statement that you have none. Pull down to refresh.'
                : endedCount
                  ? `Nothing is standing right now. The ${endedCount === 1 ? 'one you ended is' : `${endedCount} you have ended are`} not listed here.`
                  : 'No standing appointments yet. Set one up and the same hour is booked for the same client every week — neither of you has to book it again.'}
            </Text>
          ) : standing.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{seriesLabel(s)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {seriesWho(s)} · {s.durationMin} min · {s.upcoming
                      ? `${s.upcoming} booked ahead`
                      : 'nothing on the books ahead'}
                  </Text>
                  {s.nextAt ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      Next {dateLabel(s.nextAt)} at {timeLabel(s.nextAt)}
                    </Text>
                  ) : null}
                  {/* The hour on a series is a wall-clock hour in the zone it
                      was agreed in, not in the zone the reader is standing in.
                      Said only when they differ, which is a coach abroad — and
                      is exactly when "Every Tuesday at 7:00 am" would otherwise
                      be read as seven o'clock where they are now. */}
                  {s.tz && devTz && s.tz !== devTz ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      That time is {s.tz.split('/').pop()?.replace(/_/g, ' ')} time, where it was agreed.
                    </Text>
                  ) : null}
                </View>
                {/* Named for both things it opens. A button that said "End"
                    would be a button that had already chosen. */}
                <Ghost label="Cancel or End" onPress={() => setEndFor(s)} />
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── the selected day ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title={`${DOW[selDate.getDay()]} ${selD} ${MON_SHORT[selM]}`} note="Add"
            onPress={() => { setAddClient(null); setAddOpen(true); }} />

          {selDaySessions.length === 0 ? (
            // "No sessions this day" is a claim about the coach's diary, and it
            // may only be made when the diary was actually read. Under 'error'
            // this is the sentence that sends a coach home.
            // The unread case is a Flag, not warn-coloured ink: warn as label
            // text is 3.87–4.08:1 on the three light palettes, so the one
            // sentence telling a coach not to book over the day was the one
            // they could not read on a bright screen.
            !known ? (
              <Flag tone={t.warn}>
                Your calendar could not be read, so nothing can be shown for this day. This is a connection problem, not an empty day — do not book over it until it loads.
              </Flag>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                {sessionsStatus === 'loading'
                  ? 'Reading your calendar…'
                  : sessionsStatus === 'partial'
                    ? 'Nothing came back for this day, but only part of your calendar loaded — so this day may not be empty. Pull down to refresh.'
                    // A day with a class on it is not a free day, and the
                    // sentence that used to stand here said so by omission.
                    : selDayClasses.length > 0
                      ? 'No one-to-ones this day. You are teaching below — tap Add to book somebody around it.'
                      : 'No sessions this day. Tap Add to book one.'}
              </Text>
            )
          ) : selDaySessions.map((s, i) => {
            /* ── whose hour, and what they are due to train in it ─────────
             *
             * Both answers come out of src/lib/daySession.ts and neither is
             * decided here. The tap is refused in words rather than silently
             * dropped — a row that does nothing when pressed, on the screen a
             * coach uses thirty seconds before a session, reads as the app
             * having lost the client.
             */
            const tap = s.status === 'booked' ? tapOf(s.clientId) : null;
            /* The plan is resolved for the DAY ON SCREEN, which is routinely
             * next Tuesday and not today, so `selDay` goes in rather than a
             * clock — `selDay` is built from the selected local date and is
             * never a UTC slice. Only for a row that opens onto somebody: a
             * client this screen's roster cannot name is one whose record it
             * has already refused to draw, and a plan under their unnamed row
             * would be a session attributed to nobody. */
            const who = tap?.name ? tap.name.split(' ')[0] : 'This client';
            const plan = tap?.can && tap.clientId
              ? trainingOnDay(ap.getProgram(tap.clientId), ap.startsOn[tap.clientId] ?? null, selDay, ap.status, who)
              : null;
            const planCaveat = plan ? dayTrainingCaveat(plan) : null;
            /* ONE warning mark on the row, on whichever sentence is the
             * warning. `dayPlanUnread` is true both when the plan could not be
             * read and when the plan is real but unconfirmed; the first has no
             * caveat (its own line says it) and the second does, so the two
             * tests together put the mark in exactly one place. */
            const planLineWarns = plan != null && dayPlanUnread(plan) && planCaveat == null;
            const unnamedNote = s.status === 'booked'
              ? unnamedSlotNote(s.clientId, roster, rosterStatus) : null;
            /* The identity of the row — the time, who is in it, and everything
             * that qualifies that. Lifted out so the same block can be drawn
             * bare or inside a Pressable; there is one copy of it either way. */
            const identity = (
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.status === 'booked' ? slotOf(s.clientId) : s.status === 'blocked' ? 'Unavailable · nobody can book this' : (s.released ? 'Open · re-offered' : 'Open slot')}</Text>
                {/* A booked hour whose client this screen cannot name. Said
                    in a sentence and not left to an odd-looking label,
                    because the coach's next decision is whether to hand the
                    hour to somebody else. Null for every ordinary row. */}
                {unnamedNote ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 3 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.warn, marginTop: 5 }} />
                    <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
                      {unnamedNote}
                    </Text>
                  </View>
                ) : null}
                {/* And the half of it that is about the TAP. Deliberately
                    short and deliberately under the line above, indented to
                    sit with it: the two read as one thought — this hour is
                    spoken for, and here is why their record will not open —
                    rather than as the same warning said twice. It carries
                    no mark of its own for the same reason, and stands
                    unindented on the one row that has no line above it, a
                    booked hour with nobody in it. */}
                {tap && !tap.can && tap.why ? (
                  <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3, marginStart: unnamedNote ? 11 : 0 }}>
                    {tap.why}
                  </Text>
                ) : null}
                {/* Who is behind this hour. It changes what cancelling
                    means — the slot is handed straight over rather than
                    thrown open — so it is said on the row, next to the
                    button that does it. A count off a truncated read is a
                    wrong count, so 'partial' shows a dash like every other
                    figure in this app. */}
                {s.status === 'booked' && (waitStatus === 'error' || waitStatus === 'partial' || (waitCounts.get(s.id) ?? 0) > 0) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.warn }} />
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      {waitStatus === 'error'
                        ? 'Waitlist not read'
                        : waitStatus === 'partial'
                          // Not `${fig(null)} waiting`: a dash standing where the
                          // count goes rendered "— waiting — only part of the list
                          // loaded", which reads as a line that lost its first word
                          // rather than as a number nobody has. The count is left out
                          // of the sentence instead of drawn as a dash inside it.
                          ? 'Only part of the waitlist loaded, so the number waiting is not known'
                          : `${waitCounts.get(s.id)} waiting — cancelling hands it to whoever is first`}
                    </Text>
                  </View>
                ) : null}
                {s.approvedAt ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.good }} />
                    <Text style={{ ...ty.caption, color: t.ink3 }}>Confirmed by client</Text>
                  </View>
                ) : null}
                {s.approvalNote ? (
                  <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>“{s.approvalNote}”</Text>
                ) : null}
              </View>
            );
            return (
            <View key={s.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ paddingVertical: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'booked' ? t.brand : s.status === 'blocked' ? t.warn : t.surface3 }} />
                  {/* The row itself opens the client. Not a button beside it:
                      the thing a coach reaches for is the person's name, and
                      the one route that already existed to their record was
                      Check In — which MARKS THEM PRESENT on the way through,
                      and is the wrong write for somebody who only wanted to
                      read their injuries before the session starts.

                      Offered only where it goes somewhere. Every other reading
                      has said why, in the identity block above. */}
                  {tap?.can ? (
                    <Pressable
                      onPress={() => openClient(tap)}
                      accessibilityRole="button"
                      accessibilityLabel={`${timeLabel(s.startsAt)} · ${slotOf(s.clientId)}. ${clientTapLabel(tap)}`}
                      // Reached by size rather than by slop. The block is two
                      // lines of type and already clears 44pt; `MIN_TARGET` is
                      // stated as a floor so a later row that is one line does
                      // not quietly fall under it. `hitSlopFor` is the tool for
                      // a control whose drawn size is deliberately smaller, and
                      // would return zero here.
                      style={{ flex: 1, flexDirection: 'row', minHeight: MIN_TARGET, alignItems: 'center' }}
                    >
                      {identity}
                    </Pressable>
                  ) : identity}
                </View>

                {/* ── what they are due to train on this day ──────────────
                    Under the hour it belongs to, so a coach reading down the
                    day sees each session and what is in it in one pass. The
                    heading names the DAY rather than saying "Planned", because
                    this sheet is routinely open on a date that is not today.

                    A status colour is a mark and never ink: the two sentences
                    that carry one go through `Flag`. */}
                {plan ? (
                  <View style={{ marginTop: sp.md, marginStart: sp.md + 6 }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>{dayPlanHeading(plan)}</Text>
                    {planLineWarns ? (
                      <View style={{ marginTop: sp.xs }}><Flag tone={t.warn}>{plan.line}</Flag></View>
                    ) : (
                      <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{plan.line}</Text>
                    )}
                    {planCaveat ? (
                      <View style={{ marginTop: sp.xs }}><Flag tone={t.warn}>{planCaveat}</Flag></View>
                    ) : null}
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, marginStart: sp.md + 6 }}>
                  {s.status === 'booked' ? (<>
                    {/* Check in is the start of the session, and it is the one
                        thing a coach does standing next to somebody. It marks
                        them present and opens their record — the overview
                        first, because what you want thirty seconds before a
                        session is what they did last time and what they cannot
                        do. Entering the exercises is one tap on from there,
                        and lands in the client's OWN record, so it reaches
                        their app rather than staying on the coach's screen. */}
                    {/* ── the other end of the hour ──────────────────────
                        Check In is the start; this is the finish, and it was
                        the half that did not exist. Logging what happened and
                        marking the session delivered were two screens with
                        nothing joining them, and `workouts` had no column to
                        say which session an hour of training belonged to — so
                        "I ran this session" could not be written down as one
                        fact.

                        On the day sheet as well as the queue in sessions.tsx,
                        because this is where a coach is standing the minute a
                        session ends, and the queue is where they catch up on
                        the ones they did not. */}
                    {canFinish(s) ? (
                      <View style={{ flex: 1 }}>
                        <Cta label="Finish" wide onPress={() => router.push({
                          pathname: '/(trainer)/log-session',
                          params: {
                            clientId: s.clientId ?? '',
                            // Only a real name. `slotWhoName` can answer with a
                            // noun phrase, and "PT with a client who has left
                            // your book" is not a name to head a log with.
                            ...(tapOf(s.clientId).name ? { name: tapOf(s.clientId).name as string } : null),
                            sessionId: s.id,
                            sessionAt: s.startsAt,
                          },
                        })} />
                      </View>
                    ) : (
                      <View style={{ flex: 1 }}><Cta label="Check In" wide onPress={() => checkIn(s)} /></View>
                    )}
                    {/* Between Check In and Cancel on purpose. Moving a session
                        is the commonest thing that happens to a diary and the
                        coach's only route to it was Cancel, which gave the hour
                        away and told the client they had been cancelled. */}
                    <View style={{ flex: 1 }}><Ghost label="Move" onPress={() => openMove(s)} /></View>
                    <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => confirmCancel(s)} /></View>
                  </>) : s.status === 'blocked' ? (
                    <View style={{ flex: 1 }}><Ghost label="Free This Time Up" onPress={() => removeOpen(s)} /></View>
                  ) : (<>
                    {/* "Re-offer" on a slot that has never been booked reads
                        as though somebody had cancelled — a coach seeing it on
                        an ordinary open hour looks for the booking that was
                        lost. This branch is `status === 'available'`, which is
                        every open slot, most of which nobody ever held. The
                        act is the same act; the word was the wrong one. */}
                    <View style={{ flex: 1 }}><Ghost label="Offer It Round" onPress={() => reoffer(s)} /></View>
                    <View style={{ flex: 1 }}><Ghost label="Remove" onPress={() => removeOpen(s)} /></View>
                  </>)}
                </View>
              </View>
            </View>
            );
          })}

          {/* ── the classes on this day ──────────────────────────────────
              Below the one-to-ones because that is what this screen is for,
              and on it because an evening with a class in it is not a free
              evening. The rows carry no verbs: a class is managed on the
              Classes screen and its register is taken there, and two routes to
              the same write is how one of them goes stale. */}
          {classDayHeading(selDayClasses.length) ? (
            <>
              <Rule />
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                {classDayHeading(selDayClasses.length)}
              </Text>
              {selDayClasses.map((c) => (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.mine ? t.brand : t.warn, marginTop: 6 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>
                      {timeLabel(c.startsAt)} · {c.durationMin} min · {c.title}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {classDayNote(c)}{c.room?.trim() ? ` · ${c.room.trim()}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {/* An empty class list is not an empty timetable. This is the same
              rule `classCheckCaveat` holds for the booking side of this screen,
              said in the one place a coach reads a day and decides it is free. */}
          {classCaveat ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>{classCaveat}</Flag>
          ) : null}

          {/* ── the hours in this day that nobody can book ───────────────
              Everything above is a row that exists. This is the opposite: a
              stretch inside the coach's own working hours with nothing of
              theirs in it AND no open slot across it, which means no client can
              take it however free the coach is. See src/lib/dayGaps.ts.

              Drawn only for a day that still has some of itself left, and only
              when all three reads behind the word "free" came back whole — an
              hour claimed as free out of a truncated diary is the hour the
              missing row was in. */}
          {selDayAhead && gapsKnown && gapsHeading(selDayGaps.length) ? (
            <>
              <Rule />
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                {gapsHeading(selDayGaps.length)}
              </Text>
              {selDayGaps.map((g) => (
                <View key={g.startMs} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, marginTop: 6 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>
                      {timeLabel(g.startsAt)} · {gapLengthLabel(g.minutes)}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{gapNote(g)}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}
          {/* And the three states in which no such claim may be made at all.
              Never "you have no free hours" over a read that did not finish. */}
          {gapsNote ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{gapsNote}</Text>
          ) : null}

          {/* What this phone is still carrying, which now includes check-ins
              made on this screen. Drawn even when the last one went through:
              the count is about the morning, not about the tap. A queue that
              could not be READ is not an empty one — src/lib/floorQueue.ts,
              rule 2 — so "nothing waiting" is withheld rather than stated. */}
          {!floor.queueRead ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              What this phone is still carrying could not be read, so whether any check-ins are waiting to go up is not known. Nothing has been lost — it is not being written over either.
            </Flag>
          ) : floorPendingNote(floor.unsent) ? (
            <>
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{floorPendingNote(floor.unsent)}</Flag>
              <View style={{ alignItems: 'flex-start', paddingTop: sp.sm }}>
                <Ghost label={floorSending ? 'Sending…' : 'Send Now'}
                  a11yLabel="Send what is waiting on this phone"
                  onPress={() => { void sendFloorNow(); }} />
              </View>
            </>
          ) : null}
          {floorNote ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{floorNote}</Flag> : null}
        </Section>

        <Rule />

        {/* ── who had an appointment and has none ────────────────────────
            The other absence. A calendar draws days and a client who stopped
            appearing is not on one, so the diary quietly looks tidier for
            having lost them.

            NOT src/lib/clientDrift.ts and it says so in words below: drift
            measures a change in somebody's training rate against a fifty-six
            day baseline built from check-ins, workouts, sessions and door
            swipes, and lives on the Clients and Analytics screens where those
            reads are made. This is the diary's own narrower question — had an
            appointment, has none — answered from rows this screen already
            holds, with no extra read.

            Shown under 'partial' on purpose, with the shortfall stated: the
            sessions read is newest-first, so nothing BOOKED AHEAD can have
            fallen off the end of it. See src/lib/rebooking.ts.

            Withheld entirely from a coach with no appointments on file at all.
            "Everybody who has trained with you has something booked" is true of
            an empty book and says nothing about it, and a section that appears
            before the first client is a section a coach learns to scroll past
            before it has ever had anything to tell them. */}
        {rebookingListable(sessionsStatus) && sessions.some((s) => s.status === 'booked' || !!s.outcome) ? (
          <>
            <Section>
              <SectionHead title="Not Rebooked"
                note={sessionsStatus === 'partial' ? 'Part of the list' : undefined} />
              {unrebookedHeading(quiet.length) ? (
                <>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                    {unrebookedHeading(quiet.length)} — they trained with you recently and have nothing in your diary.
                  </Text>
                  {quiet.map((u, i) => {
                    const tap = tapOf(u.clientId);
                    return (
                      <View key={u.clientId}>
                        {i > 0 ? <Rule /> : null}
                        <Pressable disabled={!tap.can} onPress={() => openClient(tap)}
                          accessibilityRole={tap.can ? 'button' : undefined}
                          accessibilityLabel={`${slotWhoName(u.clientId, roster, rosterStatus)}. ${unrebookedNote(u, dateLabel)}${tap.can ? '' : ` ${clientTapLabel(tap)}`}`}
                          hitSlop={hitSlopFor(MIN_TARGET)}
                          style={{ minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.lastMissed ? t.warn : t.brand }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                              {slotWhoName(u.clientId, roster, rosterStatus)}
                            </Text>
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                              {unrebookedNote(u, dateLabel)}
                            </Text>
                            {/* A tap this screen will refuse is refused in
                                words, on the row, rather than doing nothing. */}
                            {!tap.can && tap.why ? (
                              <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3 }}>{tap.why}</Text>
                            ) : null}
                          </View>
                          {tap.can ? <Icon name="chevron" size={16} color={t.ink3} /> : null}
                        </Pressable>
                      </View>
                    );
                  })}
                </>
              ) : (
                <Text style={{ ...ty.label, color: t.ink3 }}>{noUnrebookedLine()}</Text>
              )}
              {/* How far back the read actually reached. A short list under a
                  diary loaded only to last week is not a clean book. */}
              {quietCoverage ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>{quietCoverage}</Flag>
              ) : null}
              {/* The gap no read can close, stated rather than worked around:
                  a client who cancelled their own last session left no row that
                  is still theirs. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {REBOOK_CANCELLED_GAP_NOTE}
              </Text>
            </Section>

            <Rule />
          </>
        ) : null}

        {/* ── late-cancellation fees ─────────────────────────────────────
            The record. `charges` has been in this schema since the first
            migration and nothing has ever written to it: a late cancellation
            was detected, the client was warned, an outcome was filed, and no
            money was ever recorded anywhere. This is the other end of that.

            Repple does not take the payment and this section never suggests
            otherwise. What it gives a coach is the one thing they could not
            get before — a list of who owes them what, for which session — so
            they can ask. Letting one off is a first-class action here for the
            same reason: forgiving a fee is part of the policy, and a coach
            who cannot do it in the app will simply stop trusting the list. */}
        {feeStatus === 'error' || lateFees.length > 0 ? (
          <Section>
            <SectionHead title="Late-Cancellation Fees"
              note={feeStatus === 'error' ? 'Not read' : feeStatus === 'partial' ? 'Part of the list' : undefined} />
            {feeStatus === 'error' ? (
              <Flag tone={t.warn}>
                We couldn’t read your late-cancellation fees. This is not a statement that there are none — any fee already recorded still stands.
              </Flag>
            ) : (<>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                Recorded when a client cancelled inside your notice period. Repple does not collect these — you settle them with the client.
              </Text>
              {lateFees.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.waivedAt ? t.surface3 : t.warn }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: c.waivedAt ? t.ink3 : t.ink }}>
                        {/* Null amount renders as a dash, never a zero: the
                            row exists, its figure did not come back, and "0"
                            would be a statement that nothing is owed. */}
                        {c.amount == null ? fig(null) : feeAmountLine(c.amount, c.currency)}
                      </Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {nameOf(c.clientId)} · {new Date(c.createdAt).toLocaleDateString()}
                        {c.waivedAt ? ' · waived' : ''}
                      </Text>
                    </View>
                    <Ghost label={c.waivedAt ? 'Reinstate' : 'Waive'} onPress={() => confirmWaive(c)} />
                  </View>
                </View>
              ))}
            </>)}
          </Section>
        ) : null}

      </ScrollView>

      {/* ── weekly availability sheet ─────────────────────────────────────── */}
      <Modal visible={availOpen} animationType="slide" transparent onRequestClose={() => setAvailOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAvailOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '82%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Weekly Availability</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>Set the times you offer every week, then generate open slots.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Above the grid rather than below it: a coach opening this sheet
                is about to act on their week, and this is the reason the week
                they can see is not the week their clients can book. */}
            {zoneNote ? (
              <View style={{ marginBottom: sp.md }}>
                <Flag tone={zones === 'unknown' ? t.ink3 : t.warn}>{zoneNote}</Flag>
                {healLabel ? (
                  <View style={{ marginTop: sp.sm }}>
                    <Cta label={healLabel} onPress={applyPhoneZone} />
                  </View>
                ) : null}
                {noHealNote ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{noHealNote}</Text>
                ) : null}
              </View>
            ) : null}
            {/* An empty list under 'error' is UNKNOWN, never "there are none" —
                src/ui/loadStatus.ts. Said here rather than only in the row that
                opens this sheet, because this is the screen a coach acts on:
                the Add control below is right underneath it. */}
            {availStatus === 'error' ? (
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                Your weekly times could not be read, so we cannot say which ones you offer. This is
                not "none set" — anything already on your week is still there and still bookable, so
                adding a time you already offer will be refused.
              </Text>
            ) : availStatus === 'loading' ? (
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>Reading the times you offer…</Text>
            ) : availSlots.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>No weekly slots yet.</Text>
            ) : null}
            {/* Grouped by day, with the day's own Remove. A range writes fifty
                rows onto one day and a flat list of fifty minus buttons is the
                form this feature exists to abolish, pointed backwards. The
                individual slots are still each removable underneath — a coach
                who wants Tuesday minus the 11:15 can have it. */}
            {availByDay.map((g, gi) => (
              <View key={'day' + g.dow}>
                {gi > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.sm }}>
                  <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, flex: 1 }}>
                    {DOW[g.dow]} · {g.slots.length} slot{g.slots.length === 1 ? '' : 's'}
                  </Text>
                  <Ghost label="Remove" onPress={() => clearDay(g.dow, g.slots.length)} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                  {g.slots.map((sl) => (
                    <Pressable
                      key={sl.id}
                      /* The two bulk removals above both count what the
                         server confirmed and say when it fell short; the
                         single-slot chip discarded the answer entirely.
                         `useAvailability` drops the slot from state and from
                         AsyncStorage before the request goes out, so a refused
                         delete took the chip off this sheet and left the row on
                         the server generating open slots — the coach is
                         bookable at an hour they watched themselves close. */
                      onPress={() => {
                        void (async () => {
                          if (await removeAvail(sl.id)) return;
                          await reloadAvail();
                          Alert.alert(
                            'Still on your week',
                            `${DOW[sl.dow]} ${avTime(sl.hour, sl.minute)} was not removed, so it is still there and still generating open slots. Try again when you have a connection.`,
                            [{ text: 'OK' }],
                          );
                        })();
                      }}
                      hitSlop={hitSlopFor(30)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${DOW[sl.dow]} ${avTime(sl.hour, sl.minute)}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 11, borderRadius: radius.pill, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring }}
                    >
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>{avTime(sl.hour, sl.minute)}</Text>
                      <Icon name="minus" size={12} color={t.ink3} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ))}

            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.md }}>Add weekly hours</Text>
            {/* ── a stretch, or one slot ────────────────────────────────────
                This sheet could only ever add ONE slot: a day, a time, a
                length, add. To offer 07:00–19:00 in quarter-hours a coach
                tapped that forty-eight times for one day and three hundred
                and thirty-six for a week.

                Nobody did. This database holds eight coach accounts, ten
                coaching relationships and zero rows in trainer_availability —
                the first step of the whole personal-training loop has never
                once been completed by a real person, because what it asked
                for was unreasonable rather than because it was hidden.

                So the unit a coach thinks in — a stretch of the day — is now
                the unit they enter, and it is the default. */}
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
              <Chip t={t} label="A stretch of the day" on={avRange} onPress={() => setAvRange(true)} />
              <Chip t={t} label="One slot" on={!avRange} onPress={() => setAvRange(false)} />
            </View>

            {avRange ? (<>
              {/* Multi-select. A coach who works the same hours Monday to
                  Friday says so once. */}
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Days</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {DOW.map((d, i) => (
                  <Chip key={'ar' + d} t={t} label={d} on={avDays.includes(i)}
                    onPress={() => setAvDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))} />
                ))}
              </ScrollView>

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>From</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.sm }}>
                {HOURS.map((h) => (
                  <Chip key={'af' + h} t={t} label={`${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`} on={avFrom === h}
                    onPress={() => { setAvFrom(h); if (avTo <= h) setAvTo(Math.min(24, h + 1)); }} />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {[0, 15, 30, 45].map((m) => (
                  <Chip key={'afm' + m} t={t} label={`:${String(m).padStart(2, '0')}`} on={avFromMin === m} onPress={() => setAvFromMin(m)} />
                ))}
              </ScrollView>

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Until</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.sm }}>
                {HOURS.filter((h) => h >= avFrom).concat([24]).map((h) => (
                  <Chip key={'at' + h} t={t} label={hourLabel(h)} on={avTo === h} onPress={() => setAvTo(h)} />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {[0, 15, 30, 45].map((m) => (
                  <Chip key={'atm' + m} t={t} label={`:${String(m).padStart(2, '0')}`} on={avToMin === m} onPress={() => setAvToMin(m)} />
                ))}
              </ScrollView>

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Each session</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {[15, 30, 45, 60, 90].map((d) => (
                  <Chip key={'ad' + d} t={t} label={`${d} min`} on={avDur === d} onPress={() => setAvDur(d)} />
                ))}
              </ScrollView>

              {/* What is about to happen, before the button rather than after
                  it. The count is the one thing about this feature that can
                  surprise somebody, so it goes where the decision is made. */}
              {/* A refusal is a Flag — the tone rides a 6pt mark and the words
                  stay in ink. `warn` as text ink is 3.87:1 on the light
                  palettes, which clears what a MARK needs and not what TEXT
                  does; check:contrast catches exactly this. */}
              {rangeNote ? (
                rangeRefusal
                  ? <View style={{ marginBottom: sp.sm }}><Flag tone={t.warn}>{rangeNote}</Flag></View>
                  : <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{rangeNote}</Text>
              ) : null}
              {rangeLeftover ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{rangeLeftover}</Text>
              ) : null}

              {/* A Cta and not a Ghost, and this is a correction rather than a
                  preference. The sheet has two actions — save this stretch,
                  then open the next four weeks from it — and the SECOND was
                  the big primary button at the bottom while the first was a
                  low-contrast Ghost in the middle of a scroll view. So the
                  obvious thing to press after filling the form in was the one
                  that refuses with "No availability set. Add at least one
                  weekly slot first", which is a true sentence and a useless
                  one when the times are typed in directly above it. */}
              {/* The action itself lives in the sheet FOOTER, not here. See the
                  note there: inside this ScrollView it sat below the fold on a
                  phone, under a footer that showed a different button. */}
            </>) : (<>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
              {DOW.map((d, i) => <Chip key={d} t={t} label={d} on={avDow === i} onPress={() => setAvDow(i)} />)}
            </ScrollView>
            {/* The same control the Add Session and Standing Appointment
                sheets use, deliberately: hour then quarter. This sheet was
                still on a hand-written 6am–8pm list of whole hours — the
                assumption about when training happens that HOURS exists to
                refuse, and no way at all to offer 6:45 every Tuesday. */}
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Time · {avTime(avHour, avMinute)}</Text>
            <View style={{ marginBottom: sp.md }}>
              <TimeGrid t={t} hour={avHour} minute={avMinute} onHour={setAvHour} onMinute={setAvMinute} />
            </View>
            {/* The result was discarded, and it is the half that matters: this
                sheet is the template the month is generated from, so a weekly
                slot that never reached the server is four sessions that never
                open — and it sat in the list above looking exactly like a
                saved one. Now each of the three outcomes says its own thing,
                and the two that are not "saved" say what to do. */}
            <Ghost label={`Add ${DOW[avDow]} ${avTime(avHour, avMinute)}`} icon="plus" onPress={() => { void addWeekly(); }} />
            </>)}
          </ScrollView>
          <View style={{ height: sp.lg }} />

          {/* ── the sheet's actions, where they can always be seen ───────────
              This is a correction, and the simulator found it rather than the
              code did. The Add control was the last thing inside the scroll
              view: on a phone it sat below the fold, under a footer that showed
              Generate Open Slots — so the only visible button was the one that
              refuses with "No availability set", and the one that works was
              off-screen. A primary action a person has to scroll to find, in a
              region a fixed footer overlaps, is not a primary action.

              Both steps are in the footer now, in the order they happen. */}
          {avRange && availKnown ? (
            <>
              <Cta
                label={avBusy ? 'Working…' : rangeRefusal ? 'Check the times above' : addButtonLabel(rangeSplit.fresh.length, rangeSplit.duplicates)}
                wide
                onPress={() => { void addRange(); }}
              />
              {/* Removal is the same gesture pointed backwards, and it has to be
                  as cheap as adding was. A coach who put fifty slots on Tuesday
                  in one press must not need fifty presses to take them off.
                  Only drawn when the selected stretch actually covers something,
                  so it never sits there offering to remove nothing. */}
              {rangeExisting.length > 0 ? (
                <>
                  <View style={{ height: sp.sm }} />
                  <Ghost
                    label={`Remove the ${rangeExisting.length} already in this range`}
                    onPress={removeRange}
                  />
                </>
              ) : null}
              <View style={{ height: sp.sm }} />
            </>
          ) : null}

          {/* Step two, and it looks like step two. A coach with no weekly hours
              cannot generate anything — `generateSlots` refuses on exactly that
              — so offering it as the loudest control was inviting the press
              that fails. */}
          {availKnown && availSlots.length === 0 ? (
            <>
              <Ghost label="Generate Open Slots · Next 4 Weeks" onPress={generateSlots} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>
                Add your hours above first — there is nothing to open yet.
              </Text>
            </>
          ) : (
            <Cta label="Generate Open Slots · Next 4 Weeks" wide onPress={generateSlots} />
          )}
          <View style={{ height: sp.sm }} />
          <Ghost label="Done" onPress={() => setAvailOpen(false)} />
        </View>
      </Modal>

      {/* ── block-out sheet ───────────────────────────────────────────────── */}
      <Modal visible={blockOpen} animationType="slide" transparent onRequestClose={() => setBlockOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBlockOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '82%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Block Out Time</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>
            {DOW[selDate.getDay()]} {selD} {MON_SHORT[selM]} — nobody can book across this, and any open slots inside it are withdrawn.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: sp.sm, paddingBottom: sp.md }}>
              <Chip t={t} label="All day" on={blkAllDay} onPress={() => setBlkAllDay(true)} />
              <Chip t={t} label="Part of the day" on={!blkAllDay} onPress={() => setBlkAllDay(false)} />
            </View>
            {!blkAllDay ? (<>
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm, marginBottom: sp.sm }}>From</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {HOURS.map((h) => (
                  <Chip key={'bf' + h} t={t} label={`${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`} on={blkFrom === h}
                    onPress={() => { setBlkFrom(h); if (blkTo <= h) setBlkTo(Math.min(24, h + 1)); }} />
                ))}
              </ScrollView>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Until</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {HOURS.filter((h) => h > blkFrom).concat([24]).map((h) => (
                  <Chip key={'bt' + h} t={t} label={hourLabel(h)} on={blkTo === h} onPress={() => setBlkTo(h)} />
                ))}
              </ScrollView>
            </>) : null}

            {/* ── how many days, and how many weeks ────────────────────────
                Both default to one, which is exactly what this sheet did
                before. A coach going away for a fortnight tapped through
                fourteen of these; a coach who never works Sunday blocked this
                Sunday and had to remember again next week.

                Not a device-calendar import: that needs `expo-calendar`, which
                is not a dependency, so it is a new native module and a new
                binary. The fourteen sheets were the actual pain and they need
                nothing new. */}
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm, marginBottom: sp.sm }}>How many days</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
              {[1, 2, 3, 5, 7, 10, 14, 21, 28].map((d) => (
                <Chip key={'bd' + d} t={t} label={d === 1 ? 'Just this day' : `${d} days`} on={blkDays === d}
                  onPress={() => setBlkDays(d)} />
              ))}
            </ScrollView>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Repeat weekly</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
              {[1, 2, 4, 6, 8, 12].map((w) => (
                <Chip key={'bw' + w} t={t} label={w === 1 ? 'No repeat' : `${w} weeks`} on={blkWeeks === w}
                  onPress={() => setBlkWeeks(w)} />
              ))}
            </ScrollView>
            <Text style={{ ...ty.caption, color: t.ink3, paddingBottom: sp.md }}>
              Each day is blocked on its own, so a day with a session already booked in it is refused and the rest
              still go through. You are told exactly which, and nothing is cancelled on your behalf.
            </Text>
          </ScrollView>
          <View style={{ height: sp.md }} />
          {/* `selDay`, never `selKey`. `selKey` is the GRID's key and is
              `${year}-${monthIndex}-${day}` with no padding — not a
              `YYYY-MM-DD`. Passing it here would make `blockDates` return
              nothing and disable the button forever, which is a bug that looks
              exactly like a broken screen. */}
          <Cta wide disabled={blkBusy || blockPlanLabel({
            from: selDay, days: blkDays, repeatWeeks: blkWeeks,
          }) === null}
            label={blkBusy
              ? 'Blocking…'
              // The button says what it will actually do. `blockPlanLabel`
              // counts the days the plan covers rather than multiplying the two
              // chips: a ten-day run repeated weekly overlaps itself and covers
              // seventeen days, not twenty, and a button promising twenty would
              // be wrong before it was pressed.
              : (blockPlanLabel({ from: selDay, days: blkDays, repeatWeeks: blkWeeks }) ?? 'Block This Day')
                + (blkAllDay ? '' : ` · ${hourLabel(blkFrom)} — ${hourLabel(blkTo)}`)}
            onPress={doBlock} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setBlockOpen(false)} />
        </View>
      </Modal>

      {/* ── both calendars, one list ──────────────────────────────────────
          Eight states now, and the two that both hold an empty list are still
          the reason this sheet is built round `combineBusy` rather than round
          `length === 0`. "Nothing in your diary" and "we were not allowed to
          look" are opposite sentences, and saying the first to a coach iOS or
          Google refused us is exactly the double booking this feature exists
          to prevent.

          S3 adds the way that gets subtle: the phone answers and finds nothing
          while Google fails. Two sources, one short list, and a sheet that
          counted rows would call the fortnight clear. `missing` is what keeps
          a source that did not answer from being read as one that found
          nothing — and it is shown whether the list is empty or not, because a
          coach looking at three real periods will otherwise take them for the
          whole week. */}
      <Modal visible={busyOpen} animationType="slide" transparent onRequestClose={() => setBusyOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBusyOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '82%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Block Time From Your Calendar</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>
            {`From ${DOW[selDate.getDay()]} ${selD} ${MON_SHORT[selM]}, for the next ${busyDays} days.`}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {(() => {
              const { view, missing } = combineBusy(busySources, busyAsked, busyCands.length);
              if (view === 'unavailable') {
                // No source at all: no native calendar in this binary and no
                // Google account linked. The app's own sentence for the first
                // half, not a second one written here — two sentences for one
                // state is how they drift apart.
                return (<>
                  <Flag tone={t.warn}>{CALENDAR_UNAVAILABLE_NOTE}</Flag>
                  {CALENDAR_SYNC_CONFIGURED ? (
                    <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
                      A Google calendar can be connected instead, and that needs no new build. Close this and open
                      Google Calendar under Manage.
                    </Text>
                  ) : null}
                </>);
              }
              const missNote = missingSourceNote(missing);
              return (<>
                {/* The promise, above the button that raises the system
                    prompt — so a coach reads what will be taken off their
                    calendar BEFORE deciding, rather than afterwards. The
                    usage strings in app.json say the same thing to iOS. */}
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{BUSY_PRIVACY_NOTE}</Text>
                {/* And the same promise for the calendar that is not on the
                    phone, said only when there is one. It names the limit as
                    well as the guarantee: the permission Repple holds cannot
                    read a title, and it cannot see a second calendar either. */}
                {syncLink.connected ? (
                  <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{REMOTE_SCOPE_NOTE}</Text>
                ) : null}
                {view === 'denied' || view === 'failed'
                  ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{BUSY_NOTES[view]}</Flag>
                  : <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{BUSY_NOTES[view]}</Text>}
                {/* Shown under EVERY view, including 'list'. A short list with
                    a calendar missing from it is the one that misleads. */}
                {missNote ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{missNote}</Flag> : null}

                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>How far ahead</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                  {[7, 14, 30].map((d) => (
                    <Chip key={'bz' + d} t={t} label={`${d} days`} on={busyDays === d}
                      onPress={() => { setBusyDays(d); if (busyAsked) void loadBusy(d); }} />
                  ))}
                </ScrollView>

                {busyCands.map((c, i) => {
                  const on = busyPicked.includes(c.key);
                  const opensDay = i === 0 || busyCands[i - 1].day !== c.day;
                  return (
                    <View key={c.key}>
                      {opensDay ? (
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: i === 0 ? sp.sm : sp.md, marginBottom: sp.sm }}>
                          {fmtDay(c.day)}
                        </Text>
                      ) : null}
                      {!opensDay ? <Rule /> : null}
                      {/* The row shows a time and a count of entries. There is
                          nothing else to show: no title was ever read, from
                          either calendar. It does not say WHICH calendar a
                          period came from either — the two are merged before
                          this point, so a period on both is one row and the
                          question has no answer worth printing. */}
                      <Pressable onPress={() => toggleBusyPick(c.key)}
                        accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                        accessibilityLabel={`${fmtDay(c.day)}, ${candidateTimeLabel(c)}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                        <Icon name={on ? 'check' : 'plus'} size={16} color={on ? t.brand : t.ink3} />
                        <Text style={{ ...ty.body, ...numeric, fontWeight: on ? '500' : '400', color: t.ink, flex: 1 }}>
                          {candidateTimeLabel(c)}
                        </Text>
                        {c.entries > 1 ? (
                          <Text style={{ ...ty.caption, color: t.ink3 }}>{`${c.entries} entries`}</Text>
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })}

                {view === 'list' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.md, paddingBottom: sp.md }}>
                    {/* This used to end "nothing is written back to your
                        calendar", which was true of S6 and is not true of a
                        coach who has turned writing on. A promise that goes
                        stale the moment a switch is moved is worse than none,
                        so the sentence now says what is actually happening on
                        this account. */}
                    {syncLink.writeEnabled && syncLink.hasWriteCalendar
                      ? 'Each period is blocked on its own, so one with a session already booked in it is refused and the rest still go through. Your clients see only that you are unavailable, never the reason. Nothing here is written to your own calendar entries; Repple writes only into the separate calendar it made.'
                      : 'Each period is blocked on its own, so one with a session already booked in it is refused and the rest still go through. Your clients see only that you are unavailable, never the reason, and nothing is written back to your calendar.'}
                  </Text>
                ) : null}
              </>);
            })()}
          </ScrollView>
          <View style={{ height: sp.md }} />
          {/* Two buttons, never one that does both. Before anything is read the
              only action is asking; after it, the only action is blocking what
              the coach has actually ticked. The condition is "is there a source
              at all", not "is there a native calendar" — a coach with no
              expo-calendar in their binary and a linked Google account has a
              calendar to read. */}
          {busyCanRead && !busyAsked ? (
            <Cta label="Read My Calendar" wide onPress={() => { void loadBusy(busyDays); }} />
          ) : null}
          {busyCanRead && busyAsked && busyRead.status !== 'loading' && remoteRead.status !== 'loading' && busyCands.length === 0 ? (
            <Ghost label="Look Again" icon="swap" onPress={() => { void loadBusy(busyDays); }} />
          ) : null}
          {busyCands.length > 0 ? (
            <Cta wide disabled={busyBusy || busyBlockLabel(busyPicked.length) === null}
              label={busyBusy ? 'Blocking…' : (busyBlockLabel(busyPicked.length) ?? 'Block This Period')}
              onPress={doBlockFromCalendar} />
          ) : null}
          <View style={{ height: sp.sm }} />
          <Ghost label="Done" onPress={() => setBusyOpen(false)} />
        </View>
      </Modal>

      {/* ── Google Calendar ────────────────────────────────────────────────
          Two decisions, asked separately, because they are not the same
          decision. Reading when a coach is busy is a copy of a fact. Writing
          into their diary is somebody else's calendar, and this is the first
          thing this product has ever done to one.

          Which is why the second one runs its OWN Google consent. The grant
          that lets Repple make a calendar is not the grant that lets it read
          free time, and bundling them at sign-in would be asking for the power
          to write to somebody's diary in order to read it. The coach sees
          Google's own screen naming the new permission at the moment they ask
          for it, and not before. */}
      <Modal visible={syncOpen} animationType="slide" transparent onRequestClose={() => setSyncOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSyncOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Google Calendar</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>
            Keep your Repple availability and your own diary from disagreeing.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {(() => {
              const state = linkState({ configured: CALENDAR_SYNC_CONFIGURED, connecting: syncBusy, link: syncLink });
              // `isWhole(sessionsStatus)`, not nothing at all. `plannedEvents`
              // reads `sessions` with no status test, and under 'error' that
              // list is empty for want of a read — so a coach with a full
              // fortnight was told "there are 0 sessions in the next 28 days
              // to send", beside a Send button that `pushLabel(0)` had quietly
              // disabled with no reason given. Under 'partial' it was a
              // plausible short number, which is worse. `doPush` twenty lines
              // up already refuses this case and explains it at length; the
              // sentence the coach actually reads was the only part that had
              // not been told.
              const plannedKnown = isWhole(sessionsStatus);
              const planned = plannedKnown && syncLink.writeEnabled && syncLink.hasWriteCalendar ? plannedEvents().length : null;
              return (<>
                {/* 'error' is its own sentence and comes first. Every state
                    below it is a claim about the connection, and under 'error'
                    we do not have one to make. */}
                {syncStatus === 'error' ? (
                  <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                    Your Google connection could not be read just now, so what follows may be out of date. This is not
                    a statement that nothing is connected.
                  </Flag>
                ) : null}
                {state === 'unconfigured' || state === 'needs-reconnect'
                  ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{LINK_NOTES[state]}</Flag>
                  : <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{LINK_NOTES[state]}</Text>}

                <Rule />
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.sm }}>What Repple reads</Text>
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{REMOTE_SCOPE_NOTE}</Text>

                <Rule />
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.sm }}>What Repple writes</Text>
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{WRITE_PRIVACY_NOTE}</Text>

                {/* The toggle is only offered once there is a live connection
                    to hang it on. A grant with no refresh token is not one:
                    turning writing on would consent to a scope that stops
                    working within the hour. */}
                {state === 'connected' || state === 'two-way' ? (<>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                    <Chip t={t} label="Read only" on={!syncLink.writeEnabled}
                      onPress={() => { if (syncLink.writeEnabled && !syncBusy) void doSetWrite(false); }} />
                    <Chip t={t} label="Read and write" on={syncLink.writeEnabled}
                      onPress={() => { if (!syncLink.writeEnabled && !syncBusy) void doSetWrite(true); }} />
                  </ScrollView>
                  {syncLink.writeEnabled && !syncLink.hasWriteCalendar ? (
                    <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                      Writing is turned on but the calendar Repple writes into has not been made yet, so nothing is
                      being written. Choose read and write again to try.
                    </Flag>
                  ) : null}
                  {state === 'two-way' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                      {planned == null
                        ? `Your booked sessions go across on their own while this screen is open. Your Repple calendar could not be read in full just now, so this cannot say how many are waiting to go — that is a connection problem and not an empty diary. Open slots and blocked time are never written.`
                        : `Your booked sessions go across on their own while this screen is open, and there ${planned === 1 ? 'is 1 session' : `are ${planned} sessions`} in the next ${PUSH_DAYS} days to send. Open slots and blocked time are never written.`}
                    </Text>
                  ) : null}
                </>) : null}
              </>);
            })()}
          </ScrollView>
          <View style={{ height: sp.md }} />
          {/* One primary action at a time, and it names what it will do. */}
          {CALENDAR_SYNC_CONFIGURED && !syncLink.connected ? (
            <Cta wide disabled={syncBusy} label={syncBusy ? 'Connecting…' : 'Connect Google Calendar'}
              onPress={() => { void doConnectCalendar(); }} />
          ) : null}
          {CALENDAR_SYNC_CONFIGURED && syncLink.connected && !syncLink.hasRefresh ? (
            <Cta wide disabled={syncBusy} label={syncBusy ? 'Connecting…' : 'Connect Again'}
              onPress={() => { void doConnectCalendar(); }} />
          ) : null}
          {syncLink.connected && syncLink.writeEnabled && syncLink.hasWriteCalendar ? (
            /* Left LIVE when the sessions read is not whole, rather than
               disabled on a count of nothing. A grey button is the one answer
               that explains itself least; `doPush` refuses the tap and says
               why in a sentence a coach can act on. */
            <Cta wide disabled={pushBusy || (isWhole(sessionsStatus) && pushLabel(plannedEvents().length) === null)}
              label={pushBusy ? 'Sending…' : (isWhole(sessionsStatus) ? (pushLabel(plannedEvents().length) ?? 'Send Sessions') : 'Send Sessions')}
              onPress={() => { void doPush(true); }} />
          ) : null}
          {syncLink.connected ? (<>
            <View style={{ height: sp.sm }} />
            <Ghost label="Disconnect Google" icon="lock" onPress={doDisconnectCalendar} />
          </>) : null}
          <View style={{ height: sp.sm }} />
          <Ghost label="Done" onPress={() => setSyncOpen(false)} />
        </View>
      </Modal>

      {/* ── add-session sheet ─────────────────────────────────────────────── */}
      {/* ── move a booked session ────────────────────────────────────────
          A DAY and the times on it, rather than a list of already-published
          open slots. An open slot is one kind of time here and no longer the
          only kind: `MoveTime.slotId` decides which of the two server functions
          runs, and a coach asked for 8am is given 8am instead of being sent to
          Weekly Availability to publish it to their whole roster first.

          Every time listed makes exactly one claim — nothing of this coach's is
          in it — checked against the same three obstacles the server checks.
          See src/lib/moveTimes.ts. */}
      <Modal visible={!!moveFrom} animationType="slide" transparent onRequestClose={closeMove}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={closeMove} />
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34, maxHeight: '85%', ...elevation.e2 }}>
          {moveFrom && moveDay ? (
            <>
              <Text style={{ ...ty.head, color: t.ink }}>Move Session</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
                {slotOf(moveFrom.clientId)} · {DOW[new Date(moveFrom.startsAt).getDay()]} {timeLabel(moveFrom.startsAt)}
              </Text>
              <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.md }}>
                Pick a day and a time. The session moves in one go, nothing is charged, and the credit already on it moves with it. The hour you are leaving goes to whoever is first on its waitlist, once your client is in their new one.
              </Text>

              {/* The day. Fourteen of them from today, because a move is nearly
                  always this week and a month picker in a sheet is a second
                  calendar to get wrong. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {moveDays.map((d) => (
                  <Chip key={dayKey(d.toISOString())} t={t} label={dateOfLabel(d)}
                    on={dayKey(d.toISOString()) === dayKey(moveDay.toISOString())}
                    onPress={() => setMoveDayKey(dayKey(d.toISOString()))} />
                ))}
              </ScrollView>

              {/* An unread calendar is not a coach with no free hours, and this
                  is the sheet where believing that would send them back to
                  Cancel. */}
              {!known ? (
                <Flag tone={t.warn}>Your calendar could not be read, so the hours you have free are not known. Nothing is listed below because nothing came back. Pull down to refresh and try again.</Flag>
              ) : moveOptions.length === 0 ? (
                // Four states, not one. Three of them are reads that have not
                // finished or have failed, and only the fourth is a claim about
                // the coach's day. `emptyMoveTimesLine` holds all four and this
                // screen decides none of them.
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {emptyMoveTimesLine(sessionsStatus, dateOfLabel(moveDay), moveWork.length > 0)}
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {([
                    ['', moveGroups.inHours],
                    // Offered, and offered second. A coach who wants 5am can
                    // have it; a coach looking for 8am should not have to read
                    // past it. The heading is withheld when the coach has set
                    // no hours for the day, because there is nothing to be
                    // outside of and the sentence would be about a working day
                    // this screen invented.
                    [moveWork.length ? 'Outside your working hours' : '', moveGroups.outside],
                  ] as const).map(([heading, list], gi) => (
                    list.length === 0 ? null : (
                      <View key={`g${gi}`}>
                        {heading ? (
                          <Text style={{ ...ty.micro, color: t.ink3, marginTop: gi > 0 ? sp.lg : 0, marginBottom: sp.sm }}>
                            {heading}
                          </Text>
                        ) : null}
                        {list.map((o) => (
                          <Pressable key={o.startMs} disabled={moveBusy}
                            onPress={() => {
                              const slot = o.slotId ? openSlots.find((x) => x.id === o.slotId) : null;
                              // The proven path when the hour is genuinely one
                              // the coach published, and part 1830 otherwise.
                              // A slot that has vanished from this device's copy
                              // between the list and the tap falls through to
                              // the time-based move, which is correct: the coach
                              // asked for that hour either way.
                              if (slot) confirmMove(moveFrom, slot);
                              else confirmMoveAt(moveFrom, o);
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: moveBusy, busy: moveBusy }}
                            hitSlop={hitSlopFor(MIN_TARGET)}
                            accessibilityLabel={`Move to ${dateOfLabel(moveDay)} at ${timeLabel(o.startsAt)}${o.slotId ? ', an hour you have already opened' : ''}`}
                            style={{ minHeight: MIN_TARGET, paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                            <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink, flex: 1 }}>
                              {timeLabel(o.startsAt)}
                            </Text>
                            {/* Said rather than left to be inferred: this hour
                                is already published, so moving into it takes a
                                slot off the coach's booking screen instead of
                                putting a new one in the diary. */}
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {o.slotId ? 'Already open' : `${moveFrom.durationMin}min`}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )
                  ))}
                </ScrollView>
              )}

              {/* What the list above cannot promise. Withheld entirely when
                  both reads were whole, because a caveat on every sheet is a
                  caveat nobody reads. */}
              {known && moveOptions.length > 0 && moveCaveat ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>{moveCaveat}</Flag>
              ) : null}
              <View style={{ height: sp.lg }} />
              <Ghost label="Cancel" onPress={closeMove} />
            </>
          ) : null}
        </View>
      </Modal>

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34, ...elevation.e2 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.surface3, alignSelf: 'center', marginBottom: sp.lg }} />
            <Text style={{ ...ty.head, color: t.ink }}>Add Session</Text>
            {/* The month-first order was as English as the words were. `dateOfLabel`
                writes the day the way the reader's locale does. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>{dateOfLabel(selDate)}</Text>

            {/* ── what is already on this day ──────────────────────────────
                The sheet named the date and showed nothing that was on it, so
                a coach picking a time was choosing blind and finding out from
                the overlap refusal afterwards. The day sheet under the
                calendar has had this all along; the screen where it decides
                something did not.

                Three states, not two: a diary that could not be read is not a
                free day, and offering "nothing booked" over an unread one is
                how a coach double-books themselves. */}
            <View style={{ marginBottom: sp.lg }}>
              {!known ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Your calendar could not be read, so this does not show what you already have on. Anything
                  already booked is still there and an overlap will be refused.
                </Text>
              ) : selDaySessions.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Nothing on this day yet.</Text>
              ) : (
                <>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>
                    Already on this day · {selDaySessions.length}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
                    {selDaySessions.map((s2) => (
                      <View key={'ad' + s2.id} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: radius.pill, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring }}>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>
                          {timeLabel(s2.startsAt)} · {s2.status === 'booked' ? nameOf(s2.clientId) : s2.status === 'blocked' ? 'Blocked' : 'Open'}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Time · {avTime(addHour, addMinute)}</Text>
            <View style={{ marginBottom: sp.lg }}>
              <TimeGrid t={t} hour={addHour} minute={addMinute} onHour={setAddHour} onMinute={setAddMinute} />
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Duration</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {DURS.map((d) => {
                const sel = d === addDur;
                return (
                  <View key={d} style={{ flex: 1 }}>
                    <Pressable onPress={() => setAddDur(d)} accessibilityRole="button" accessibilityState={{ selected: sel }}
                      style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: sel ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.label, ...numeric, fontWeight: sel ? '500' : '400', color: sel ? t.brandInk : t.ink2 }}>{d}m</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Client</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
              <Chip t={t} label="Open Slot" on={addClient === null} onPress={() => setAddClient(null)} />
              {roster.map((c) => <Chip key={c.id} t={t} label={c.name} on={c.id === addClient} onPress={() => setAddClient(c.id)} />)}
            </View>
            {/* Reported as "nowhere here does it allow me to select a client".
                With an empty roster this row rendered ONE chip — Open Slot —
                and said nothing, which reads as the feature being missing
                rather than as there being nobody to book. And an empty roster
                has three quite different causes that must not look alike: it
                is still loading, the read failed, or there genuinely is
                nobody. */}
            {roster.length === 0 ? (
              rosterStatus === 'error' ? (
                <Flag tone={t.warn} style={{ marginBottom: sp.xl }}>
                  Your clients could not be read, so none can be listed here. This is a connection problem, not an empty book — you can still add an open slot.
                </Flag>
              ) : (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                  {rosterStatus === 'loading'
                    ? 'Reading your clients…'
                    : 'No clients on your roster yet, so there is nobody to book. Add one from the Clients tab, or leave this as an open slot for somebody to take.'}
                </Text>
              )
            ) : rosterStatus === 'partial' ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>
                Part of your roster did not load, so somebody may be missing from this list.
              </Text>
            ) : <View style={{ marginBottom: sp.xl }} />}

            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setAddOpen(false)} /></View>
              <View style={{ flex: 2 }}><Cta label={addClient ? 'Book Session' : 'Add Open Slot'} wide onPress={handleAdd} /></View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── standing-appointment sheet ────────────────────────────────────── */}
      <Modal visible={seriesOpen} animationType="slide" transparent onRequestClose={() => setSeriesOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSeriesOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Standing appointment</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
            The same client at the same time every week. Repple books it {Math.round(SERIES_HORIZON_DAYS / 7)} weeks ahead and keeps going from there on its own.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Field label="Client">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {roster.map((c) => (
                  <Chip key={c.id} t={t} label={c.name} on={c.id === srClient} onPress={() => setSrClient(c.id)} />
                ))}
              </View>
            </Field>
            {/* There is no "open slot" here and there cannot be: an arrangement
                is between two named people, and `create_session_series` refuses
                anybody who is not this coach's client with a 42501. An empty
                roster has three quite different causes and they must not look
                alike. */}
            {roster.length === 0 ? (
              rosterStatus === 'error' ? (
                <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                  Your clients could not be read, so none can be listed. This is a connection problem, not an empty book — pull down on the calendar to refresh and try again.
                </Flag>
              ) : (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  {rosterStatus === 'loading'
                    ? 'Reading your clients…'
                    : 'No clients on your roster yet, so there is nobody to arrange this with. Add one from the Clients tab.'}
                </Text>
              )
            ) : rosterStatus === 'partial' ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Part of your roster did not load, so somebody may be missing from this list.
              </Text>
            ) : null}

            <View style={{ height: sp.lg }} />
            <Field label="Day">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
                {DOW.map((d, i) => <Chip key={d} t={t} label={d} on={srDow === i} onPress={() => setSrDow(i)} />)}
              </ScrollView>
            </Field>

            <View style={{ height: sp.lg }} />
            {/* The same control the other two sheets use. Quarter hours across
                all twenty-four, because `session_series_minute_chk` accepts
                exactly those four minutes and a coach's day starts when their
                first client's does. */}
            <Field label="Time" hint={avTime(srHour, srMinute)}>
              <TimeGrid t={t} hour={srHour} minute={srMinute} onHour={setSrHour} onMinute={setSrMinute} />
            </Field>

            <View style={{ height: sp.lg }} />
            <Field label="Length" hint="minutes">
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                {DURS.map((d) => (
                  <View key={d} style={{ flex: 1 }}>
                    <Pressable onPress={() => setSrDur(d)} accessibilityRole="button"
                      accessibilityState={{ selected: d === srDur }} accessibilityLabel={`${d} minutes`}
                      style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: d === srDur ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.label, ...numeric, fontWeight: d === srDur ? '500' : '400', color: d === srDur ? t.brandInk : t.ink2 }}>{d}m</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Field>

            <View style={{ height: sp.xl }} />
            {/* The two things a coach is owed before they agree to this, in the
                words src/lib/recurring holds so the apps and the database
                cannot come to describe it differently. */}
            <Flag tone={t.ink3}>{RECURRING_CREDIT_NOTE}</Flag>
            <View style={{ height: sp.sm }} />
            <Flag tone={t.ink3}>{RECURRING_CLASH_NOTE}</Flag>
            {!devTz ? (<>
              <View style={{ height: sp.sm }} />
              <Flag tone={t.warn}>
                This device can’t say what time zone it is in, and a weekly appointment has to be stored against one — otherwise seven in the morning quietly becomes six or eight the Sunday the clocks move. Set the zone in your phone’s settings and come back.
              </Flag>
            </>) : null}
          </ScrollView>
          <View style={{ height: sp.lg }} />
          <Cta wide disabled={!srClient || !devTz || srBusy}
            label={srBusy
              ? 'Setting It Up…'
              : srClient
                ? `Book Every ${DOW_NAMES[srDow]} at ${avTime(srHour, srMinute)}`
                : 'Pick a Client First'}
            onPress={() => { void createSeriesNow(); }} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setSeriesOpen(false)} />
        </View>
      </Modal>

      {/* ── cancel one, or end the arrangement ────────────────────────────────
          THE TWO OPTIONS ARE NEVER COLLAPSED INTO ONE BUTTON, and neither of
          them is the default. Cancelling one occurrence is an ordinary
          cancellation of an ordinary session; ending the arrangement charges
          nothing, ever, and deliberately leaves the next occurrence standing.
          A coach who taps "cancel" and silently ends a standing agreement, or
          who ends one and unexpectedly bills a client, is the failure this
          sheet exists to prevent — so each option carries what confirming it
          actually does, in words, above its own button. */}
      <Modal visible={!!endFor} animationType="slide" transparent onRequestClose={() => setEndFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEndFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          {endFor ? (<>
            <Text style={{ ...ty.head, color: t.ink }}>One session, or the arrangement?</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              {seriesLabel(endFor)} with {seriesWho(endFor)}. These are two different things and they do two different things.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {endOptions.map((o, i) => (
                <View key={o.scope}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{o.label}</Text>
                    {/* The series sentence is printed exactly as the module
                        writes it. It is the statement of the rule, it names no
                        amount and no currency, and every branch of it says what
                        ending costs — which is nothing. */}
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: 5 }}>
                      {o.scope === 'series' ? o.detail : occurrenceLine(o, endFor)}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5 }}>
                      {o.affects === 1 ? 'Affects 1 booked session.' : `Affects ${o.affects} booked sessions.`}
                    </Text>
                    <View style={{ marginTop: sp.md }}>
                      {o.scope === 'series' ? (
                        <Ghost label={endBusy ? 'Ending…' : 'End the Standing Appointment'}
                          onPress={() => { if (!endBusy) void endSeriesNow(endFor); }} />
                      ) : endNext ? (
                        // The ordinary cancel button, on the ordinary session,
                        // through the ordinary path — the same call the day
                        // list makes. A second cancellation path written here
                        // is how the two would come to price the same tap
                        // differently.
                        // The confirm is fired after the sheet has finished
                        // dismissing, not in the same tick. An iOS alert raised
                        // while a modal is animating away is presented from a
                        // view controller that is on its way out and never
                        // appears — and the tap that vanishes on this button is
                        // a coach who then reaches for the other one.
                        <Ghost label="Cancel That Session Only"
                          onPress={() => { const one = endNext; setEndFor(null); setTimeout(() => confirmCancel(one), 350); }} />
                      ) : (
                        <Flag tone={t.warn}>
                          {!endFor.nextAt
                            ? 'There is no next session on the books to cancel — either it has not been written out yet, or it has already been cancelled.'
                            : !known
                              ? 'Your calendar could not be read, so that session cannot be found to cancel. This is a connection problem — pull down to refresh and try again. The arrangement itself is untouched.'
                              : 'That session is not among the ones this screen has loaded. Open its day on the calendar above and cancel it from there.'}
                        </Flag>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ height: sp.lg }} />
            {/* The only emphasised button on the sheet is the one that does
                nothing. Neither of the two above may be the default: one of
                them ends an arrangement two people made. */}
            <Cta label="Change Nothing" wide onPress={() => setEndFor(null)} />
          </>) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
