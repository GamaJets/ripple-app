// Book — month calendar of your in-person sessions. Tap a day to book an open
// slot or cancel one you've booked (24h+ ahead avoids the late fee). Reads the
// shared session store, so slots the coach opens appear here to book.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, conditional branch, alert and route from the previous version
// is preserved — only the presentation changed: one hero figure instead of three
// competing tiles, hairline-separated sections instead of stacked bordered
// boxes, and the one card spent on the coach you're booking with.
//
// ── TF-20: the calendar can be written to as well as read ──────────────────
//
// Everything above is retrospective — slots a coach opened, workouts already
// logged. A client asked to PLAN: to say on Sunday that Thursday is a rest day
// and Friday is legs. So a day can now be marked with one of the app's own day
// types (src/lib/dayPlan.ts, stored by supabase/parts/62-day-types.sql).
//
// The one rule that shapes every line of it: a plan is an intention and must
// never be able to read as a record. Three separate things enforce that here.
//
//  · Different marks. What was LOGGED is a filled dot under the date, in the
//    kind's own colour. What is PLANNED is a hollow ring ABOVE it, in one
//    neutral colour. Different shape, different place, different palette — a
//    reader glancing at the grid cannot mistake one for the other, and neither
//    can somebody who cannot separate the amber dot from the gold one.
//  · Different words. A planned day says "Planned"; nothing about it ever says
//    done, completed or kept. `outcomeNote` is where that is held, and its test
//    asserts the words that must not appear.
//  · A planned day that has passed does not quietly become a completed one. It
//    keeps its ring and gains a sentence about what the log does and does not
//    say — including the awkward case the feature is really about, a planned
//    rest day with an empty log, which looks exactly like a session nobody
//    logged.
//
// Where the client's mark disagrees with their program the disagreement is
// SHOWN and neither side is edited. See planConflict.
//
// ── TF-32: every "your coach" on this screen named the reader ──────────────
//
// Eight strings here came from `useCoachProfile().name`. That provider is the
// COACH-side one: it calls `supabase.auth.getUser()` and loads THAT user's own
// `profiles.full_name`. On the client app the signed-in user is the client, so
// the card headed "Your coach" carried the reader's own name, the booking alert
// confirmed a session "with" them, the ICS export wrote their name into their
// real calendar, and the re-offer push told the coach's OTHER clients that a
// slot with the person who had just cancelled had opened up. `|| 'Your coach'`
// hid none of that from anyone who had set a name.
//
// The name now comes from `useThreadPeerName`, which reads `clients.trainer_id`
// and then `profiles.full_name` for THAT id and for no other id at all. No
// policy on `profiles` runs client → coach (the reasoning is written out in
// src/lib/threadPeer.ts), so for most clients there genuinely is no name to
// show — and each of these strings now has a wording that works without one,
// because falling back to whichever name IS readable is exactly what produced
// this bug.
//
// The avatar goes with the name. `coach.photo` is `profiles.avatar` read for
// the same signed-in id, so the face beside "Your coach" was the reader's own;
// it is not drawn here any more, and the initials beneath it are taken only
// from a name that came back for the coach. The remaining coach fields on this
// screen (tagline, bio, specialties, offers, fee) come from the `trainers`
// table, which a client has no row in, so those arrive empty rather than
// borrowed from the reader.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Card, ListRow, Cta, Ghost, Flag, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { useSessions, cancelBookedSession, ptCancelLines, useCancellationPolicy, useSlotWaitlist, useLateCancelCharges, cancelWarningFor, waitlistLine } from '../../src/ui/sessions';
import { feeAmountLine } from '../../src/lib/booking';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useSettings } from '../../src/ui/settings';
import { liftLabel, type WeightUnit } from '../../src/lib/units';
import type { TrainingSession } from '../../src/lib/types';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { workoutKind, KIND_LABEL, WORKOUT_KINDS, type WorkoutKind } from '../../src/lib/workoutKind';
import { dateParts } from '../../src/lib/localDate';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useRecurringSeries } from '../../src/ui/availability';
import { buildProgram } from '../../src/lib/programs';
import { scheduledFocus } from '../../src/lib/checklist';
import {
  PLANNED_DAY_TYPES, DAY_TYPE_LABEL, DAY_TYPE_BLURB, isoToday, isoFromParts, weekdayOfIso,
  byCellKey, cellKeyFromIso, canPlan, planOutcome, outcomeNote, planConflict, upcomingPlans,
  type PlannedDay, type PlannedDayType,
} from '../../src/lib/dayPlan';
import { fetchPlannedDays, savePlannedDay, clearPlannedDay, PLAN_NOTE_MAX } from '../../src/lib/plannedDays';
import type { LoadStatus } from '../../src/ui/loadStatus';
import type { IconName } from '../../src/ui/Icon';
// `refundSession` and `reofferSlot` moved with the cancellation into
// `cancelBookedSession` (src/ui/sessions.tsx), so that My Bookings runs the same
// writes in the same order. They are no longer called from this screen.
import { sessionsRemaining, redeemSession } from '../../src/lib/connect';
import { buildIcs, shareIcs } from '../../src/lib/exportShare';
import { sendPush, sendPushChecked } from '../../src/ui/pushNotifications';
import { peerHeading } from '../../src/lib/threadPeer';
import { useThreadPeerName } from '../../src/ui/messaging';

// NOTE: this screen used to filter and book against a hardcoded `CLIENT_ID = 'c1'`,
// a leftover from the mock-data era. The real client id is the Supabase user id.
// Because every client shared the literal 'c1', sessions booked by one client
// matched every other client's filter — so two people would see each other's
// bookings, and the trainer side (which stores real user ids) never matched at all.
// Only ever called on a name that came back from the read for the coach's id.
// Initials of the dash are "—" set in brand ink, which reads as somebody whose
// name we know rather than as the absence of one, so `isName` guards both call
// sites below.
const initialsOf = (name: string) => name.replace('Coach ', '').split(' ').map((x) => x[0]).join('').slice(0, 2);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// One key function for both of this screen's sources. A session's `startsAt` is
// a timestamp and means an instant, but a workout's `performed_at` can come back
// as a bare `YYYY-MM-DD`, which `new Date` resolves to UTC midnight — and every
// local getter then reads that back as the previous day anywhere west of
// Greenwich, filing Monday's session under Sunday. `dateParts` is the fix that
// already exists for this; see src/lib/localDate.ts for the two shipped bugs it
// was written for.
function dayKey(iso: string) {
  const p = dateParts(iso);
  return p ? `${p[0]}-${p[1]}-${p[2]}` : '';
}
function timeLabel(iso: string) {
  const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  const m = d.getMinutes(); return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}

// "Tue · Sep 10" for a bare `YYYY-MM-DD`. Through `dateParts` for the same
// reason `dayKey` is — the weekday of a date-only value read as UTC midnight is
// yesterday's weekday anywhere west of Greenwich, which would label a planned
// Tuesday as a Monday for every client in the Americas.
function planDayLabel(iso: string): string {
  const p = dateParts(iso);
  if (!p) return fig(null);
  return `${DOW[new Date(p[0], p[1], p[2]).getDay()]} · ${MON[p[1]].slice(0, 3)} ${p[2]}`;
}

