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
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost, Flag, Field, fig } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';
import { insideNoticeWindow, feeAmountLine, noticeLabel, type CancellationPolicy } from '../../src/lib/booking';
import { useSessions, useSessionWaitlistCounts, useLateCancelCharges, useMyCancellationPolicy, promoteWaitlist } from '../../src/ui/sessions';
import { useAvailability, upcomingDates, useRecurringSeries, deviceTimeZone } from '../../src/ui/availability';
import {
  DOW_NAMES, SERIES_HORIZON_DAYS, SERIES_MINUTES, RECURRING_CLASH_NOTE, RECURRING_CREDIT_NOTE,
  cancelOptions, clashLine, createdLine, seriesLabel,
  type CancelOption, type RecurringSeries,
} from '../../src/lib/recurring';
import { useRoster } from '../../src/ui/roster';
import type { TrainingSession } from '../../src/lib/types';
import { buildIcs, shareIcs } from '../../src/lib/exportShare';
import { sendPushChecked } from '../../src/ui/pushNotifications';
import { markOutcome } from '../../src/lib/gymSessions';
import { supabase } from '../../src/lib/supabase';
import { useTenant } from '../../src/ui/tenant';
import { reportError } from '../../src/lib/reportError';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
// Paging back into a month the read never reached must not draw an empty grid.
// See `monthNote` below. Surgical addition alongside the calendar-sync work in
// this file — three lines of state and one Flag under the grid, nothing else.
import { readBoundary, monthCoverage, monthCoverageNote } from '../../src/lib/sessionHistory';
import { appLocale } from '../../src/lib/locale';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { useCoachReminders } from '../../src/ui/coachReminders';
import {
  blockDates, summariseBlocks, blockSummaryLine, blockPlanLabel,
  type BlockOutcome, type BlockResult,
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
  LINK_NOTES, NO_CALENDAR_LINK, REMOTE_SCOPE_NOTE, WRITE_PRIVACY_NOTE,
  type BusySourceState, type CalendarLink, type SyncSource,
} from '../../src/lib/calendarSync';
import {
  CALENDAR_SYNC_CONFIGURED, connectGoogleCalendar, disconnectGoogleCalendar,
  pushAgainSoon, pushIsDue, pushSessions, readCalendarLink, readRemoteBusy,
  setCalendarWrite, type RemoteBusyRead,
} from '../../src/ui/calendarSync';
import { BRAND } from '../../src/lib/brands';
import { fmtDay } from '../../src/lib/format';
import { useAuth } from '../../src/ui/auth';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function timeLabel(iso: string) {
  const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  const m = d.getMinutes(); return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}
