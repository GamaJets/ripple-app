// Client · Standing Appointments. The same hour with the same coach every week,
// and the way out of it.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// `supabase/parts/135-a-standing-appointment.sql` stores the ARRANGEMENT and a
// daily job writes it out as ordinary booked sessions eight weeks ahead. Both
// halves of the feature shipped for the coach: `my_session_series()` and
// `end_session_series()` are scoped by `auth.uid()` and answer for EITHER
// party, and part 135 says in as many words that either party may end one —
// "an agreement one side cannot leave is not one". The client app had neither.
//
// So a member with a standing Tuesday at seven watched sessions appear on their
// calendar, week after week, from a thing they could not see, could not name
// and could not leave. The only exit they had was to cancel each occurrence one
// at a time — which is the single most expensive way to do it, because each of
// those is an ordinary cancellation and each one inside the coach's notice
// window records its own late fee.
//
// ── THE RULE THIS SCREEN IS BUILT AROUND ──────────────────────────────────
//
// CANCELLING ONE OCCURRENCE AND ENDING THE ARRANGEMENT ARE DIFFERENT ACTS WITH
// DIFFERENT PRICES, AND THEY ARE NEVER COLLAPSED INTO ONE BUTTON.
//
//   · Cancelling one occurrence is an ordinary cancellation. It goes through
//     `cancel_my_session` (part 126) by way of `cancelBookedSession`, the same
//     helper the Book screen and My Bookings call, so the same tap on the same
//     session costs the same money wherever it was made. Inside the notice
//     window it records ONE late fee. The rest of the arrangement is untouched.
//   · Ending the arrangement charges NOTHING, ever, under every policy and
//     every notice window, and it deliberately LEAVES THE NEXT OCCURRENCE
//     BOOKED. "We'll stop after next Tuesday" is what ending a standing
//     appointment means to the two people in it.
//
// Both are offered together, each with what confirming it actually does written
// above its own button, and NEITHER IS THE DEFAULT. The only emphasised control
// on the sheet is the one that changes nothing. A member who taps "cancel" and
// silently ends an agreement, or who ends one and is unexpectedly billed, is
// the failure this screen exists to prevent.
//
// The words are `cancelOptions` in src/lib/recurring.ts rather than anything
// written here. That module is what src/lib/recurring.test.ts holds the promise
// against — ninety combinations of policy, window and count, none of which may
// charge for an ending — and a screen that phrased it itself would be free to
// drift from the thing being tested. Unlike the coach's copy of this sheet,
// `occurrenceDetail` IS the right voice here: it was written for the client,
// and it is their coach's policy and their money it describes.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { isWhole } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, Notice, PartialRead, PageHead } from '../../src/ui/kit';
import { sp, layout, radius, elevation, hairline, type as ty, numeric } from '../../src/theme/scale';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { useRecurringSeries, deviceTimeZone } from '../../src/ui/availability';
import {
  // `memberSeriesLabel`, not `seriesLabel`. The second is English and 12-hour
  // by construction — "Every Tuesday at 7:00 am" to a member in Milan, printed
  // directly above "Next Tue 09:00", which this screen already renders through
  // the app's own locale formatters. The hour is unchanged: it is the series'
  // own wall clock either way, and only the writing of it moves.
  cancelOptions, memberSeriesLabel as seriesLabel, seriesOccurrencesIn, RECURRING_CREDIT_NOTE, SERIES_HORIZON_DAYS,
  type CancelOption, type RecurringSeries,
} from '../../src/lib/recurring';
import {
  useSessions, cancelBookedSession, ptCancelLines, useCancellationPolicy, cancelWarningFor,
} from '../../src/ui/sessions';
import { useSeriesPauses, pauseSeries, pauseSeriesForDays, resumeSeries } from '../../src/ui/seriesPause';
import {
  pausePreviewLine, pauseOutcomeLines, pausedRangeLine, resumeConfirm, resumedLine,
  pauseRangeRefusal, pauseRangeConfirm,
} from '../../src/lib/reschedule';
import { DateSheet } from '../../src/ui/DateSheet';
import { todayParts, isoFromParts } from '../../src/lib/monthGrid';
import { insideNoticeWindow, noticeHoursOf } from '../../src/lib/booking';
import { useClientData } from '../../src/ui/clientData';
import { peerHeading } from '../../src/lib/threadPeer';
import { useThreadPeerName } from '../../src/ui/messaging';
import type { TrainingSession } from '../../src/lib/types';
import type { CancellationPolicy } from '../../src/lib/booking';
import { fmtRelativeDay, fmtTime, fmtClock, weekdayName, weekdayNameShort } from '../../src/lib/format';
// Asking for one. The member cannot CREATE a standing appointment — see the
// header of src/lib/standingAsk.ts and the 42501 in `create_session_series` —
// so the half of the feature that was missing is the request, and it goes down
// the rail this app already has for an hour a coach has not opened.
import {
  STANDING_ASK_RULE, NO_COACH_FOR_STANDING, standingAskNote, firstStandingDay, standingAskBlocker,
  // Whose clock the weekly hour is on. The condition this replaces was
  // `s.tz && devTz && s.tz !== devTz`, which is false three ways and only one
  // of them means the clocks agree — so "your coach is in your zone" and "this
  // phone could not say which zone it is in" were the same silent screen, over
  // a wall-clock hour somebody turns up to. See its own header.
  standingClockNote,
} from '../../src/lib/standingAsk';
import { askForSession } from '../../src/ui/sessionRequests';
import { askBlocker, askRefusalNote, askedConfirmation, ownDiaryNote, NOT_A_BOOKING } from '../../src/lib/sessionRequests';
import { sendPushChecked } from '../../src/ui/pushNotifications';
// Whether this phone can reach us. It decides the second half of the sentence
// printed when a cancellation does not land — see `cancelOne`.
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';

// The reader's own clock, deliberately. `nextAt` is an instant — the moment the
// session starts — and the member is being told when to turn up, which is a
// time where they are standing. The WEEKLY hour beside it is the opposite case
// and is handled the opposite way: see `seriesLabel` and the zone line below.
//
// The clock and the day are the reader's LOCALE's as well as their zone's now.
// `DOW` was a hardcoded English array and the fallback wrote day-before-month,
// so a member in the United States read "Wed 9/12" as 12 September when the
// session was 9 December — in the sentence above a cancel button. See
// `fmtRelativeDay` and `fmtClock` in src/lib/format.ts.
const timeLabel = (iso: string) => fmtTime(iso);
const dayLabel = (iso: string) => fmtRelativeDay(iso);

/** The hours a coach might be asked for, and the quarters inside one. The same
 *  grids app/(client)/request-session.tsx offers, because this is the same
 *  request going to the same person: a member who can ask for 07:15 on one
 *  screen and only 07:00 on the other has been given two different products. */