// An icon per kind, so the panel below the grid is not relying on colour alone.
// It lives here rather than beside KIND_LABEL because src/lib/workoutKind.ts is
// deliberately pure — a classifier that can be tested without a renderer should
// not import an icon set.
const KIND_ICON: Record<WorkoutKind, IconName> = {
  strength: 'dumbbell', cardio: 'heart', hiit: 'flame', mobility: 'sparkle', recovery: 'moon',
};

// The one-line summary under a logged workout, built the way Activity builds it
// (`app/(client)/activity.tsx`). TF-18 is a report that the two screens disagree
// about the same day, so they have to say the same words about the same entry.
//
// One deliberate difference: Activity drops an entry that has neither sets nor a
// cardio block, and here it is shown with a dash instead. This panel's job is to
// account for the day, and an entry whose detail never saved is still a session
// that happened — silently omitting it is the same absence-of-evidence mistake
// the log's own status flag exists to prevent.
//
// The load takes the reader's unit rather than printing the stored kilograms.
// The distance beside it deliberately does NOT: `c.unit` is recorded on the log
// entry, because the member chose km or miles when they logged the run, and a
// body-measurement preference has no business overriding an answer they already
// gave. Same rule as app/(client)/activity.tsx, which this is built to agree
// with word for word.
function logDetail(e: WorkoutEntry, wu: WeightUnit): string {
  // `|| null` and then fig(): a set tuple that came back without its load put
  // the four-letter word "null" between the reps and the separator — bare
  // interpolation does not reach fig(), which is the whole reason fig() exists.
  // A set stored at 0 is a bodyweight set, and units.ts is explicit that a
  // screen shows that as a dash rather than as "0 kg".
  if (e.sets && e.sets.length) return e.sets.map((x) => `${x[0]}×${fig(liftLabel(x[1] || null, wu))}`).join(' · ');
  if (e.cardio) {
    const c = e.cardio;
    return [
      `${c.mins} min`,
      c.dist > 0 ? `${c.dist} ${c.unit}` : null,
      c.watts && c.watts > 0 ? `${c.watts} W` : null,
      c.hrAvg ? `♥ ${c.hrAvg} avg / ${c.hrHigh ?? c.hrAvg} hi` : null,
    ].filter(Boolean).join(' · ');
  }
  return fig(null);
}