/** "Tue 8 Sep" — the way every other date on this screen is written. */
function dateLabel(iso: string) {
  const d = new Date(iso);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}`;
}

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
  const now = new Date();
  const router = useRouter();
  const { sessions, status: sessionsStatus, addSession, releaseSession, removeSession, refresh } = useSessions();
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
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const { roster, status: rosterStatus } = useRoster();
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
  // The fee was recorded by the CLIENT's cancellation, on their phone, and the
  // waitlist moved with it. Neither shows up here without asking again.
  useFocusEffect(useCallback(() => { reloadFees(); }, [reloadFees]));
  const { tenant } = useTenant();
  const nameOf = (id: string | null) => roster.find((c) => c.id === id)?.name ?? 'Open slot';

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
  const { slots: availSlots, status: availStatus, addSlot: addAvail, removeSlot: removeAvail } = useAvailability();
  /** Whether `availSlots` is the whole of this coach's week. Under 'partial'
   *  the slots listed are real but there are more, so it is still not a set
   *  anything may be counted from or declared empty. */
  const availKnown = isWhole(availStatus);
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
  useFocusEffect(useCallback(() => { reloadSeries(); }, [reloadSeries]));
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
    for (const sl of availSlots) {
      for (const d of upcomingDates(sl.dow, sl.hour, sl.minute, 4)) {
        const iso = d.toISOString();
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
    if (lost) lines.push(lost + ' slot' + (lost === 1 ? '' : 's') + ' could not be saved to the server, so ' + (lost === 1 ? 'it is' : 'they are') + ' not open to anyone. Try generating again.');
    Alert.alert(added ? 'Slots generated' : 'No slots opened', lines.join('\n\n'));
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
    for (const day of dayList) {
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
      results.push({ day, outcome, withdrawn });
    }
    setBlkBusy(false);

    // ONE alert for the whole run, naming each kind of outcome. A fortnight
    // produces a mixture, and the two sentences a coach must never be shown are
    // "blocked" while four days are still bookable and "not blocked" while ten
    // were. Both describe a diary that is not the diary — and a coach skimming
    // an alert takes the SHAPE of it, so the title changes too.
    const summary = summariseBlocks(results);
    setBlockOpen(false);
    await refresh();
    Alert.alert(
      summary.blocked === 0 ? 'Nothing blocked' : summary.needsAttention ? 'Partly blocked' : 'Time blocked',
      blockSummaryLine(summary),
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
  const plannedEvents = () => {
    const w = pushWindow();
    return plannedSyncEvents(sessions, w.fromMs, w.toMs);
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
    const events = plannedSyncEvents(sessions, w.fromMs, w.toMs);
    setPushBusy(true);
    const out = await pushSessions(events, w.fromMs, w.toMs);
    setPushBusy(false);
    if (!announce) return;
    if (!out.ok) Alert.alert('Not sent', out.reason);
    else Alert.alert('Sent to Google', pushSummaryLine(out.result));
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
    const res = addSession(s);
    if (!res.ok) {
      Alert.alert('Time not available', `You already have a session that overlaps ${timeLabel(s.startsAt)} on ${DOW[selDate.getDay()]} ${selD}/${selM + 1}. Pick another time.`, [{ text: 'OK' }]);
      return;
    }
    setAddOpen(false);
    if (!addClient) return;
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
          : `We couldn't send ${who} a notification${push.error ? ` (${push.error})` : ''}, so message them to let them know.`),
      [{ text: 'Great' }],
    );
  }

  async function doCancel(s: TrainingSession) {
    const others = roster.filter((c) => c.id !== s.clientId).map((c) => c.name);
    // Free the slot first, and only say so if the server actually freed it.
    // This was fired and forgotten, and the roster was then pushed "first to
    // book it gets it" about a session that was still booked — so the quickest
    // client to respond was the one turned away.
    const freed = await releaseSession(s.id);
    if (!freed) {
      Alert.alert(
        'Not cancelled',
        `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} is still booked — that did not save, so nothing has changed and nobody has been told. Try again.`,
        [{ text: 'OK' }],
      );
      return;
    }

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
    let offered: boolean | null = null;
    if (promoted) {
      promotedTold = (await sendPushChecked([promoted], 'The slot you were waiting for is yours', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} freed up and you were next on the list — it is booked for you.`, { route: '/(client)/calendar' })).ok;
    } else {
      const openTo = roster.filter((c) => c.id !== s.clientId).map((c) => c.id);
      offered = openTo.length
        ? (await sendPushChecked(openTo, 'A slot just opened', `${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is available — first to book it gets it.`, { route: '/(client)/calendar' })).ok
        : null;
    }

    Alert.alert(
      'Session cancelled',
      `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} was cancelled.\n\n` +
      (toldClient.ok
        ? `${nameOf(s.clientId)} was sent a notification. `
        : `We couldn’t notify ${nameOf(s.clientId)} — tell them yourself, especially if this session is soon. `) +
      (promoted
        ? `The hour went straight to the next client on its waitlist${promotedTold === false ? ', though we couldn’t notify them — tell them yourself.' : ' and they have been told. Nobody had to race for it.'}`
        : `The slot is open again on your calendar. ` +
          (offered === null
            ? 'You have no other clients to offer it to.'
            : offered
            ? `Your ${others.length} other client${others.length === 1 ? '' : 's'} ${others.length === 1 ? 'was' : 'were'} told it is free (${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}) — first to book takes it.`
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
    const who = nameOf(c.clientId);
    if (c.waivedAt) {
      Alert.alert('Reinstate this fee?', `${sum} against ${who} would go back to outstanding.`, [
        { text: 'Leave waived', style: 'cancel' },
        { text: 'Reinstate', onPress: async () => {
          const ok = await unwaiveFee(c.id);
          if (!ok) Alert.alert('Not reinstated', 'That did not save, so the fee is still waived. Try again.', [{ text: 'OK' }]);
        } },
      ]);
      return;
    }
    Alert.alert('Waive this fee?', `${sum} against ${who} would be marked as forgiven. The record stays — it shows as waived rather than disappearing — and neither of you owes anything on it.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Waive', onPress: async () => {
        // A zero-row update is a success in PostgREST. `waiveFee` counts the
        // rows it changed, so a coach is never told they forgave a fee that
        // is still standing against their client.
        const ok = await waiveFee(c.id);
        if (!ok) Alert.alert('Not waived', `That did not save, so ${sum} is still outstanding against ${who}. Try again.`, [{ text: 'OK' }]);
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
  function confirmCancel(s: TrainingSession) {
    const d = new Date(s.startsAt);
    Alert.alert('Cancel this session?', `${timeLabel(s.startsAt)} with ${nameOf(s.clientId)} on ${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}.`, [
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
    Alert.alert(
      'Slot re-offered',
      `All ${ids.length} of your client${ids.length === 1 ? '' : 's'} ${ids.length === 1 ? 'was' : 'were'} sent a notification that ${when} is free — first to book takes it. Delivery depends on their notification settings.`,
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
    Alert.alert('Re-offer this slot?', `Push all ${ids.length} of your clients that ${timeLabel(s.startsAt)} on ${DOW[new Date(s.startsAt).getDay()]} is open to book.`, [
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
   */
  const checkIn = async (s: TrainingSession) => {
    if (!s.clientId) return;
    const who = nameOf(s.clientId);
    try {
      await markOutcome(supabase, s.id, 'completed', tenant?.sessionFee != null ? tenant.sessionFee * 100 : undefined);
    } catch (e) {
      reportError('calendar.checkIn', e, { sessionId: s.id });
      Alert.alert('Not checked in', `${who} was not marked present — that did not save. Check your connection and try again.`);
      return;
    }
    router.push({ pathname: '/(trainer)/client', params: { clientId: s.clientId, name: who, checkedIn: '1' } });
  };

  const exportSchedule = async () => {
    const evts = booked.map((s) => ({ start: s.startsAt, durationMin: s.durationMin, title: `Session · ${nameOf(s.clientId)}` }));
    await shareIcs(buildIcs(evts, 'Repple — Coaching schedule'), 'repple-schedule.ics', 'Export your schedule');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

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
                  : `${open.length} open slot${open.length === 1 ? '' : 's'} · ${Math.round((booked.length / totalSlots) * 100)}% of your slots are filled`}
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
            note={`Book a client or open a slot on ${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)}`}
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
            note={`Mark ${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)} as unavailable so nobody can book it`}
            onPress={() => setBlockOpen(true)} />
          {/* The row is offered on every build, including the ones that cannot
              do it. HAS_NATIVE_CALENDAR is false on every install made before
              expo-calendar landed — the version was deliberately not moved, so
              those installs receive this JavaScript and none of the native
              half — and hiding the row there would leave a coach reading a
              release note about a feature they cannot find. The note says what
              is missing instead, and the sheet says it again in full. */}
          <ListRow icon="calendar" title="Block Time From Your Calendar"
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
          <SectionHead title={`${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)}`} note="Add"
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
                    : 'No sessions this day. Tap Add to book one.'}
              </Text>
            )
          ) : selDaySessions.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ paddingVertical: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'booked' ? t.brand : s.status === 'blocked' ? t.warn : t.surface3 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.status === 'booked' ? nameOf(s.clientId) : s.status === 'blocked' ? 'Unavailable · nobody can book this' : (s.released ? 'Open · re-offered' : 'Open slot')}</Text>
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
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, marginLeft: sp.md + 6 }}>
                  {s.status === 'booked' ? (<>
                    {/* Check in is the start of the session, and it is the one
                        thing a coach does standing next to somebody. It marks
                        them present and opens their record — the overview
                        first, because what you want thirty seconds before a
                        session is what they did last time and what they cannot
                        do. Entering the exercises is one tap on from there,
                        and lands in the client's OWN record, so it reaches
                        their app rather than staying on the coach's screen. */}
                    <View style={{ flex: 1 }}><Cta label="Check In" wide onPress={() => checkIn(s)} /></View>
                    <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => confirmCancel(s)} /></View>
                  </>) : s.status === 'blocked' ? (
                    <View style={{ flex: 1 }}><Ghost label="Free This Time Up" onPress={() => removeOpen(s)} /></View>
                  ) : (<>
                    <View style={{ flex: 1 }}><Ghost label="Re-offer" onPress={() => reoffer(s)} /></View>
                    <View style={{ flex: 1 }}><Ghost label="Remove" onPress={() => removeOpen(s)} /></View>
                  </>)}
                </View>
              </View>
            </View>
          ))}
        </Section>

        <Rule />

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
            {availSlots.map((sl, i) => (
              <View key={sl.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <Icon name="clock" size={16} color={t.brand} />
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink, flex: 1 }}>{DOW[sl.dow]} · {avTime(sl.hour, sl.minute)} · {sl.dur}min</Text>
                  <Pressable onPress={() => removeAvail(sl.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${DOW[sl.dow]} slot`}>
                    <Icon name="minus" size={16} color={t.ink3} />
                  </Pressable>
                </View>
              </View>
            ))}

            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.md }}>Add a weekly slot</Text>
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
          </ScrollView>
          <View style={{ height: sp.lg }} />
          <Cta label="Generate Open Slots · Next 4 Weeks" wide onPress={generateSlots} />
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
            {DOW[selDate.getDay()]} {selD} {MON[selM].slice(0, 3)} — nobody can book across this, and any open slots inside it are withdrawn.
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
            {`From ${DOW[selDate.getDay()]} ${selD} ${MON[selM].slice(0, 3)}, for the next ${busyDays} days.`}
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
              const planned = syncLink.writeEnabled && syncLink.hasWriteCalendar ? plannedEvents().length : 0;
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
                      {`Your booked sessions go across on their own while this screen is open, and there ${planned === 1 ? 'is 1 session' : `are ${planned} sessions`} in the next ${PUSH_DAYS} days to send. Open slots and blocked time are never written.`}
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
            <Cta wide disabled={pushBusy || pushLabel(plannedEvents().length) === null}
              label={pushBusy ? 'Sending…' : (pushLabel(plannedEvents().length) ?? 'Send Sessions')}
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
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34, ...elevation.e2 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.surface3, alignSelf: 'center', marginBottom: sp.lg }} />
            <Text style={{ ...ty.head, color: t.ink }}>Add Session</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>{DOW[selDate.getDay()]}, {MON[selM]} {selD}</Text>

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