const ASK_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const ASK_MINUTES = [0, 15, 30, 45];
/** Sixty first, because it is what almost every one-to-one in this app is. */
const ASK_LENGTHS = [30, 45, 60, 90];

/**
 * A local instant from a local day and a local hour.
 *
 * Built from the PARTS with `new Date(y, m, d, h, min)` and never from a string
 * — `new Date('2026-09-15T18:00:00Z')` is UTC and would move a six o'clock
 * appointment by hours for most of the world, and `new Date('2026-09-15')` is
 * the bare-literal trap scripts/check-utc-day.mjs exists for. Null for a day
 * that will not read, so no caller can build an instant out of a hole.
 */
const instantOn = (day: string | null, hour: number, minute: number): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return null;
  const at = new Date(+m[1], +m[2] - 1, +m[3], hour, minute, 0, 0);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
};

export default function StandingAppointments() {
  const t = useTheme();
  const router = useRouter();
  const reach = useReachability();

  // One hook, both apps. `my_session_series()` is scoped by auth.uid() and
  // answers for whichever party is asking, so the arrangement this member sees
  // is the row their coach sees and the two cannot come to disagree about what
  // was agreed.
  const { series, status: seriesStatus, reload: reloadSeries, end: endSeries } = useRecurringSeries();
  // The occurrences themselves. A standing appointment's next session is an
  // ordinary booked session in `sessions`, which is why cancelling one needs
  // nothing this screen invented.
  const { sessions, status: sessionsStatus, cancelMyBooking, refresh: refreshSessions } = useSessions();
  // A failed read used to strand this screen for the whole session: the only
  // way to ask again was the Try Again button inside the failure notice, and
  // there is no such button on a screen that merely went stale. Pull to refresh
  // is the gesture people already try — see src/ui/pullToRefresh.tsx.
  // A fortnight away used to cost two separate cancellations, each priced on
  // its own notice, and there was no way to say "not for the next two weeks"
  // once. Pausing is that (supabase/parts/244): a hole in the arrangement the
  // materialiser respects, so the sessions do not quietly re-book themselves.
  const { pauses, status: pauseStatus, reload: reloadPauses } = useSeriesPauses();
  const [pauseFor, setPauseFor] = useState<RecurringSeries | null>(null);
  // ── "I am away from the 12th to the 26th" ────────────────────────────────
  //
  // The three fixed durations start from today, which covers a member who is
  // going away now and nobody who books a holiday in advance — and a holiday
  // booked in advance is the case pausing exists for. `pauseSeries` has taken a
  // from/to since supabase/parts/244 and nothing in the app could reach it.
  //
  // Two dates rather than a range control: `DateSheet` is the one date picker
  // in this app and it picks one day, so this picks twice. Both stay in local
  // `YYYY-MM-DD` and are never turned into a Date on the way — see
  // `pauseRangeRefusal`.
  const [fromOn, setFromOn] = useState('');
  const [toOn, setToOn] = useState('');
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  // The fourth read on this screen. Every cancellation offered here is priced
  // against this policy and every sentence about a fee comes out of it, and it
  // was outside the gesture — so a gym that changed its notice period was still
  // being quoted the old one however often the member pulled.
  const { policy: cancelPolicy, status: policyStatus, reload: reloadPolicy } = useCancellationPolicy();
  /**
   * The policy, or nothing — never a value we did not confirm.
   *
   * This screen already wrote the rule twice and then applied it in three
   * places out of five. `endPolicy` below carries it: "a policy this app could
   * not read must not be reported as 'no fee'". `doPause` carries it. `cancelOne`
   * did NOT — it passed `cancelPolicy` raw into the warning a member reads
   * before cancelling and into the helper that decides whether their credit
   * comes back — so after a failed reload one half of this screen treated the
   * policy as unknown while the other half quoted a fee off it as fact. Two
   * answers about one gym's rule, on one screen, about somebody's money.
   *
   * `useCancellationPolicy` sets 'error' on a failed reload WITHOUT clearing the
   * value, so the raw variable can hold a genuinely last-known policy. That is
   * exactly what makes the divergence invisible in testing and wrong in a lift.
   * One name, used everywhere, so there is nothing left to forget.
   */
  const readPolicy: CancellationPolicy | null = policyStatus === 'ready' ? cancelPolicy : null;
  const pull = usePullToRefresh(useCallback(() => { void reloadSeries(); void refreshSessions(); void reloadPauses(); reloadPolicy(); }, [reloadSeries, refreshSessions, reloadPauses, reloadPolicy]));
  const cd = useClientData();

  // TF-32: the coach's name comes from the thread peer, never from
  // `useCoachProfile()` — that provider reads the SIGNED-IN user's profile, so
  // on the client app it resolves to the reader and every "with <name>" on this
  // screen would have named the member themselves.
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  const coachName = head.isName ? head.text : null;

  const [endFor, setEndFor] = useState<RecurringSeries | null>(null);
  const [busy, setBusy] = useState(false);

  // ── asking for one ───────────────────────────────────────────────────────
  //
  // The empty state of this screen said "Ask your coach to set one up" and gave
  // nobody a way to do it. This is that way, and it is a REQUEST rather than a
  // create: `create_session_series` refuses a member with 42501 and is right to
  // — a series writes eight weeks of real sessions into a coach's diary the
  // moment it is agreed, against hours they may never have opened, and each of
  // those draws a credit as it is delivered. src/lib/standingAsk.ts is the long
  // version of that argument.
  const [asking, setAsking] = useState(false);
  /** -1 until the member picks one. No default day, deliberately: a weekday
   *  chosen for somebody is a weekday they may send without reading. */
  const [askDow, setAskDow] = useState(-1);
  const [askHour, setAskHour] = useState(18);
  const [askMinute, setAskMinute] = useState(0);
  const [askLength, setAskLength] = useState(60);

  // A series ended, or an occurrence cancelled, on the coach's phone changes
  // what is true here. BOTH reads are refreshed on focus, not just the
  // arrangements: "Cancel that session only" has to find the concrete session
  // row, and a calendar read taken before the coach moved something is how that
  // button ends up disabled — or worse, aimed at a session that is gone.
  useFocusEffect(useCallback(() => {
    void reloadSeries();
    void refreshSessions();
    void reloadPauses();
  }, [reloadSeries, refreshSessions, reloadPauses]));

  const devTz = deviceTimeZone();
  const standing = series.filter((s) => s.active);
  const endedCount = series.length - standing.length;

  /** Who the arrangement is with. `my_session_series` hands the CLIENT null for
   *  `client_name` on purpose — they are looking at their own arrangement and
   *  do not need to be told their own name — so the coach's name comes from the
   *  one read that resolves it, or the row says "your coach" and means it. */
  const withWhom = coachName ? `with ${coachName}` : 'with your coach';

  /**
   * The concrete booked session that the next occurrence IS.
   *
   * A series row knows WHEN the next one starts; cancelling it needs the row
   * itself, because an occurrence is an ordinary session and goes down the
   * ordinary path. Matched on the instant and this member's own id rather than
   * guessed at, and null is a real answer the sheet handles: the calendar may
   * not have been read, or that occurrence may already be gone. The option is
   * then shown WITHOUT an action and says which of those it is, rather than
   * wiring a destructive button to a hope.
   */
  const nextOccurrenceOf = (s: RecurringSeries): TrainingSession | null => {
    if (!s.nextAt) return null;
    const at = Date.parse(s.nextAt);
    if (!Number.isFinite(at)) return null;
    return sessions.find((x) => x.status === 'booked' && x.clientId === cd.id
      && Date.parse(x.startsAt) === at) ?? null;
  };

  /**
   * End it. THIS IS NOT A CANCELLATION AND IT CHARGES NOTHING.
   *
   * `end_session_series` does not go near `cancel_my_session`, and `charged`
   * comes back from the server stated as false — so the alert below reports
   * what the server did rather than what this screen believes it did.
   *
   * No effective date is passed. Part 143 made `p_effective` default to the
   * NEXT OCCURRENCE'S own date in the series' zone, so calling this the obvious
   * way now keeps the promise the sheet has just made in words. Before that fix
   * the default was TODAY and the delete is `occurrence_on > cut`, which removed
   * next Tuesday — the one session guaranteed to survive — and every screen had
   * to compute the date itself to avoid it.
   */
  const endNow = async (s: RecurringSeries) => {
    setBusy(true);
    const res = await endSeries(s.id);
    setBusy(false);
    if (!res.ok) {
      Alert.alert(
        'Still standing',
        `${seriesLabel(s)} ${withWhom} is still running — that did not save, so nothing has changed, no session has been removed and your coach has not been told.\n\n${res.error}`,
        [{ text: 'OK' }],
      );
      return;
    }
    setEndFor(null);
    // The later occurrences were deleted server-side. Every other screen in the
    // app is still drawing them off a calendar read that predates this call.
    await refreshSessions();
    const r = res.report;
    Alert.alert(
      'Standing appointment ended',
      `${seriesLabel(s)} ${withWhom} will not repeat again.\n\n`
      + (r.removed
        ? `${r.removed} later session${r.removed === 1 ? '' : 's'} ${r.removed === 1 ? 'was' : 'were'} removed from your calendar and your coach's.`
        : 'There were no later sessions on the books, so nothing was removed.')
      + '\n\n'
      // Read from the server rather than asserted here. This branch can only be
      // reached by a server that broke its own promise, and it is said out loud
      // rather than swallowed: a fee that appeared without anybody deciding to
      // charge one is the member's money and theirs to query.
      + (r.charged
        ? 'The server reported a charge against this, which it should never do — ask your coach about it before you pay anything.'
        : 'Nothing was charged for any of them, however close they were.')
      + (s.nextAt
        ? `\n\nYour next session — ${dayLabel(s.nextAt)} at ${timeLabel(s.nextAt)} — is still booked, on purpose. If you can't make that one either, cancel it on its own and your coach's notice policy prices that session alone.`
        : ''),
      [{ text: 'Done' }],
    );
  };

  /**
   * Cancel the ONE session. The ordinary cancellation, through the ordinary
   * helper, in the ordinary order.
   *
   * Not a second copy of those writes. `cancelBookedSession` is where the pack
   * credit, the waitlist promotion, the re-offer and the coach's push live, and
   * the reason it is one function is that this screen and My Bookings and the
   * Book screen already came apart once and charged different money for the
   * same tap. The sentences about the member's money come back from
   * `ptCancelLines` for the same reason.
   */
  /**
   * Take a week, a fortnight or a month off, without ending the arrangement.
   *
   * `days` is sent as a NUMBER OF DAYS and the server turns it into dates, in
   * the arrangement's own zone. `occurrence_on` and the materialiser both work
   * in that zone, and a member on holiday in Sydney pausing a London Tuesday
   * would otherwise pause the wrong dates at both ends.
   *
   * The preview counts THIS DEVICE'S view of what is booked in the range and
   * says so honestly; the server counts again and the report afterwards is the
   * authority. Both sentences come from src/lib/reschedule, so the promise made
   * before the tap and the account given after it cannot drift apart.
   */
  const doPause = (s: RecurringSeries, days: number, label: string) => {
    const now = Date.now();
    const untilMs = now + days * 86_400_000;
    // Matched to THIS series by its slot, not "every booking in the window".
    // The old filter took every booked session of the member's inside the
    // range with no filter on the series — and there could not be one, because
    // `TrainingSession` carries no series id — then handed the count to
    // `pausePreviewLine`, which stated as fact how many sessions would be
    // cancelled and what the late fees came to. A member with a second standing
    // slot, or a one-off Friday booking, was shown a money claim over a set the
    // pause was never going to touch. See `seriesOccurrencesIn`.
    const inRange = seriesOccurrencesIn(sessions, s, now, untilMs);
    const notice = noticeHoursOf(readPolicy);
    const late = inRange.filter((x) => insideNoticeWindow(x.startsAt, notice)).length;
    // A policy that could not be read is passed as null, never softened into
    // "no fee" — that is the sentence this whole family of screens exists to
    // stop being printed by accident.
    // `isWhole`, not a bare list. `inRange` is counted out of THIS DEVICE'S
    // calendar, and `useSessions` publishes 'error' for a read that failed and
    // 'partial' for one PostgREST cut off at its row cap. Under either, an
    // empty or short `inRange` produced two sentences that are money claims
    // above a destructive confirm: "we do not expect anything to be cancelled",
    // and — worse, because it names the cost — "All of them are outside your
    // coach's notice period, so this costs nothing." This screen states the
    // rule 100 lines below and applies it to the OTHER count on it: "`upcoming`
    // is the count the SERVER reports for the arrangement, never one counted
    // out of `sessions` here: this device's calendar is capped, and a capped
    // read would understate how many sessions are about to be removed." The
    // pause preview is the same read and the same risk.
    const preview = pausePreviewLine(inRange.length, late, readPolicy, isWhole(sessionsStatus));

    Alert.alert(
      `Pause for ${label}?`,
      `${seriesLabel(s)} will not run for the next ${label}. Your standing appointment is NOT ended: it starts again by itself afterwards.\n\n${preview}`,
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Pause It', style: 'destructive', onPress: async () => {
          if (busy) return;
          setBusy(true);
          const res = await pauseSeriesForDays(s.id, days, null);
          setBusy(false);
          setPauseFor(null);
          if (!res.report) {
            Alert.alert('Not paused', res.error ?? 'That did not save, so your sessions are still booked.');
            return;
          }
          await refreshSessions();
          void reloadSeries();
          void reloadPauses();
          Alert.alert('Paused', pauseOutcomeLines(res.report).join('\n\n'));
        } },
      ],
    );
  };

  /**
   * Pause the dates the member named.
   *
   * The same three things as `doPause` above, in the same order and out of the
   * same modules: refuse what cannot work, preview what this device can see,
   * then let the server be the authority on what it cost. What differs is only
   * where the dates come from — and that is why the bounds below are computed
   * from the strings rather than from a duration: `seriesOccurrencesIn` takes
   * instants, and the range the member chose is a pair of LOCAL days, so the
   * window opens at the start of the first and closes at the end of the last.
   *
   * That arithmetic is this device's calendar and the preview says so. The
   * server re-reads the range in the ARRANGEMENT's zone, which is the only
   * place that can be right, and `pauseOutcomeLines` reports what it found.
   */
  const doPauseRange = (s: RecurringSeries) => {
    const [ty_, tm, td] = todayParts();
    const refusal = pauseRangeRefusal(fromOn, toOn, isoFromParts(ty_, tm, td));
    if (refusal) { Alert.alert('Those dates will not work', refusal); return; }
    // Local midnight to local end-of-day, built by the same `Date` the rest of
    // this screen's previews use. utc-day-ok: both bounds are constructed from
    // local parts and never sliced out of an ISO string, which is the failure
    // this gate is about.
    const [fy, fm, fd] = fromOn.split('-').map(Number);
    const [uy, um, ud] = toOn.split('-').map(Number);
    const startMs = new Date(fy, fm - 1, fd, 0, 0, 0, 0).getTime();
    const endMs = new Date(uy, um - 1, ud, 23, 59, 59, 999).getTime();
    const inRange = seriesOccurrencesIn(sessions, s, startMs, endMs);
    const notice = noticeHoursOf(readPolicy);
    const late = inRange.filter((x) => insideNoticeWindow(x.startsAt, notice)).length;
    const preview = pausePreviewLine(inRange.length, late, readPolicy, isWhole(sessionsStatus));
    const cf = pauseRangeConfirm(seriesLabel(s), fromOn, toOn);
    Alert.alert(cf.title, `${cf.body}\n\n${preview}`, [
      { text: 'Not Now', style: 'cancel' },
      { text: 'Pause It', style: 'destructive', onPress: async () => {
        if (busy) return;
        setBusy(true);
        const res = await pauseSeries(s.id, fromOn, toOn, null);
        setBusy(false);
        setPauseFor(null);
        if (!res.report) {
          Alert.alert('Not paused', res.error ?? 'That did not save, so your sessions are still booked.');
          return;
        }
        // Cleared only on a pause that landed. A member whose write failed gets
        // their dates back, because retyping two dates to retry something that
        // was not their fault is the kind of small insult this codebase avoids.
        setFromOn(''); setToOn('');
        await refreshSessions();
        void reloadSeries();
        void reloadPauses();
        Alert.alert('Paused', pauseOutcomeLines(res.report).join('\n\n'));
      } },
    ]);
  };

  /** Lift one. Says what does not come back, because it is the thing people
   *  expect it to do: a week that has already passed stays gone. */
  const doResume = (skipId: string, from: string, to: string) => {
    const cf = resumeConfirm(from, to);
    Alert.alert(cf.title, cf.body, [
      { text: 'Leave It Paused', style: 'cancel' },
      { text: 'Start Again', onPress: async () => {
        if (busy) return;
        setBusy(true);
        const res = await resumeSeries(skipId);
        setBusy(false);
        if (!res.resumed) { Alert.alert('Not resumed', res.error ?? 'That did not save.'); return; }
        await refreshSessions();
        void reloadSeries();
        void reloadPauses();
        Alert.alert('Back on', resumedLine(res.created));
      } },
    ]);
  };

  /**
   * The first date this weekly slot would fall on, and the instant it starts.
   *
   * `now` is passed in so the preview and the send are the same arithmetic: the
   * caller reads the clock once, at the moment it is acting. A member who picks
   * their own weekday at five to six, for six o'clock, is asking about TODAY —
   * and the same member picking it five minutes later is asking about next
   * week. `firstStandingDay` is told which of those it is rather than guessing,
   * because "the next one after now" and "the next one of that weekday" are
   * different dates exactly once every seven days.
   */
  const askSlotOn = (now: number): { day: string | null; startsAt: string } => {
    if (askDow < 0) return { day: null, startsAt: '' };
    const [ay, am, ad] = todayParts();
    const todayISO = isoFromParts(ay, am, ad);
    const soonest = firstStandingDay(todayISO, askDow, false);
    const at = instantOn(soonest, askHour, askMinute);
    if (at && Date.parse(at) > now) return { day: soonest, startsAt: at };
    const week = firstStandingDay(todayISO, askDow, true);
    return { day: week, startsAt: instantOn(week, askHour, askMinute) ?? '' };
  };

  /** The hour a sentence is about, written out, or null. Never assembled around
   *  a value that might not be there — a caller with no readable instant does
   *  not draw the sentence at all. */
  const askWhenLabel = (iso: string): string | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? `${dayLabel(iso)} at ${timeLabel(iso)}` : null;
  };

  /**
   * Ask for it.
   *
   * Three refusals before the write, and each is a different question:
   *
   *   · `standingAskBlocker` — they already train at that hour every week. The
   *     request rail cannot see `session_series` at all, so without this a
   *     member is free to ask their coach, in writing, to arrange something
   *     that has been running for a year.
   *   · `askBlocker` — the ordinary rules for asking anybody for anything: a
   *     time that has gone, one past the horizon, one they are already booked
   *     for. `myBusy` is the member's OWN diary, which the server does not
   *     check (part 740 checks the COACH's), and `ownDiaryNote` is printed on
   *     the sheet when that read did not land rather than the clash check
   *     silently becoming "no clash".
   *   · the server, which is the only authority on the live-request cap and on
   *     whether they have a coach at all. Its refusals arrive as reasons and
   *     `askRefusalNote` is the one place they become sentences. This screen
   *     deliberately does not read the request list to pre-empt those two: a
   *     fifth read here would be a second copy of a rule the server already
   *     enforces, and a copy that disagrees is worse than a refusal that
   *     explains itself.
   *
   * Nothing is queued for later. A standing appointment is a conversation, and
   * a question that surfaces on the coach's phone a day after the member forgot
   * they asked it is not the same question — so a write that does not land says
   * so and leaves the sheet as it was, ready to send again.
   */
  const doAsk = async () => {
    if (busy) return;
    const now = Date.now();
    const { startsAt } = askSlotOn(now);
    const mine = standingAskBlocker(
      standing.map((x) => ({ dow: x.dow, hour: x.hour, minute: x.minute, active: x.active })),
      { dow: askDow, hour: askHour, minute: askMinute },
      // `isWhole`, not `seriesStatus === 'ready'`: a short read and a failed one
      // are both lists this screen may not reason from.
      isWhole(seriesStatus),
    );
    if (mine) { Alert.alert('Not sent', mine); return; }
    const myBusy = sessions
      .filter((x) => x.status === 'booked' && x.clientId === cd.id)
      .map((x) => ({ startsAt: x.startsAt, durationMin: x.durationMin }));
    const stop = askBlocker(startsAt, askLength, now, { myBusy });
    if (stop) { Alert.alert('Not sent', stop); return; }
    const when = askWhenLabel(startsAt);
    if (!when) { Alert.alert('Not sent', 'That time could not be read. Pick the day and the time again.'); return; }

    setBusy(true);
    // The note is what makes this a request for a STANDING appointment rather
    // than for one Tuesday. Written in the member's own language and clock, and
    // never longer than the column part 740 checks — see `standingAskNote`.
    const res = await askForSession(startsAt, askLength, standingAskNote(weekdayName(askDow), fmtClock(askHour, askMinute)));
    setBusy(false);

    if (!res.ok) {
      Alert.alert('Not sent', res.reason
        ? askRefusalNote(res.reason)
        : 'That did not send, so your coach has not been asked and nothing has been arranged. Try again when you have signal.');
      return;
    }
    setAsking(false);
    // The coach the SERVER says was asked, never one this screen worked out. A
    // phone that guessed could page somebody who was never asked anything.
    // `sendPushChecked` rather than `sendPush`, because a screen built on the
    // latter can only ever claim success.
    const push = res.trainerId
      ? await sendPushChecked([res.trainerId], 'A standing appointment',
        `A client asked about ${when}, every week.`, { route: '/(trainer)/sessions' }, 'bookings')
      : { ok: false };
    Alert.alert(
      'Asked',
      `${askedConfirmation(when, coachName)}\n\nThey have been told you would like that time every week. If they agree, the standing appointment appears on this screen and the sessions appear on your calendar.`
      + (push.ok ? '' : '\n\nWe couldn’t send them a notification, so they may not see it until they open the app. Message them if it’s soon.'),
      [{ text: 'OK' }],
    );
  };

  const cancelOne = (one: TrainingSession) => {
    // Captured before the alert and passed through, so the rule the member is
    // warned under is the rule that decides whether their credit comes back.
    const asked = Date.now();
    const warn = cancelWarningFor(one.startsAt, readPolicy, asked);
    const doCancel = async () => {
      const out = await cancelBookedSession(one, cancelMyBooking, asked, readPolicy);
      if (!out.freed) {
        // The second half used to be "Check your connection and try again"
        // whatever had happened, and one of the two things that can happen here
        // is the server reading the request and REFUSING it — a notice window
        // that has closed, a policy, a seat somebody else already took. Sending
        // that member to their wifi settings hides the actual answer and wastes
        // the minutes before their session. `retryLine` says which —
        // src/lib/reachability.ts — and app/(client)/bookings.tsx and
        // app/(client)/classes.tsx already replaced this exact sentence with it.
        Alert.alert(
          'Not cancelled',
          `Your ${dayLabel(one.startsAt)} ${timeLabel(one.startsAt)} session is still booked — that did not save, so nothing has changed and you are still expected. ${retryLine(reach)}`,
          [{ text: 'OK' }],
        );
        return;
      }
      // The occurrence is gone from the server; the counts on this screen came
      // from a read taken before it was.
      await refreshSessions();
      void reloadSeries();
      Alert.alert('Cancelled', ptCancelLines(out, timeLabel(one.startsAt)).join('\n\n'), [{ text: 'OK' }]);
    };
    // Said again on the confirm itself, because this is the tap that can cost
    // money and the sheet behind it is about to disappear.
    const stays = ' Your standing appointment keeps running — the week after is still booked.';
    if (warn.late) {
      Alert.alert('Cancelling late', `${warn.line}${stays} Continue?`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel anyway', style: 'destructive', onPress: () => { void doCancel(); } },
      ]);
      return;
    }
    Alert.alert('Cancel this session?', `${warn.line}${stays}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => { void doCancel(); } },
    ]);
  };

  /**
   * The two choices, priced.
   *
   * `policy` is null unless the read actually landed. A policy this app could
   * not read must not be reported as "no fee" — `cancelOptions` turns null into
   * the 'unknown' verdict, whose sentence says we could not read it, and that
   * is a different thing to say than "your coach doesn't charge".
   *
   * `upcoming` is the count the SERVER reports for the arrangement, never one
   * counted out of `sessions` here: this device's calendar is capped, and a
   * capped read would understate how many sessions are about to be removed.
   */
  const endPolicy = readPolicy;
  const endNext = endFor ? nextOccurrenceOf(endFor) : null;
  const options: CancelOption[] = endFor
    ? cancelOptions({ startsAt: endFor.nextAt ?? '', policy: endPolicy, upcoming: endFor.upcoming })
    : [];

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <PageHead title="Standing Appointments" />
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>The same hour every week, booked for you without either of you asking again.</Text>


        {/* ── your arrangements ──────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Weekly Slots"
            note={seriesStatus === 'error' ? 'Not read' : seriesStatus === 'partial' ? 'Part of the list' : undefined} />

          {/* An empty list under 'error' means the arrangements could not be
              READ. Told "you have none", a member goes and books the slot they
              already hold — see src/ui/loadStatus.ts, which is where this rule
              is written down and why. Warn is a MARK here and not the colour of
              the words: `Flag` puts the tone in a dot and the sentence in ink,
              because t.warn as text fails AA on the light palettes. */}
          {seriesStatus === 'error' ? (
            <Flag tone={t.warn}>
              Your standing appointments could not be read, so none can be listed. This is a connection problem, not a statement that you have none — any weekly slot you have agreed is still running and its sessions are still booked on your calendar and your coach’s. Nothing here has been ended.
            </Flag>
          ) : seriesStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your standing appointments…</Text>
          ) : standing.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {seriesStatus === 'partial'
                ? 'Nothing came back, but only part of the list loaded — so this is not a statement that you have none. Pull down to refresh.'
                : endedCount
                  ? `Nothing is standing right now. The ${endedCount === 1 ? 'one that has ended is' : `${endedCount} that have ended are`} not listed here.`
                  : 'You have no standing appointment. Ask your coach for one below and, if they agree, the same hour is booked for you every week — neither of you has to book it again.'}
            </Text>
          ) : (<>
            {/* The rows are real; there are more of them than came back. They
                may be listed. Their number may not be reported as a total. */}
            {seriesStatus === 'partial'
              ? <PartialRead what="standing appointments" shown={standing.length} onPress={() => { void reloadSeries(); }} />
              : null}
            {standing.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{seriesLabel(s)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {withWhom} · {s.durationMin} min · {s.upcoming
                        ? `${s.upcoming} booked ahead`
                        : 'nothing on the books ahead'}
                    </Text>
                    {s.nextAt ? (
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                        Next {dayLabel(s.nextAt)} at {timeLabel(s.nextAt)}
                      </Text>
                    ) : null}
                    {/* The hour on a series is a wall-clock hour in the zone it
                        was AGREED in, not the zone the reader is standing in.
                        "Every Tuesday at 7:00 am" read as seven o'clock where
                        they are now is a session missed by half a day.

                        Withheld ONLY when both zones are known and are the same
                        zone. An unreadable series zone and a handset that
                        cannot name its own each get their own sentence, because
                        printing nothing for them is printing the sentence that
                        means "this is your hour". */}
                    {standingClockNote(s.tz, devTz) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {standingClockNote(s.tz, devTz)}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ gap: sp.sm, alignItems: 'flex-end' }}>
                    {/* Pause first, and above the destructive pair, because it
                        is the one a member going away actually wants and the
                        one that was missing: a fortnight off used to be two
                        separate cancellations, each priced on its own notice.
                        It ends nothing. */}
                    <Ghost label="Pause" a11yLabel={`Pause ${seriesLabel(s)} for a week or more`}
                      onPress={() => setPauseFor(s)} />
                    {/* Named for both things it opens. A button that said "End"
                        would be a button that had already chosen. */}
                    <Ghost label="Cancel or End" onPress={() => setEndFor(s)} />
                  </View>
                </View>
                {/* The holes already in this arrangement, and the way out of
                    each. Only ever drawn from a read that finished: an empty
                    list under a failed read is UNKNOWN, and a member shown
                    nothing would believe their Tuesdays were running while they
                    were away. */}
                {pauseStatus === 'ready'
                  ? pauses.filter((k) => k.seriesId === s.id).map((k) => (
                    <View key={k.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.sm }}>
                      {/* The mark carries the status colour; the text does not. */}
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
                      <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{pausedRangeLine(k.fromOn, k.toOn, k.reason)}</Text>
                      <Ghost label="Start Again" a11yLabel={`Start ${seriesLabel(s)} again from ${k.fromOn}`}
                        onPress={() => doResume(k.id, k.fromOn, k.toOn)} />
                    </View>
                  ))
                  : pauseStatus === 'error' ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                      We couldn’t read whether you have paused any dates, so this is not a statement that none are paused.
                    </Flag>
                  ) : null}
              </View>
            ))}
          </>)}
        </Section>


        {/* ── asking for one ───────────────────────────────────────────────
            The other half of this screen. Everything above it acts on an
            arrangement that already exists; nothing here could start one, and
            the empty state's own advice — "ask your coach" — was a sentence
            telling somebody to go and have a conversation the app could have
            started for them.

            It ASKS. `create_session_series` refuses a member with 42501, and
            that refusal is right rather than an obstacle: agreeing a series
            writes eight weeks of real sessions into a coach's diary against
            hours they may never have opened, and every one of them draws a
            credit as it is delivered. src/lib/standingAsk.ts carries the whole
            argument. */}
        <Section>
          <SectionHead title="Ask For A Weekly Time" />
          {cd.coachLinked === false ? (
            /* A KNOWN absence, not an unread one. `coachLinked` is
               `boolean | null` and null means the read did not land — under
               which the ask is still offered, because withdrawing the only
               route to a coach on the strength of a failed read costs the
               member more than the wasted tap it would save. */
            <Notice kicker="BEFORE YOU CAN ASK" title="You don’t have a coach yet" note={NO_COACH_FOR_STANDING} />
          ) : (<>
            <Text style={{ ...ty.label, color: t.ink2 }}>{STANDING_ASK_RULE}</Text>
            <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
              <Ghost icon="calendar" label="Ask For A Standing Appointment"
                a11yLabel="Ask your coach for the same time every week"
                onPress={() => setAsking(true)} />
            </View>
          </>)}
        </Section>


        {/* ── what a standing appointment is, and is not ──────────────────── */}
        <Section>
          <SectionHead title="How This Works" />
          <Text style={{ ...ty.label, color: t.ink2 }}>
            Your coach agrees the slot once. Sessions are then booked for you about {Math.round(SERIES_HORIZON_DAYS / 7)} weeks
            ahead and keep going from there on their own — they appear on your calendar like any other booking, and you
            cancel one the same way you cancel anything else.
          </Text>
          {/* Why eight weeks of Tuesdays do not silently empty a ten-session
              pack. Held in src/lib/recurring.ts so the apps and the database
              cannot come to say different things about the member's credits. */}
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>{RECURRING_CREDIT_NOTE}</Text>
          {/* The policy is what the "cancel this one" button will hold them to,
              so a policy that could not be read is worth saying before they get
              as far as tapping it. Deliberately not softened into "no fee":
              that is the sentence this whole feature exists to stop being
              printed by accident. */}
          {policyStatus === 'error' ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              We couldn’t read your coach’s cancellation policy, so we can’t tell you whether cancelling a single session would cost you anything. Ending the standing appointment costs nothing either way. Check with your coach what their notice period and fee are.
            </Flag>
          ) : null}
          <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
            <Ghost icon="calendar" label="See My Calendar" onPress={() => router.push('/(client)/calendar')} />
          </View>
        </Section>
      </ScrollView>

      {/* ── cancel one, or end the arrangement ────────────────────────────────
          THE TWO OPTIONS ARE NEVER COLLAPSED INTO ONE BUTTON, and neither of
          them is the default. Cancelling one occurrence is an ordinary
          cancellation of an ordinary session and may cost a late fee; ending
          the arrangement charges nothing, ever, and deliberately leaves the
          next occurrence standing. So each option carries what confirming it
          actually does, in words, above its own button — and the only
          emphasised control on the sheet is the one that changes nothing. */}
      <Modal visible={!!endFor} animationType="slide" transparent onRequestClose={() => setEndFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEndFor(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          {endFor ? (<>
            <Text style={{ ...ty.head, color: t.ink }}>One session, or the arrangement?</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              {seriesLabel(endFor)} {withWhom}. These are two different things and they do two different things.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Where the "cancel this one" option used to be when there is no
                  next session. `cancelOptions` withholds that whole option now
                  rather than pricing a session with no date; the sentence that
                  replaces it is here, ABOVE the series option, where the fee
                  verdict and the "Affects 1 booked session" line used to sit. */}
              {!options.some((o) => o.scope === 'occurrence') ? (
                <View style={{ paddingVertical: sp.md }}>
                  <Flag tone={t.warn}>
                    {!endFor.nextAt
                      ? 'There is no next session on the books to cancel — either it has not been written out yet, or it has already been cancelled. Ending the arrangement below still works, and still costs nothing.'
                      : 'That session could not be read, so there is nothing here to price or to cancel. Ending the arrangement below still works, and still costs nothing.'}
                  </Flag>
                </View>
              ) : null}
              {options.map((o, i) => (
                <View key={o.scope}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{o.label}</Text>
                    {/* Printed exactly as src/lib/recurring writes it, for both
                        options. The series sentence names no amount and no
                        currency in any branch, and every branch of it says what
                        ending costs — which is nothing. The occurrence sentence
                        is the client's own: it quotes their coach's policy, in
                        their gym's currency, and says who actually collects the
                        fee. Rewording either here is how a screen comes to
                        disagree with the module the tests hold it to. */}
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: 5 }}>{o.detail}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5 }}>
                      {o.affects === 1 ? 'Affects 1 booked session.' : `Affects ${o.affects} booked sessions.`}
                    </Text>
                    <View style={{ marginTop: sp.md }}>
                      {o.scope === 'series' ? (
                        <Ghost label={busy ? 'Ending…' : 'End the Standing Appointment'}
                          onPress={() => {
                            if (busy) return;
                            const s = endFor;
                            // Confirmed once more, in the words of the promise,
                            // because this ends an agreement two people made
                            // and there is no undo for it. "Keep it" is the
                            // cancel-style button: nothing here may be the
                            // one a stray tap lands on.
                            Alert.alert(
                              'End this standing appointment?',
                              `${seriesLabel(s)} will stop repeating. ${o.detail}`,
                              [
                                { text: 'Keep it', style: 'cancel' },
                                { text: 'End it', style: 'destructive', onPress: () => { void endNow(s); } },
                              ],
                            );
                          }} />
                      ) : endNext ? (
                        // The ordinary cancel path on the ordinary session. The
                        // confirm fires after the sheet has finished dismissing
                        // rather than in the same tick: an alert raised while a
                        // modal is animating away is presented from a view
                        // controller on its way out and never appears — and the
                        // tap that vanishes on THIS button is a member who then
                        // reaches for the other one.
                        <Ghost label="Cancel That Session Only"
                          onPress={() => { const one = endNext; setEndFor(null); setTimeout(() => cancelOne(one), 350); }} />
                      ) : (
                        <Flag tone={t.warn}>
                          {!endFor.nextAt
                            ? 'There is no next session on the books to cancel — either it has not been written out yet, or it has already been cancelled.'
                            : sessionsStatus === 'error'
                              ? 'Your calendar could not be read, so that session cannot be found to cancel. This is a connection problem — the session is still booked and you are still expected. Try again when you have signal.'
                              : 'That session is not among the ones this screen has loaded. Open it on your calendar and cancel it from there.'}
                        </Flag>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
            {/* Said once more under both, because it is the half of the promise
                a member is most likely to disbelieve: they are leaving a weekly
                commitment and expect that to be the expensive thing to do. */}
            <Notice tone={t.brand} kicker="Either way"
              title="Ending it never costs anything"
              note="However close the next session is, stopping a standing appointment records no cancellation fee. Only cancelling a single session can, and only under your coach’s notice policy." />
            <View style={{ height: sp.lg }} />
            {/* The only emphasised button on the sheet is the one that does
                nothing. Neither of the two above may be the default: one of
                them ends an arrangement two people made. */}
            <Cta label="Change Nothing" wide onPress={() => setEndFor(null)} />
          </>) : null}
        </View>
      </Modal>

      {/* ── pause for a while ───────────────────────────────────────────────
          Three presets rather than a date picker. The case this exists for is
          "I am away", and a member who is away knows it in weeks; a two-ended
          calendar control is a lot of screen to express "a fortnight", and it
          is a lot of ways to pick a range that starts in the past.

          Every option says what it will cancel and what that costs BEFORE it is
          taken (`pausePreviewLine`), and what it actually did afterwards
          (`pauseOutcomeLines`). Both sentences live in src/lib/reschedule so
          they cannot drift from one another or from the tests. */}
      <Modal visible={!!pauseFor} animationType="slide" transparent onRequestClose={() => setPauseFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPauseFor(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          {pauseFor ? (<>
            <Text style={{ ...ty.head, color: t.ink }}>Pause this, or end it?</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              {seriesLabel(pauseFor)} {withWhom}. Pausing stops the sessions for a while and keeps the arrangement.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[{ days: 7, label: 'a week' }, { days: 14, label: 'a fortnight' }, { days: 28, label: 'four weeks' }].map((o, i) => (
                <View key={o.days}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable onPress={() => doPause(pauseFor, o.days, o.label)} disabled={busy}
                    accessibilityRole="button" accessibilityLabel={`Pause for ${o.label}`}
                    accessibilityState={{ disabled: busy }}
                    style={{ paddingVertical: sp.md, opacity: busy ? 0.5 : 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                      {o.days === 7 ? 'Pause for a Week' : o.days === 14 ? 'Pause for a Fortnight' : 'Pause for Four Weeks'}
                    </Text>
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
                      Your usual time starts again by itself after that. You can start it again sooner.
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Rule />
              {/* ── or the dates you are actually away ──────────────────────
                  Under the three durations rather than above them: a member
                  going away now taps a duration and is done, and this is the
                  longer path for the one who knows the dates. Both fields are
                  buttons over `DateSheet`, which is the only date control in
                  this app — see its header for why it is not a native picker
                  and why typing lives inside it. */}
              <View style={{ paddingTop: sp.md }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Pause Particular Dates</Text>
                <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
                  For a holiday you already know the dates of. Your usual time starts again by itself the day after the last one.
                </Text>
                <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md }}>
                  {([['from', 'First day away', fromOn], ['to', 'Last day away', toOn]] as const).map(([which, label, val]) => (
                    <Pressable key={which} onPress={() => setPicking(which)} disabled={busy}
                      accessibilityRole="button" accessibilityLabel={`${label}${val ? `, ${val}` : ', not chosen yet'}`}
                      style={{
                        flex: 1, paddingVertical: sp.md, paddingHorizontal: sp.md,
                        borderRadius: radius.sm, backgroundColor: t.surface2, opacity: busy ? 0.5 : 1,
                      }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>{label.toUpperCase()}</Text>
                      <Text style={{ ...ty.body, color: val ? t.ink : t.ink3, marginTop: 2, ...(val ? numeric : null) }}>
                        {val || 'Choose'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                  {/* Live whether or not both dates are in. The refusal names
                      which of the two mistakes was made, and a button that
                      greys out says only that something is wrong somewhere —
                      which is the thing the coach in DateSheet's own header was
                      defeated by. */}
                  <Ghost label="Pause These Dates" a11yLabel={`Pause ${seriesLabel(pauseFor)} for the dates chosen`}
                    onPress={() => doPauseRange(pauseFor)} />
                </View>
              </View>
              <Rule />
              {/* Said here as well as in the confirm, because this is the sheet
                  somebody opens when they are worried about what a fortnight
                  away is going to cost them. */}
              <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
                Sessions already booked in those dates are cancelled, and your coach’s notice policy prices each of them exactly as cancelling it on its own would. Pausing in advance costs nothing.
              </Flag>
              <View style={{ height: sp.lg }} />
              <Cta label="Change Nothing" wide onPress={() => setPauseFor(null)} />
            </ScrollView>
          </>) : null}
        </View>
      </Modal>

      {/* ── ask for a weekly time ───────────────────────────────────────────
          A sibling of the two sheets above, never nested inside one: a Modal
          inside a Modal is the one arrangement iOS will not reliably present.

          The grids are app/(client)/request-session.tsx's — the same hours, the
          same quarters, the same lengths — because this is the same request
          going to the same person, and a member who can ask for 07:15 on one
          screen and only 07:00 on the other has been handed two products. What
          differs is the first control: a WEEKDAY rather than a date, because
          the thing being asked for is every week. */}
      <Modal visible={asking} animationType="slide" transparent onRequestClose={() => setAsking(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAsking(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Ask For A Standing Appointment</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
            {withWhom}. Pick the time you would like every week.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Said first and in the app's own words for a one-off ask, because
                it is the half somebody is most likely to misread: they are
                asking, and until their coach answers nothing is held. */}
            <Notice kicker="WHAT THIS DOES" title="It asks — it doesn’t book" note={NOT_A_BOOKING} />

            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>DAY OF THE WEEK</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const on = d === askDow;
                return (
                  <Pressable key={d} onPress={() => setAskDow(d)} hitSlop={hitSlopFor(MIN_TARGET)}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    /* The whole weekday spoken, never the three letters drawn:
                       "Tue" is read aloud as a word nobody says. */
                    accessibilityLabel={`Every ${weekdayName(d)}`}
                    style={{
                      minWidth: MIN_TARGET, minHeight: MIN_TARGET,
                      alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: sp.md, borderRadius: radius.sm,
                      backgroundColor: on ? t.brand : t.surface2,
                      borderWidth: on ? 0 : hairline, borderColor: t.ring,
                    }}>
                    <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>
                      {weekdayNameShort(d)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>TIME</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
              {ASK_HOURS.map((h) => {
                const on = h === askHour;
                return (
                  <Pressable key={h} onPress={() => setAskHour(h)} hitSlop={hitSlopFor(MIN_TARGET)}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={fmtClock(h, askMinute)}
                    style={{
                      minWidth: MIN_TARGET + 24, minHeight: MIN_TARGET,
                      alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: sp.sm, borderRadius: radius.sm,
                      backgroundColor: on ? t.brand : t.surface2,
                      borderWidth: on ? 0 : hairline, borderColor: t.ring,
                    }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>
                      {fmtClock(h, 0)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
              {ASK_MINUTES.map((m) => {
                const on = m === askMinute;
                return (
                  <Pressable key={m} onPress={() => setAskMinute(m)} hitSlop={hitSlopFor(MIN_TARGET)}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    /* The WHOLE time, not ":15" — four pills each announced as a
                       fraction tell a screen-reader user nothing about what they
                       are choosing. */
                    accessibilityLabel={fmtClock(askHour, m)}
                    style={{
                      flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center',
                      borderRadius: radius.sm,
                      backgroundColor: on ? t.brand : t.surface2,
                      borderWidth: on ? 0 : hairline, borderColor: t.ring,
                    }}>
                    <Text style={{ ...ty.label, ...numeric, color: on ? t.brandInk : t.ink }}>:{String(m).padStart(2, '0')}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>HOW LONG</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
              {ASK_LENGTHS.map((n) => {
                const on = n === askLength;
                return (
                  <Pressable key={n} onPress={() => setAskLength(n)} hitSlop={hitSlopFor(MIN_TARGET)}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={`${n} minutes`}
                    style={{
                      flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center',
                      borderRadius: radius.sm,
                      backgroundColor: on ? t.brand : t.surface2,
                      borderWidth: on ? 0 : hairline, borderColor: t.ring,
                    }}>
                    <Text style={{ ...ty.label, ...numeric, color: on ? t.brandInk : t.ink }}>{n} min</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* What is actually being sent, in the reader's own clock and
                language, before they send it. Drawn only once a weekday has
                been chosen: there is no default day, so until then there is no
                date to preview and a sentence here would be about nothing. */}
            {askDow >= 0 ? (
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.lg }}>
                {`You are asking for every ${weekdayName(askDow)} at ${fmtClock(askHour, askMinute)}, for ${askLength} minutes. `}
                {askWhenLabel(askSlotOn(Date.now()).startsAt)
                  ? `The first one would be ${askWhenLabel(askSlotOn(Date.now()).startsAt)}.`
                  : 'The first date could not be worked out on this phone — pick the day again.'}
              </Text>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
                Pick a day of the week to see when the first one would be.
              </Text>
            )}

            {/* The member's own diary is the ONLY calendar checked on this side
                — part 740 checks the coach's and deliberately says nothing
                about the client's — so a sessions read that did not land makes
                that check silently become "no clash", and the sentence for each
                way it can fail is `ownDiaryNote`. */}
            {ownDiaryNote(sessionsStatus) ? (
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{ownDiaryNote(sessionsStatus)}</Flag>
            ) : null}
            {/* Not a warning about the ask — it books nothing — but the thing a
                member wants to know before they commit a weekly hour. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{RECURRING_CREDIT_NOTE}</Text>

            <View style={{ height: sp.lg }} />
            <Cta label={busy ? 'Asking…' : 'Ask My Coach'} wide
              a11yLabel="Send this request to your coach"
              onPress={() => { void doAsk(); }} />
            <View style={{ height: sp.md }} />
            {/* Where the answer will appear, and where it can be taken back.
                `askedConfirmation` promises "you will see the answer here", and
                here is that screen rather than this one. */}
            <Ghost label="See Requests I Have Sent"
              onPress={() => { setAsking(false); router.push('/(client)/request-session'); }} />
            <View style={{ height: sp.md }} />
            <Ghost label="Change Nothing" onPress={() => setAsking(false)} />
          </ScrollView>
        </View>
      </Modal>

      {/* Outside the pause Modal on purpose. A Modal inside a Modal is the one
          arrangement iOS will not reliably present — the second arrives behind
          the first, or not at all — so the sheet is a sibling and `picking`
          is what decides which field it is filling. `min` is today at both
          ends: a pause over dates that have gone cannot remove anything, which
          `pauseRangeRefusal` also refuses, and drawing those days as
          untappable is the honest version of the same rule. */}
      <DateSheet
        visible={picking != null}
        value={picking === 'to' ? toOn : fromOn}
        fallback={picking === 'to' ? (fromOn || null) : null}
        range={{ min: isoFromParts(...todayParts()) }}
        heading={picking === 'to' ? 'Last day away' : 'First day away'}
        note={picking === 'to'
          ? 'The last date your usual time should not run. It starts again the day after.'
          : 'The first date your usual time should not run.'}
        onCancel={() => setPicking(null)}
        onPick={(iso) => {
          if (picking === 'to') setToOn(iso);
          else {
            setFromOn(iso);
            // A first day chosen after the last one leaves a backwards range
            // sitting in two fields that both look filled in, and the member
            // would meet a refusal about a mistake the app watched them make.
            // The later end is dropped instead, so the next tap is the one that
            // fixes it.
            if (toOn && toOn < iso) setToOn('');
          }
          setPicking(null);
        }}
      />
    </SafeAreaView>
  );
}