export default function Calendar() {
  const t = useTheme();
  const router = useRouter();
  const now = new Date();
  const wu = useSettings().weightUnit;
  const { sessions, status: sessionsStatus, bookSession, cancelMyBooking, refresh } = useSessions();
  // The coach's own cancellation policy — the notice period this member is held
  // to, what a late cancellation costs and in what money — rather than the
  // hardcoded 24 hours and the fee this screen used to have no way of knowing.
  // `policyStatus === 'error'` is NOT "no fee": the warning below says the
  // policy could not be read, which is a different sentence and a different
  // thing to do about it.
  const { policy: cancelPolicy, status: policyStatus } = useCancellationPolicy();
  // Slots of this coach that somebody ELSE holds. They are invisible to the
  // sessions store by design (RLS shows a client their own sessions and their
  // coach's open ones), so waiting for one was not previously expressible.
  // `mine` is deliberately not taken here: this screen shows a queue against
  // the DAY (each taken slot carries the member's own place in it), and My
  // Bookings is where the list of every queue they are in lives.
  const { taken: takenSlots, status: waitStatus, reload: reloadWait, join: joinWait, leave: leaveWait } = useSlotWaitlist();
  // What this member has actually been charged. `charges` is written by
  // `cancel_my_session` and by nothing else, and `charges_client_r` has always
  // let a client read their own — there was simply never a row to read, and
  // nowhere to read it. The alert at the moment of cancelling is not a record;
  // this is.
  const { charges: myFees, status: feeStatus, reload: reloadFees } = useLateCancelCharges();
  // The arrangements behind some of the bookings on this screen. Only the count
  // and the read's honesty are used here — the arrangement itself, and the two
  // ways out of it, live on app/(client)/standing.tsx, because "cancel this one"
  // and "stop this repeating" are different acts with different prices and a
  // row on a calendar has nowhere to say so.
  const { series: standingSeries, status: standingStatus } = useRecurringSeries();
  const standingCount = standingSeries.filter((s) => s.active).length;
  // Same rule this screen already applies to the workout log and to planned
  // days (`logKnown`, `planStatus`), applied at last to the sessions themselves.
  // An empty `sessions` means either "your coach has opened nothing and you have
  // booked nothing" or "the calendar could not be read", and this screen stated
  // the first: "Booked with Your Coach — 0 sessions" over "No open slots yet —
  // your coach adds them here". A member who reads that the morning of a session
  // does not think the network is down; they think they were never booked in,
  // and they do not turn up.
  const sessionsKnown = sessionsStatus !== 'error';
  const sessionsCountable = sessionsStatus === 'ready';
  // The other side of this booking happens on somebody else's phone. Re-read on
  // focus so what is on screen is the diary as it stands, not as it stood at
  // launch — including a slot that has just been taken.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Still the source of the session fee and of the profile fields in the sheet
  // below, all of which come back empty for a client. It is no longer the source
  // of the coach's name or face — see the TF-32 note at the top of this file.
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  // A name, or null when there is none we may show. Every string on this screen
  // that used to interpolate `coach.name` branches on this, and no branch of it
  // reaches for a different name when this one is null.
  const coachName = head.isName ? head.text : null;
  // `peerHeading`'s notes are written for the message thread, and one of them
  // says so out loud: while the lookup is in flight it offers "Checking who this
  // thread is with…", which on a booking screen points at something the reader
  // is not looking at. That single sentence is re-worded and nothing else is —
  // the dash, the `isName` rule and the other three notes stay the shared ones,
  // because the point of the shared module is that this screen cannot drift into
  // giving a second, subtly different answer.
  const coachNote = peer.kind === 'loading' ? 'Checking who your coach is…' : head.note;
  const cd = useClientData();
  // TF-18: this screen read PT session slots and nothing else, so a day full of
  // logged training looked empty here while Activity listed all of it. Same log,
  // same day, same words — see `logDetail` above.
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  // Deliberately NOT read from useCoachProfile(). That provider loads the
  // SIGNED-IN user's own `trainers` row, and a client has no row in `trainers`
  // — so on this app it never loads, and `sessionFee` sits at its initial 0
  // forever. Printing that gave a client "Session rate $0" and warned them of a
  // "$0 late fee": two invented figures, about money, on the screen where they
  // decide whether cancelling will cost them anything.
  //
  // There is no client-readable source for a coach's rate today, so this screen
  // says it does not know rather than naming a number. Same failure as the
  // coach's name above it, and worse for being currency.
  const [showCoach, setShowCoach] = useState(false);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selKey, setSelKey] = useState(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);

  const [packLeft, setPackLeft] = useState<number | null>(null);
  useEffect(() => { let c = false; sessionsRemaining().then((n) => { if (!c) setPackLeft(n); }).catch(() => {}); return () => { c = true; }; }, []);

  // ── TF-20: the days this client has marked ────────────────────────────────
  //
  // `status` rather than a bare list, on the rule in src/ui/loadStatus.ts: an
  // empty `plans` under 'error' means the read failed, and offering "nothing
  // planned yet — tap a day to plan one" to somebody who has planned their
  // whole month is the same lie as "0 sessions left" to a client holding ten.
  const [plans, setPlans] = useState<PlannedDay[]>([]);
  const [planStatus, setPlanStatus] = useState<LoadStatus>('loading');
  const [planReload, setPlanReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPlanStatus('loading');
    fetchPlannedDays().then((rows) => {
      if (cancelled) return;
      // null is "could not read", [] is "genuinely none". fetchPlannedDays
      // keeps them apart precisely so this line can.
      if (rows == null) { setPlanStatus('error'); return; }
      setPlans(rows); setPlanStatus('ready');
    }).catch(() => { if (!cancelled) setPlanStatus('error'); });
    return () => { cancelled = true; };
  }, [planReload]);

  // Which day the planning sheet is open for, as a bare date. null is closed.
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [planType, setPlanType] = useState<PlannedDayType>('training');
  const [planNote, setPlanNote] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const mine = sessions.filter((s) => s.clientId === cd.id && s.status === 'booked');
  const open = sessions.filter((s) => s.status === 'available');

  // Days visible to the client: their booked sessions + any open slots.
  const visible = sessions.filter((s) => s.status === 'available' || (s.status === 'booked' && s.clientId === cd.id));
  const byDay = new Map<string, TrainingSession[]>();
  for (const s of visible) { const k = dayKey(s.startsAt); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s); }

  // Under 'error' an empty log means the read failed, not that nothing was
  // trained. Every "0 workouts" defect this app has shipped came from treating
  // those two answers as the same one — see src/ui/loadStatus.ts.
  const logKnown = logStatus !== 'error';
  const logByDay = new Map<string, WorkoutEntry[]>();
  for (const e of log) { const k = dayKey(e.t); (logByDay.get(k) ?? logByDay.set(k, []).get(k)!).push(e); }

  // TF-16: one dot per DISTINCT kind trained that day. Five sets of bench press
  // are one strength session to the reader, not five marks under the 14th — and
  // five marks would not fit under a date anyway. Ordered by WORKOUT_KINDS so
  // the dots always read left to right in the same order as the legend.
  const kindsByDay = new Map<string, WorkoutKind[]>();
  for (const [k, entries] of logByDay) {
    const seen = new Set<WorkoutKind>(entries.map((e) => workoutKind(e)));
    kindsByDay.set(k, WORKOUT_KINDS.filter((kind) => seen.has(kind)));
  }

  // The series palette (s1/s2/s3/s5/s6), not the status palette. good, warn,
  // serious and crit each carry a judgement — something is fine, something needs
  // attention — and the kind of training somebody did is not a status: a HIIT
  // day is not a warning. These five are the tokens that exist to be told apart
  // from one another, and they also stay clear of the two colours already spoken
  // for on this grid (brand for your session, ink3 for an open slot).
  const KIND_DOT: Record<WorkoutKind, string> = {
    strength: t.s1, cardio: t.s6, hiit: t.s3, mobility: t.s2, recovery: t.s5,
  };

  // One neutral colour for every planned day, and deliberately NOT a sixth
  // series colour. The five above are already spoken for by the five kinds of
  // training that were logged, and putting a plan in one of them would make the
  // same colour on the same grid mean two different things — a planned rest day
  // and a logged recovery session would be the same mark, which is the exact
  // confusion this feature has to avoid. The ring says "something is planned
  // here"; only the panel below the grid says what.
  const PLAN_RING = t.ink2;

  const plansByCell = byCellKey(plans);

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const [selY, selM, selD] = selKey.split('-').map(Number);
  const selDate = new Date(selY, selM, selD);
  const selDaySessions = (byDay.get(selKey) ?? []).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  // Slots of this coach that somebody else holds, on the day being looked at.
  // They are not sessions of this member's, so they are kept out of
  // `selDaySessions` entirely — a taken hour is not a booking and must not be
  // counted as one anywhere on this screen.
  const selDayTaken = takenSlots
    .filter((k) => dayKey(k.startsAt) === selKey)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const selDayLog = (logByDay.get(selKey) ?? []).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  // Only counts we can stand behind. With the log unread the workout half of
  // this day is unknown, so the header states the slots and stays quiet about
  // the rest rather than implying a total.
  const selISO = isoFromParts(selY, selM, selD);
  const todayISO = isoToday(now);
  const selPlan = plansByCell.get(selKey) ?? null;
  const dayNote = [
    selDaySessions.length ? `${selDaySessions.length} slot${selDaySessions.length === 1 ? '' : 's'}` : null,
    logKnown && selDayLog.length ? `${selDayLog.length} logged` : null,
    // Named as planned rather than counted with the rest. "3" covering a slot,
    // a workout and an intention would be the header itself blurring the line
    // the whole feature is about.
    selPlan ? `planned ${DAY_TYPE_LABEL[selPlan.type].toLowerCase()}` : null,
  ].filter(Boolean).join(' · ') || undefined;

  // What the client's program says about this weekday — the exact-weekday match
  // and never the nearest-day one, for the reason written on `scheduledFocus`.
  // The program is picked exactly as the checklist picks it (src/ui/habits.tsx):
  // a coached client whose assignment could not be read is handed `undefined`
  // rather than the generic auto program, because a conflict raised against a
  // plan their coach never wrote is worse than no conflict at all.
  const assigned = useAssignedPrograms();
  const solo = cd.coachingMode === 'solo';
  const coachProgram = assigned.getProgram(cd.id);
  const planUnknown = !solo && assigned.status === 'error' && coachProgram == null;
  const program = planUnknown ? null : ((solo ? null : coachProgram) ?? buildProgram(cd.goal, cd.bodyFatPct));
  const selWeekday = weekdayOfIso(selISO);
  // undefined means "we do not know what the program says", which planConflict
  // treats as no conflict rather than as an empty schedule.
  const selScheduled = program && selWeekday != null ? scheduledFocus(program.days, selWeekday) : undefined;
  const selConflict = planConflict(selPlan?.type ?? null, selScheduled);
  const coming = upcomingPlans(plans, todayISO);
  const selOutcome = selPlan ? planOutcome(selPlan.type, selISO, todayISO, logKnown ? selDayLog.length > 0 : null) : null;

  function shiftMonth(delta: number) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  }

  function openPlanner(dateISO: string) {
    const existing = plans.find((p) => p.dateISO === dateISO) ?? null;
    // Opening on what is already there, so "change" is a change and not a
    // re-entry. A day with nothing on it opens on 'training' because that is
    // the mark somebody reaches for the planner to make.
    setPlanType(existing?.type ?? 'training');
    setPlanNote(existing?.note ?? '');
    setPlanFor(dateISO);
  }

  async function savePlan() {
    const day = planFor; if (!day) return;
    setPlanBusy(true);
    const note = planNote.trim() || null;
    const r = await savePlannedDay(day, planType, note);
    setPlanBusy(false);
    // A save that never landed used to be the easiest failure in this app to
    // ship: nothing on screen afterwards hints at it, and the client comes back
    // next week to a calendar that has forgotten the plan they made.
    if (!r.ok) {
      Alert.alert('Not saved', `We couldn’t save this day${r.error ? ` (${r.error})` : ''}. Your calendar is unchanged — try again in a moment.`);
      return;
    }
    setPlans((prev) => [...prev.filter((p) => p.dateISO !== day), { dateISO: day, type: planType, note }]);
    // Deliberately NOT setPlanStatus('ready'). One successful write says nothing
    // about the read that failed, and the rest of the month is still unknown.
    setPlanFor(null);
  }

  async function removePlan() {
    const day = planFor; if (!day) return;
    setPlanBusy(true);
    const r = await clearPlannedDay(day);
    setPlanBusy(false);
    if (!r.ok) {
      Alert.alert('Not removed', `We couldn’t remove this day${r.error ? ` (${r.error})` : ''}. It is still on your calendar.`);
      return;
    }
    setPlans((prev) => prev.filter((p) => p.dateISO !== day));
    setPlanFor(null);
  }

  // One tap, three separate writes: the booking, the credit drawn off the pack,
  // and the push that tells the coach. This used to fire all three and then
  // assert all three had worked, in an alert that appeared before any of them
  // could have answered. The two that can report back are now awaited, and the
  // alert claims only what actually happened.
  async function book(s: TrainingSession) {
    const slot = `${DOW[new Date(s.startsAt).getDay()]} ${timeLabel(s.startsAt)}`;
    // Unknown counts as "might have had credits". A null balance means the
    // count could not be read, not that there is nothing to draw from, and
    // silence is the wrong side to err on when somebody's pack may not have
    // been debited.
    const mayHaveCredits = packLeft == null || packLeft > 0;
    // The booking itself was the one write here that was never awaited, because
    // until now it could not answer. It can: the server books only a slot that
    // is still open and belongs to this client's coach, and refuses silently
    // otherwise. Nothing below this line should happen for a booking that was
    // refused — least of all drawing a session off the client's pack and
    // telling their coach to expect them.
    const booked = await bookSession(s.id, cd.id);
    if (!booked) {
      Alert.alert(
        'Not booked',
        `${slot} was not booked — someone may have taken it first. Pull down to refresh and pick another time.`,
        [{ text: 'OK' }],
      );
      return;
    }

    // `redeemSession` declines rather than throws — no pack, an exhausted pack,
    // or an update the server refused all come back as `ok:false`. Only the
    // `ok` branch existed, so a client whose credit was never drawn watched the
    // count sit unchanged and was told the session was confirmed regardless.
    const redeem = await redeemSession(s.trainerId);
    // Only replace the shown balance with a real count. A failed re-read is
    // not news about the balance, and blanking the row would hide a number we
    // still have every reason to believe.
    if (redeem.ok) { const n = await sessionsRemaining(); if (n != null) setPackLeft(n); }

    // `sendPush` discards both outcomes, so a screen built on it can only ever
    // claim success — which is why `sendPushChecked` exists. "Your coach has
    // been notified" was printed either way, and a client whose coach never
    // heard would turn up to the gym believing they were expected.
    const push = await sendPushChecked([s.trainerId], 'New booking', `A client booked ${slot}.`, { route: '/(trainer)/calendar' });

    // The sentence is rewritten around the missing name rather than having a
    // dash dropped into the middle of it: this alert exists to confirm a
    // booking, not to introduce anybody, and "your coach" is true whether or not
    // their profile is readable.
    const lines = [coachName ? `${slot} with ${coachName} is confirmed.` : `${slot} with your coach is confirmed.`];
    lines.push(push.ok
      ? 'Your coach has been notified.'
      : 'We couldn’t notify your coach — the booking is on their calendar, but message them if it’s soon.');
    // Only worth raising to someone who was showing credits: for a client who
    // pays per session there is no pack to draw from and nothing went wrong.
    if (mayHaveCredits && !redeem.ok) {
      lines.push(`This wasn’t taken off your session pack${redeem.error ? ` (${redeem.error})` : ''} — check your package before you book again.`);
    }
    Alert.alert('Session booked', lines.join('\n\n'), [{ text: 'Great' }]);
  }
  function cancel(s: TrainingSession) {
    // Captured once and passed through, so the rule the member is warned about
    // below is the same one that decides whether their credit comes back. See
    // `cancelBookedSession`.
    const asked = Date.now();
    // The coach's notice period, not a hardcoded day, and the coach's fee, not
    // a number this screen made up. `cancelWarningFor` is the one place the
    // sentence is written — My Bookings shows the same one, because the same
    // tap must not describe different money depending on where it was made.
    const warn = cancelWarningFor(s.startsAt, cancelPolicy, asked);
    const late = warn.late;
    // The whole of this used to live here, and only here — which is how My
    // Bookings came to cancel the SAME session for different money. It now runs
    // through `cancelBookedSession`, which does exactly what these lines did, in
    // the same order, for both screens. The long notes explaining WHY that order
    // is what it is moved with the code; see src/ui/sessions.tsx.
    const doCancel = async () => {
      const out = await cancelBookedSession(s, cancelMyBooking, asked, cancelPolicy);
      if (!out.freed) {
        Alert.alert(
          'Not cancelled',
          `Your ${timeLabel(s.startsAt)} session is still booked — that did not save, so nothing has changed and nobody has been told. Check your connection and try again.`,
          [{ text: 'OK' }],
        );
        return;
      }
      // Only replace the shown balance with a real count. A failed re-read is
      // not news about the balance, and blanking the row would hide a number we
      // still have every reason to believe.
      if (out.packLeft != null) setPackLeft(out.packLeft);
      // The waitlist for this slot moved, and so may the member's own queues.
      reloadWait();
      reloadFees();
      Alert.alert('Cancelled', ptCancelLines(out, timeLabel(s.startsAt)).join('\n\n'), [{ text: 'OK' }]);
    };
    // The figure comes from the coach's stated policy or it is not printed at
    // all — never a 0, never a currency nobody chose, and never "a fee may
    // apply" over a policy this app has not read. `cancelWarningFor` carries
    // all five of those cases; this screen only decides the title and what
    // happens to the slot afterwards.
    // Written to be true either way, because this side cannot know which it
    // will be: how many people are waiting on a slot THIS member holds is not
    // readable from here — `waitlistable_slots` excludes their own sessions and
    // `session_waitlist_client_r` shows them their own row and nobody else's.
    // Guessing "the slot re-opens for your coach's other clients" was the old
    // sentence and is now sometimes false. What actually happened is said
    // afterwards, by `ptCancelLines`, from the server's own answer.
    const slotLine = ` If anyone is waiting for this slot it goes straight to whoever is first in line; otherwise it re-opens for your coach's other clients.`;
    if (late) {
      Alert.alert('Cancelling late', `${warn.line}${slotLine} Continue?`, [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel anyway', style: 'destructive', onPress: doCancel }]);
    } else {
      Alert.alert('Cancel session?', `${warn.line}${slotLine}`, [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel', style: 'destructive', onPress: doCancel }]);
    }
  }

  async function joinWaitlist(slot: { sessionId: string; startsAt: string }) {
    const res = await joinWait(slot.sessionId);
    if (!res.ok) {
      Alert.alert('Not added', res.error || `We couldn't put you on the waitlist for ${timeLabel(slot.startsAt)}. Nothing has changed — try again.`, [{ text: 'OK' }]);
      return;
    }
    Alert.alert(
      'On the waitlist',
      `${waitlistLine(res.position ?? 1, res.waiting ?? 1)}\n\nIf whoever has ${timeLabel(slot.startsAt)} cancels, it is booked for you automatically — you don't have to be quick, and nobody can take it ahead of you.`,
      [{ text: 'OK' }],
    );
  }

  async function leaveWaitlist(slot: { sessionId: string; startsAt: string }) {
    const res = await leaveWait(slot.sessionId);
    if (!res.ok) {
      Alert.alert('Still on the waitlist', `${res.error || 'That did not save.'} You are still in line for ${timeLabel(slot.startsAt)}, so it could still be booked for you.`, [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Left the waitlist', `You're no longer in line for ${timeLabel(slot.startsAt)}.`, [{ text: 'OK' }]);
  }

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.push('/(client)/dashboard')} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Personal training</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Book Sessions</Text>
          </View>
        </View>

        {/* ── the hero: what you have booked ──────────────────────────────── */}
        <Hero
          label="Booked with Your Coach"
          figure={sessionsCountable ? fig(mine.length) : fig(null)}
          unit={sessionsCountable && mine.length === 1 ? 'session' : 'sessions'}
          note={!sessionsKnown
            ? 'Your sessions could not be read, so this is a dash rather than a count. Nothing has been cancelled — pull down to refresh.'
            : sessionsStatus === 'loading'
              ? 'Reading your sessions…'
              : !sessionsCountable
                ? 'Only part of your calendar loaded, so it cannot be counted. The days below show what did come back.'
                : open.length > 0
                  ? `${open.length} open slot${open.length === 1 ? '' : 's'} — tap a day to book`
                  : 'No open slots yet — your coach adds them here'}
        />

        <Rule />

        {/* ── availability ───────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Availability" />
          {/* A dash rather than a zero when the read failed or was cut short.
              "Open Slots 0" is a statement about the coach's diary, and under
              'error' this screen has not seen it. */}
          <KpiRow items={[
            { label: 'Open Slots', value: sessionsCountable ? fig(open.length) : fig(null) },
            ...(packLeft != null && packLeft > 0 ? [{ label: 'Pack Credits', value: fig(packLeft) }] : []),
          ]} />
          {!sessionsKnown ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              Your sessions could not be read, so no open slot or booking of yours is shown here or on the grid below. This is a connection problem, not an empty calendar.
            </Flag>
          ) : null}
          {/* The policy is what the Cancel button on this screen will hold the
              member to, so a policy that could not be read is worth saying
              before they get as far as tapping it. Deliberately not softened
              into "no fee": that is the sentence this whole feature exists to
              stop being printed by accident. */}
          {policyStatus === 'error' ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              We couldn’t read your coach’s cancellation policy, so we can’t tell you whether cancelling would cost you anything. Cancelling still works — check with your coach what their notice period and fee are.
            </Flag>
          ) : null}
          {mine.length > 0 ? (
            <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
              <Ghost label="Add to Calendar" icon="calendar"
                onPress={async () => {
                  // These two strings leave the app and stay in the client's
                  // real calendar for as long as the events do, where nothing
                  // can explain them and nothing will correct them. So an
                  // unreadable name becomes a generic but true title rather
                  // than a dash somebody finds under next Tuesday.
                  const title = coachName ? `Training with ${coachName}` : 'Personal training';
                  const calName = coachName ? `Repple — ${coachName}` : 'Repple — Personal training';
                  const evts = mine.map((s) => ({ start: s.startsAt, durationMin: s.durationMin, title }));
                  await shareIcs(buildIcs(evts, calName), 'repple-sessions.ics', 'Add sessions to your calendar');
                }} />
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── the hour that repeats ───────────────────────────────────────
            A standing appointment is why some of the sessions on the grid
            below are there, and until this row existed nothing in the client
            app said so: the member saw the same Tuesday appear week after week
            from an arrangement they could not see, could not name and could
            not leave. The only exit they had was to cancel each occurrence one
            at a time, which is also the most expensive one — each of those is
            an ordinary cancellation and each inside the notice window records
            its own fee.

            The row is drawn whatever the read did. Hidden on 'error' it would
            be hidden from exactly the member whose arrangement could not be
            confirmed, which is the one who most needs the way in. */}
        {standingStatus !== 'ready' || standingCount > 0 ? (
          <>
            <Section>
              <SectionHead title="Standing Appointments" />
              <ListRow icon="clock" title="Your Weekly Slots"
                note={standingStatus === 'error'
                  ? 'Could not be read — this is not a statement that you have none'
                  : standingStatus === 'loading'
                    ? 'Checking'
                    : standingStatus === 'partial'
                      ? 'Part of the list loaded — open to see it'
                      : standingCount === 1
                        ? 'One hour booked for you every week'
                        : `${standingCount} hours booked for you every week`}
                onPress={() => router.push('/(client)/standing')} />
            </Section>
            <Rule />
          </>
        ) : null}

        {/* ── month ──────────────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.lg }}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month" style={{ padding: 4 }}>
              <Icon name="back" size={18} color={t.ink2} />
            </Pressable>
            <Text style={{ ...ty.head, color: t.ink }}>{MON[viewMonth]} {viewYear}</Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next month" style={{ padding: 4 }}>
              <Icon name="chevron" size={18} color={t.ink2} />
            </Pressable>
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
                const hasMine = daySess.some((s) => s.status === 'booked');
                const hasOpen = daySess.some((s) => s.status === 'available');
                const dayKinds = kindsByDay.get(k) ?? [];
                const dayPlan = plansByCell.get(k) ?? null;
                // Colour is not a label. Spelling the dots out here is what makes
                // the grid usable to a screen reader and to anyone who cannot
                // separate the amber dot from the gold one.
                //
                // The planned day is spoken as "planned", in front of the word
                // for its type, because to a screen reader the ring and the dots
                // are otherwise the same announcement — and the difference
                // between "rest day planned" and "recovery logged" is the whole
                // point of drawing them differently.
                const a11y = [
                  `${MON[viewMonth]} ${d}`,
                  dayPlan ? `planned ${DAY_TYPE_LABEL[dayPlan.type].toLowerCase()}` : null,
                  hasMine ? 'your session' : null,
                  hasOpen ? 'open slot' : null,
                  ...dayKinds.map((kind) => `${KIND_LABEL[kind]} logged`),
                ].filter(Boolean).join(', ');
                return (
                  <Pressable key={i} onPress={() => setSelKey(k)} accessibilityRole="button" accessibilityLabel={a11y} style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    {/* A hollow ring, above the date rather than below it. The
                        logged marks are filled dots underneath, so a plan and a
                        record differ in shape, in position and in palette all at
                        once — none of the three on its own survives a colour-blind
                        reader or a glance. It also keeps out of the dot row, which
                        at seven marks is already at the width a 7-column grid
                        leaves on the narrowest phone. */}
                    {dayPlan ? (
                      <View style={{ position: 'absolute', top: 3, right: 5, width: 8, height: 8, borderRadius: 4, borderWidth: hairline * 3, borderColor: PLAN_RING, backgroundColor: 'transparent' }} />
                    ) : null}
                    <View style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? t.brand : 'transparent', borderWidth: isToday && !isSel ? hairline : 0, borderColor: t.brand }}>
                      <Text style={{ ...value(14), color: isSel ? t.brandInk : isToday ? t.ink : t.ink2 }}>{d}</Text>
                    </View>
                    {/* The two session marks first, then one per kind logged.
                        Dropped from 5pt to 4pt with a 2pt gap because a day can
                        now carry seven of them: 7x4 + 6x2 = 40pt, inside the
                        ~47pt cell a 7-column grid leaves on the narrowest phone,
                        so they never wrap into the row beneath. */}
                    <View style={{ flexDirection: 'row', gap: 2, height: 6, marginTop: 2 }}>
                      {hasMine && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.brand }} />}
                      {hasOpen && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.ink3 }} />}
                      {dayKinds.map((kind) => (
                        <View key={kind} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: KIND_DOT[kind] }} />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {/* The legend is the only thing that turns a coloured dot into a fact.
              Seven entries no longer fit on one line, so it wraps rather than
              truncating — a legend with an item missing is worse than a tall one.

              The ring leads, and it is the one entry whose label says what the
              mark is NOT: "planned, not logged". Everything after it happened or
              is on somebody's calendar; that one is an intention, and a legend
              that listed it alongside the rest without saying so would undo the
              work of drawing it differently. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.md, justifyContent: 'center' }}>
            {[
              { dot: PLAN_RING, label: 'Planned, Not Logged', hollow: true },
              { dot: t.brand, label: 'Your Session', hollow: false },
              { dot: t.ink3, label: 'Open Slot', hollow: false },
              ...WORKOUT_KINDS.map((kind) => ({ dot: KIND_DOT[kind], label: KIND_LABEL[kind], hollow: false })),
            ].map((it) => (
              <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{
                  width: it.hollow ? 8 : 6, height: it.hollow ? 8 : 6, borderRadius: it.hollow ? 4 : 3,
                  backgroundColor: it.hollow ? 'transparent' : it.dot,
                  borderWidth: it.hollow ? hairline * 3 : 0, borderColor: it.dot,
                }} />
                <Text style={{ ...ty.caption, color: t.ink3 }}>{it.label}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Rule />

        {/* ── the selected day ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title={`${DOW[selDate.getDay()]} · ${MON[selM].slice(0, 3)} ${selD}`} note={dayNote} />

          {/* Said before either list, because with the log unread everything
              below is half an answer and the reader has to be told which half is
              missing before they read a quiet day as a lazy one. */}
          {!logKnown ? (
            <Notice tone={t.warn} kicker="This day" title="We couldn’t read your training log"
              note="Sessions with your coach are still shown below, but workouts you logged yourself are not — and the coloured dots are missing from the grid above for the same reason. Nothing has been lost.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={reloadLog} />
              </View>
            </Notice>
          ) : null}

          {/* Same rule again, for the other read. An empty ring row is not the
              same statement as "you have planned nothing", and the button below
              would otherwise invite somebody to re-plan a day they already have. */}
          {planStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Planned days" title="We couldn’t read what you’ve planned"
              note="Days you marked ahead are not shown, on this day or on the grid. Nothing you planned has been lost — and nothing here should be read as an unplanned day.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={() => setPlanReload((n) => n + 1)} />
              </View>
            </Notice>
          ) : null}

          {/* ── what this day was PLANNED as ───────────────────────────────
              Above the sessions and the log, and visibly not one of them: its
              own kicker, the hollow ring beside it, and a sentence that says
              what the log does and does not confirm. `outcomeNote` is where the
              wording is held and tested — no branch of it may say a plan was
              done, including the passed rest day with an empty log, which reads
              identically to a session nobody logged. */}
          {selPlan ? (
            <View style={{ paddingVertical: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: hairline * 3, borderColor: PLAN_RING, backgroundColor: 'transparent' }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>Planned</Text>
              </View>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: sp.sm }}>{DAY_TYPE_LABEL[selPlan.type]}</Text>
              {/* The client's own words, when they wrote any. A dash is not used
                  here: an absent note is not a missing figure, it is a client who
                  had nothing to add, so the line is simply not drawn. */}
              {selPlan.note ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{selPlan.note}</Text> : null}
              {selOutcome ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{outcomeNote(selPlan.type, selOutcome)}</Text> : null}
              {canPlan(selISO, todayISO) ? (
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  <Ghost label="Change" icon="pencil" onPress={() => openPlanner(selISO)} />
                </View>
              ) : (
                // A day that has been and gone cannot be re-planned. Marking
                // last Tuesday as a rest day is not a plan, it is a claim about
                // the past, and the log is where claims about the past live.
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>This day has been and gone, so the plan on it can’t be changed. What happened is in your log.</Text>
              )}
            </View>
          ) : planStatus === 'ready' && canPlan(selISO, todayISO) ? (
            <View style={{ alignSelf: 'flex-start', paddingVertical: sp.md }}>
              <Ghost label="Plan This Day" icon="calendar" onPress={() => openPlanner(selISO)} />
            </View>
          ) : null}

          {/* ── where the plan and the program disagree ────────────────────
              Shown, never resolved. TF-20 is explicit that a client marking a
              rest day on a scheduled Push day is worth surfacing to both of
              them — so the program is not rewritten and the mark is not
              overruled. Nothing is claimed while the program is unread; see
              selScheduled. */}
          {selConflict ? (
            <Notice tone={t.warn} kicker="Your plan and your program" title={selConflict.focus ? `Your program has ${selConflict.focus} on this day` : 'Your program has no session on this day'}
              note={selConflict.note} />
          ) : null}

          {/* An empty day may only be called empty when the log actually
              answered. Under 'error' the Notice above stands in its place.
              `sessionsKnown` belongs in the same guard for the same reason and
              was missing from it: with the sessions unread, "Nothing on this
              day" was being said over a day that may hold the member's booked
              session — and this sentence goes on to explain the grey dot for
              slots that are not being drawn either. The warning in Availability
              above is what stands in its place. */}
          {logKnown && sessionsKnown && selDaySessions.length === 0 && selDayTaken.length === 0 && selDayLog.length === 0 && !selPlan ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.lg }}>
              <Icon name="calendar" size={24} color={t.ink3} />
              <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>Nothing on this day. Days with a grey dot have open slots you can book; a coloured dot is a workout you logged, and a hollow ring is a day you planned.</Text>
            </View>
          ) : null}

          {selDaySessions.map((s, si) => {
            const isMine = s.status === 'booked';
            return (
              <View key={s.id}>
                {si > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: isMine ? t.brand : t.surface3 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{timeLabel(s.startsAt)} · {s.durationMin} min</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{isMine ? 'Confirmed with your coach' : (s.released ? 'Just opened up' : 'Available')}</Text>
                  </View>
                  {isMine ? (
                    <Ghost label="Cancel" onPress={() => cancel(s)} />
                  ) : (
                    <Cta label="Book" onPress={() => book(s)} />
                  )}
                </View>
              </View>
            );
          })}

          {/* ── the hours somebody else has ────────────────────────────────
              A PT slot is one person's, so a "full" slot is a booked one — and
              until now a client could not see that it existed, let alone ask
              for it. `sessions_client_read` shows them their own sessions and
              their coach's OPEN ones, so a taken hour was simply absent from
              this day and the member concluded their coach was free.

              What is shown is the hour and nothing else: no name, no "booked
              by", no initials. `waitlistable_slots` returns no client identity
              for exactly that reason.

              The button is the whole point of the feature. Before it, a freed
              slot went out as a push to every client of the coach and the
              fastest tap won — the app created a race and then lost it. A
              waitlist is a queue: whoever is first in line gets the slot the
              moment it frees, decided by the database inside the same
              transaction that frees it, and nobody has to be quick. */}
          {waitStatus === 'error' ? (
            <View style={{ paddingVertical: sp.md }}>
              <Flag tone={t.warn}>
                We couldn’t read your coach’s taken hours or your place in any waitlist, so neither is shown on this day. This is a connection problem — nothing has been lost, and any waitlist you are on still stands.
              </Flag>
            </View>
          ) : selDayTaken.length > 0 ? (
            <View style={{ marginTop: selDaySessions.length > 0 ? sp.lg : 0 }}>
              {selDaySessions.length > 0 ? <Rule /> : null}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: selDaySessions.length > 0 ? sp.lg : 0, marginBottom: sp.sm }}>Taken</Text>
              {selDayTaken.map((k, ki) => {
                const mine = k.myPosition > 0;
                return (
                  <View key={k.sessionId}>
                    {ki > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: mine ? t.warn : t.surface3 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink2 }}>{timeLabel(k.startsAt)} · {k.durationMin} min</Text>
                        {/* The sentence is the same one `waitlistLine` writes
                            everywhere else, and it never promises the slot to
                            anybody who is not actually at the front. */}
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{waitlistLine(k.myPosition, k.waiting)}</Text>
                      </View>
                      {mine
                        ? <Ghost label="Leave" onPress={() => leaveWaitlist(k)} />
                        : <Ghost label="Wait For It" icon="plus" onPress={() => joinWaitlist(k)} />}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* What TF-18 says is missing: the workouts logged under Activity,
              on the day they were performed. Presented as Activity presents
              them — the same icon tile, the same title, the same detail line —
              with the kind named in words beside it so the dot above the date
              has something to be read against. */}
          {selDayLog.length > 0 ? (
            <View style={{ marginTop: selDaySessions.length > 0 ? sp.lg : 0 }}>
              {selDaySessions.length > 0 ? <Rule /> : null}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: selDaySessions.length > 0 ? sp.lg : 0, marginBottom: sp.sm }}>Logged</Text>
              {selDayLog.map((e, ei) => {
                const kind = workoutKind(e);
                return (
                  <View key={e.id ?? `${e.t}-${e.exercise}-${ei}`}>
                    {ei > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={KIND_ICON[kind]} size={17} color={KIND_DOT[kind]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Logged {e.exercise}</Text>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{KIND_LABEL[kind]} · {logDetail(e, wu)}</Text>
                      </View>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{timeLabel(e.t)}</Text>
                    </View>
                  </View>
                );
              })}
              <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                <Ghost label="All Activity" onPress={() => router.push('/(client)/activity')} />
              </View>
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── what is already marked ──────────────────────────────────────
            The grid can show a ring but not what it is, and one selected day
            at a time is a poor way to answer "what have I got coming". This
            is the list of the marks themselves, today and forward, soonest
            first — the half of TF-20 that is about SEEING the plan rather
            than making it. Days already gone are not here: they are history,
            and history belongs to the log. */}
        <Section>
          <SectionHead title="Planned Ahead" note={planStatus === 'error' ? 'Not read' : undefined} />
          {planStatus === 'error' ? (
            // No count, no list, no reassurance. Under a failed read the honest
            // statement is that we do not know. That used to be said with a
            // leading `fig(null)`, which put a dash in front of a sentence that
            // already contained one — "— — we couldn't read your planned days"
            // reads as a broken line rather than as a count nobody has. The
            // heading beside it carries the "Not read" note; the sentence says
            // the rest.
            <Text style={{ ...ty.label, color: t.ink3 }}>We couldn’t read your planned days. Try again from the day panel above.</Text>
          ) : planStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your planned days…</Text>
          ) : coming.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Nothing planned from today onwards. Tap a day above and mark it — a training day, a rest day, a deload — and it appears here and on the grid as a hollow ring.</Text>
          ) : (
            coming.map((p, pi) => (
              <View key={p.dateISO}>
                {pi > 0 ? <Rule /> : null}
                <Pressable
                  onPress={() => { const c = cellKeyFromIso(p.dateISO); if (c) { const [y, m] = c.split('-').map(Number); setViewYear(y); setViewMonth(m); setSelKey(c); } }}
                  accessibilityRole="button"
                  accessibilityLabel={`${planDayLabel(p.dateISO)}, planned ${DAY_TYPE_LABEL[p.type].toLowerCase()}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: hairline * 3, borderColor: PLAN_RING, backgroundColor: 'transparent' }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{planDayLabel(p.dateISO)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{DAY_TYPE_LABEL[p.type]}{p.note ? ` · ${p.note}` : ''}</Text>
                  </View>
                  <Icon name="chevron" size={16} color={t.ink3} />
                </Pressable>
              </View>
            ))
          )}
        </Section>

        <Rule />

        {/* ── what a late cancellation cost ──────────────────────────────
            Only drawn when there is something to say. Repple does not take
            these payments and never has — the row says what is owed and to
            whom, and the member settles it with their coach. The section
            exists because a fee somebody was told about in an alert three
            weeks ago, and can no longer find anywhere, is not a record. */}
        {feeStatus === 'error' || myFees.length > 0 ? (
          <>
            <Section>
              <SectionHead title="Late-Cancellation Fees" note={feeStatus === 'error' ? 'Not read' : feeStatus === 'partial' ? 'Part of the list' : undefined} />
              {feeStatus === 'error' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  We couldn’t read your late-cancellation fees. That is not a statement that you have none — anything already recorded still stands.
                </Text>
              ) : (<>
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                  Recorded when you cancelled inside your coach’s notice period. Repple doesn’t take these payments — settle them with your coach.
                </Text>
                {myFees.map((c, ci) => (
                  <View key={c.id}>
                    {ci > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.waivedAt ? t.surface3 : t.warn }} />
                      <View style={{ flex: 1 }}>
                        {/* A dash, never a zero: the fee exists and its figure
                            did not come back, which is not the same as owing
                            nothing. */}
                        <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: c.waivedAt ? t.ink3 : t.ink }}>
                          {c.amount == null ? fig(null) : feeAmountLine(c.amount, c.currency)}
                        </Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {new Date(c.createdAt).toLocaleDateString()}{c.waivedAt ? ' · your coach waived this — nothing to pay' : ' · outstanding with your coach'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </>)}
            </Section>

            <Rule />
          </>
        ) : null}

        {/* ── your coach + the rest ──────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Coach" />
          <Card onPress={() => setShowCoach(true)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              {/* The photo is gone rather than fixed: `coach.photo` is
                  `profiles.avatar` read for the signed-in user, so the face
                  under "Your coach" was the reader's own, and there is no
                  client → coach read that could put the right one here. What is
                  left is initials, and only from a real name — otherwise the
                  tile carries the same dash this app draws for any value it
                  cannot state, in muted ink so it cannot be mistaken for
                  somebody whose initials happen to be a dash. */}
              <View style={{ width: 46, height: 46, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...value(16), color: coachName ? t.brand : t.ink3 }}>{coachName ? initialsOf(coachName) : head.text}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: coachName ? t.ink : t.ink3 }} numberOfLines={1}>{head.text}</Text>
                {/* The reason for the dash takes the line the tagline had. It is
                    the better use of it: the tagline is a `trainers` field the
                    client cannot read either, so it was always going to be the
                    "Tap to see their profile" filler here, and a dash with no
                    explanation beside it is the thing this fix exists to avoid. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={2}>{coachNote ?? 'Tap to see their profile'}</Text>
              </View>
              <Icon name="chevron" size={16} color={t.ink3} />
            </View>
          </Card>

          <View style={{ marginTop: sp.md }}>
            <ListRow icon="calendar" title="Gym Classes" note="Book HIIT, spin, yoga & more"
              onPress={() => router.push('/(client)/classes')} />
            <ListRow icon="grid" title="Membership & Entry Pass" note="Card, barcode & visits"
              onPress={() => router.push('/(client)/membership')} />
          </View>
        </Section>

      </ScrollView>

      {/* ── the planner ───────────────────────────────────────────────────
          One sheet, one day. It opens on whatever is already marked, so
          changing a day is a change and not a fresh decision.

          Every type carries its definition, not just its name. That is the
          same fix TF asked for on the Nutrition screen — "need a brief
          definition in each tab" — and the definitions here ARE that
          screen's, so a client who learns what a rest day means in one
          place has not learned a second, subtly different thing here. */}
      <Modal visible={planFor != null} transparent animationType="slide" onRequestClose={() => setPlanFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPlanFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '86%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Plan a day</Text>
            <Text style={{ ...ty.head, color: t.ink, marginTop: 3 }}>{planFor ? planDayLabel(planFor) : ''}</Text>
            {/* Said once, at the top, before anything is chosen. The client is
                recording an intention; nothing on this sheet writes to their
                training log and nothing here will later claim the day was done. */}
            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
              This is what you intend the day to be. It doesn’t log anything and it won’t tick itself off — what you actually do stays in your training log.
            </Text>

            <View style={{ marginTop: sp.lg }}>
              {PLANNED_DAY_TYPES.map((k, ki) => {
                const on = planType === k;
                return (
                  <View key={k}>
                    {ki > 0 ? <Rule /> : null}
                    <Pressable onPress={() => setPlanType(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                      accessibilityLabel={`${DAY_TYPE_LABEL[k]}. ${DAY_TYPE_BLURB[k]}`}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: hairline * 3, borderColor: on ? t.brand : t.ink3, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.brand }} /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{DAY_TYPE_LABEL[k]}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{DAY_TYPE_BLURB[k]}</Text>
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Rule />

            {/* Where a travel day and a refeed go. Neither is a day type,
                because nothing in the app can act on either yet and a type
                that changes nothing is a setting that only looks like one —
                see the header of src/lib/dayPlan.ts. The placeholder names
                them so the client is not left guessing what this is for. */}
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Note (optional)</Text>
            <TextInput
              value={planNote}
              onChangeText={setPlanNote}
              maxLength={PLAN_NOTE_MAX}
              placeholder="Flying to Berlin · refeed · away from the gym"
              placeholderTextColor={t.ink3}
              accessibilityLabel="A note about this day"
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md }}
            />

            <View style={{ marginTop: sp.xl }}>
              <Cta label={planBusy ? 'Saving…' : 'Save This Day'} wide disabled={planBusy} onPress={savePlan} />
            </View>
            {planFor && plans.some((p) => p.dateISO === planFor) ? (
              <View style={{ alignSelf: 'center', marginTop: sp.md }}>
                <Ghost label="Remove the Plan" onPress={removePlan} />
              </View>
            ) : null}
            <View style={{ alignSelf: 'center', marginTop: sp.md }}>
              <Ghost label="Cancel" onPress={() => setPlanFor(null)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showCoach} transparent animationType="slide" onRequestClose={() => setShowCoach(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowCoach(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
              {/* The same avatar rule as the card that opens this sheet, for the
                  same reason — see the comment there. */}
              <View style={{ width: 60, height: 60, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...value(20), color: coachName ? t.brand : t.ink3 }}>{coachName ? initialsOf(coachName) : head.text}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.head, color: coachName ? t.ink : t.ink3 }} numberOfLines={1}>{head.text}</Text>
                {/* This sheet has more room than anywhere else on the screen, so
                    the reason for the dash is stated here too and not left to
                    the card the reader has just tapped past. The tagline keeps
                    its own line below when there is one to show. */}
                {coachNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{coachNote}</Text> : null}
              </View>
            </View>

            {/* The tagline, specialties, bio and "what I offer" used to be read
                here from the coach-profile provider. Every one of those is a
                column on `trainers`, and a client has no row in `trainers` — so
                on this app they were always the empty string and the empty
                array, and this sheet rendered a coach with no bio, no
                specialities and nothing on offer. That is the same bug as the
                name and the photo above it, only quieter, because blank reads
                as "they never filled it in" rather than as somebody else's
                details.

                Saying we cannot read them is the honest version until there is
                a client-readable source. The name comes from my_coach()
                (supabase/parts/67), which is the pattern the rest of this would
                follow: one definer function, no arguments, answering only about
                the caller's own coach. */}
            <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.lg }}>
              Your coach&rsquo;s profile — what they specialise in, how they work, what they
              offer — isn&rsquo;t shared with this app yet. Ask them, or send them a message.
            </Text>
            <Rule />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: sp.lg }}>
              <Text style={{ ...ty.label, color: t.ink3 }}>Session rate</Text>
              <Text style={{ ...ty.body, color: t.ink3 }}>— ask your coach</Text>
            </View>
            <View style={{ marginTop: sp.xl }}>
              <Cta label="Close" wide onPress={() => setShowCoach(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
