// Trainer/Gym · Classes. Create and manage group classes across branches. Shows
// each upcoming class with its live booked/capacity, and a form to add a new one.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: the bordered
// form card and the bordered class rows became hairline-separated sections, the
// Georgia serif header is gone, and the booked/capacity figure reads as ink with
// a coloured mark beside it rather than as coloured text.
//
// The branch field stays free text: the picker it replaced offered six hardcoded
// Dubai locations a real gym may not have. The chips under it are only the
// branches this gym has itself used (`branchesFrom`), and a class still cannot
// be added without one.
//
// Two things this screen used to get wrong about its own reads:
//
//   · it took `classes` from `useClasses()` and ignored the `status` beside it,
//     so a refused read drew an empty week under the words "No classes yet".
//     This screen is a timetable; an empty timetable is a coach's plan for
//     their week, and they act on it by not turning up.
//   · `addClass` resolves false when the insert never reached `gym_classes`,
//     and the alert said "Class added" either way. A class that exists on the
//     coach's phone alone is on nobody's timetable and cannot be booked.
import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, PageHead, Cta, Ghost, Flag, Notice, PartialRead, Field, Ring, Meter, TonedChip, IconPlate, fig, HERO_FIT } from '../../src/ui/kit';
import { sharePercent } from '../../src/lib/sharePercent';
import { sp, layout, radius, hairline, type as ty, value, fontScale, font } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
import { useMyGymKit } from '../../src/ui/coachKit';
import { GymKitRegister } from '../../src/ui/GymKitRegister';
// ── The other half of a coach's week at the gym ───────────────────────────
//
// `gym_shifts` (supabase/parts/43) has admitted this gym's trainers since it
// was written, under a policy whose own comment says "a rota nobody rostered on
// it can see is a rota that gets re-typed into WhatsApp". Both readers built on
// it are the owner's — app/(owner)/rota.tsx and studio-web/app/staff — so the
// coach on the Saturday had no way to see it.
//
// It sits on this screen because this screen is already the coach's week at the
// gym: the classes they teach are here, and the hours the gym has them on the
// floor are the rest of the same week. Read-only, because `gym_shifts_owner` is
// the only policy granting anything but SELECT.
import { useMyRota } from '../../src/ui/coachRota';
import { MyShifts } from '../../src/ui/MyShifts';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { CLASS_KINDS, branchesFrom, type GymClass } from '../../src/lib/classesMock';
import {
  atTimeOfDay, daysLater, duplicatePlan, duplicateBrief, duplicateBlocker, duplicateOutcome,
  weeksLater,
} from '../../src/lib/classSeries';
// The quarter-hour grid, taken from the module that owns it rather than
// written out again here. app/(trainer)/calendar.tsx makes the argument on
// `MINUTES`: one list, stated once, so the pickers cannot drift apart.
import { SERIES_MINUTES } from '../../src/lib/recurring';
// ── Two classes in one room at one time ───────────────────────────────────
//
// app/(trainer)/calendar.tsx checks a PT booking against the classes this coach
// teaches before writing one (`classClashes`, with `classCheckCaveat` for the
// unread timetable). The screen where classes are TYPED IN asked nothing, so a
// Reformer added over the Spin already in Studio 2 went on sale beside it and
// both filled. Repeat ×12 makes twelve of those from one press.
//
// A warning and not a refusal, and never silence under a read that did not
// finish — src/lib/classRoomClash.ts carries the whole argument.
import { roomClashesFor, roomClashNote } from '../../src/lib/classRoomClash';
import { isWhole } from '../../src/ui/loadStatus';
import { fmtClock, fmtRelativeDay, fmtTime } from '../../src/lib/format';
// ── Editing a class from the phone ────────────────────────────────────────
//
// These eight writes have existed in src/lib/gymSchedule.ts since part 195 and
// the only imports of that module anywhere were `pct` on the owner's rota and
// `classFillState` on the client's timetable. So `addClass` on this screen would
// write twelve rows in one tap and there was no way to unwrite them: a typo'd
// capacity, a snowed-off Tuesday or a mis-tapped repeat was permanent from a
// coach's phone, and the only fix was a laptop and the Studio console, which
// most independent coaches do not have.
//
// The module takes its Supabase client as an argument precisely so neither
// front end owns it. Nothing here is new behaviour on the server.
import {
  cancelClass, cancelSeriesFrom, deleteClass, restoreClass, updateClass, updateSeriesFrom,
} from '../../src/lib/gymSchedule';
import { assertChanged } from '../../src/lib/changedRows';
// ── Telling the room ──────────────────────────────────────────────────────
//
// supabase/parts/493 writes an inbox row to everybody booked or waitlisted the
// moment a class goes to 'cancelled', and that is the whole of what the schema
// can do: nothing server-side in this product turns a `notifications` insert
// into a push, because part 26's `messages` trigger is the only writer that
// reaches pg_net at all. So the row existed and the phone never rang, and the
// twelve people booked on a 6am found out when they next opened the app —
// after they had travelled to a locked room, which is the exact failure part
// 493's own header describes and only half closes.
//
// The push therefore goes from here, the handset that pressed the button, the
// way every other push in this product does. The ROW stays the trigger's:
// src/lib/notifyInbox.ts refuses to record this one, so a member gets one
// notification and not two differently-worded copies of the same cancellation.
import { classOffConfirmation } from '../../src/lib/notifyCopy';
import { sendPushChecked } from '../../src/ui/pushNotifications';
import { tellTheCancelledRoom } from '../../src/lib/classOff';
import { supabase } from '../../src/lib/supabase';

// The weekday name, the date order and the clock were all this file's own, and
// all three were English and British. `DOW` was a hardcoded array; the fallback
// wrote `${d.getDate()}/${d.getMonth() + 1}`, which a coach in the United
// States reads month-first — "Wed 9/12" is 9 December here and 12 September
// there — and `timeLabel` hand-built a 12-hour clock with no 24-hour form at
// all, so a coach in Berlin scheduling a class read "7pm".
//
// This is the same defect the four client booking screens had removed from them
// (see the header of app/(client)/classes.tsx) recurring on the coach's side,
// on the screen where the date and time are TYPED IN rather than read back: a
// day chip somebody misreads here writes a class onto the timetable at the
// wrong time, and every member who books it turns up on the wrong evening.
//
// All three are the reader's now. `fmtRelativeDay` also answers "Tomorrow",
// which the local helper never did.

/**
 * How far the Manage sheet lets a coach nudge a class's date, in days either
 * side of the day it is currently on.
 *
 * A week each way and not a date picker. What this control is for is correcting
 * something that was typed in wrong — the wrong evening, the wrong hour — and a
 * class that belongs in a different month is a different class, added from the
 * form above. A fortnight of chips is also a row a thumb can reach the end of.
 */
const MOVE_DAYS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
const timeLabel = (iso: string) => fmtTime(iso);
const dayShort = (iso: string) => fmtRelativeDay(iso);

export default function TrainerClasses() {
  const t = useTheme();
  const router = useRouter();
  // `status` alongside the rows, because this screen draws a timetable and an
  // empty timetable is a sentence: nothing is scheduled. Under 'error' the list
  // is empty because the read did not come back, and a coach who reads that as
  // a free week does not turn up to teach. Under 'partial' the classes shown
  // are real but the far end of the schedule is missing.
  const { classes, addClass, countsKnown, status, refresh } = useClasses();
  // ── the kit the timetable above is written on ─────────────────────────
  //
  // `gym_equipment` has admitted this coach since supabase/parts/34 and no
  // screen in `app/(trainer)/**` had ever selected it, so the register was
  // written by the person who buys the kit and read by the person who buys the
  // kit. A capacity of 14 is a claim about the room — `capacityFor` in
  // src/lib/gymEquipment.ts makes the argument — and it stops being true the
  // moment six of the rowers go down. The coach filling in the form above was
  // the one person who could not see that.
  //
  // Its own hook, its own status: a refused equipment read must not take down
  // the timetable, which is the bigger answer on this screen.
  const kit = useMyGymKit();
  // Its own hook and its own status, for the same reason: a refused rota read
  // must not take the timetable down, and a refused timetable must not be
  // allowed to draw an empty fortnight of shifts.
  const rota = useMyRota();
  // One source, and the booking counts on these rows move without this coach
  // doing anything — a member books or drops a class from their own phone.
  // The register comes down with it: a rower taken out of action by whoever
  // was standing next to it is exactly the kind of change a coach pulls for.
  const pull = usePullToRefresh(useCallback(() => { refresh(); kit.refresh(); rota.refresh(); }, [refresh, kit.refresh, rota.refresh])); // eslint-disable-line react-hooks/exhaustive-deps -- both refreshes are the stable identities from their hooks, not the objects

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>(CLASS_KINDS[0]);
  // Branch is typed in. It used to be a picker over six hardcoded Dubai
  // locations; chips below now offer only branches this gym has already used.
  const [branch, setBranch] = useState<string>('');
  const [room, setRoom] = useState('');
  const [instructor, setInstructor] = useState('');
  /** Which week the class is in, 0 being the one starting today. */
  const [weekOff, setWeekOff] = useState(0);
  /** Which day within that week, 0 being the same weekday as today. */
  const [dayOff, setDayOff] = useState(0);
  const [hour, setHour] = useState(18);
  /**
   * Minutes past the hour.
   *
   * `d.setHours(hour, 0, 0, 0)` hard-zeroed this, so a 6:30am spin class could
   * not be put on the timetable at all. The sister screen fixed the same defect
   * for one-to-ones and wrote down why (app/(trainer)/calendar.tsx, `MINUTES`):
   * a start that has to be rounded to the hour makes the record wrong either
   * way it is rounded.
   */
  const [minute, setMinute] = useState(0);
  const [dur, setDur] = useState(45);
  const [cap, setCap] = useState(16);
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Two fields or three steppers on one row stop fitting at the larger
  // text sizes; they stack from there rather than shrink.
  const stackControls = fontScale >= 1.25;
  /** How many more weeks "Same Again" runs a series for. Its own state, and not
   *  `weeks`: that one belongs to the form above and a coach who set it to 12
   *  three minutes ago did not thereby ask for twelve more Reformer classes. */
  const [againWeeks, setAgainWeeks] = useState(12);
  /** The class currently being repeated, so two taps cannot fan out twice. */
  const [againBusy, setAgainBusy] = useState<string | null>(null);
  /**
   * `againBusy`, claimed the instant the control is pressed rather than after
   * the coach has answered the confirmation.
   *
   * The state flag below is set on the far side of an `await` on an Alert, so
   * for the whole time the dialog is up it is still null and a second press
   * opens a second dialog. Both closures then compute their plan from the same
   * captured `classes`, so `duplicatePlan`'s "skip the dates already on the
   * timetable" filter cannot see the first run's writes — two confirmations
   * write the term twice, up to twenty-four rows where twelve were offered, and
   * every phantom one is a class members can book.
   *
   * A ref, and claimed BEFORE the dialog: the thing that has to be exclusive is
   * the whole act, from the press to the last row written, and the dialog is
   * inside it.
   */
  const repeating = useRef(false);
  const knownBranches = branchesFrom(classes);

  /* ── managing a class that is already on the board ──────────────────────
   *
   * One sheet rather than three buttons per row: the row is a timetable entry
   * and a coach reads twenty of them, so the verbs live behind the class they
   * act on. Everything in here writes through src/lib/gymSchedule.ts, which
   * checks the ROW COUNT on every write — the two policies on `gym_classes`
   * filter rather than refuse, so a coach editing somebody else's class matches
   * nothing and gets no error, and the board would redraw unchanged.
   */
  const [manage, setManage] = useState<GymClass | null>(null);
  const [mTitle, setMTitle] = useState('');
  const [mInstructor, setMInstructor] = useState('');
  const [mRoom, setMRoom] = useState('');
  const [mCap, setMCap] = useState(16);
  const [mDur, setMDur] = useState(45);
  const [mReason, setMReason] = useState('');
  /* ── the field the sheet could not change ───────────────────────────────
   *
   * `saveEdits` built a patch of title, instructor, room, capacity and duration
   * and never `startsAt` — which `updateClass` has accepted since part 195. So a
   * class typed in at 6am instead of 6pm, or put on the Wednesday instead of the
   * Tuesday, could only be fixed by calling it off and typing it again, which
   * strands every booking on the row that gets deleted.
   *
   * Held as an offset in days from the class's own date plus an hour and a
   * minute, rather than as a whole new instant: what a coach is doing is
   * correcting a time, and a date picker that started from today would be
   * offering to move a class they were only trying to shift by an hour.
   */
  const [mDayOff, setMDayOff] = useState(0);
  const [mHour, setMHour] = useState(18);
  const [mMinute, setMMinute] = useState(0);
  /** Whether an edit or a call-off applies to this occurrence or to every later
   *  one in its series. Only offered when the row actually belongs to a series;
   *  a one-off has `seriesId` null and the two verbs would be the same button. */
  const [mSeries, setMSeries] = useState(false);
  const [mBusy, setMBusy] = useState(false);

  const openManage = (c: GymClass) => {
    setManage(c);
    setMTitle(c.title);
    setMInstructor(c.instructor);
    setMRoom(c.room);
    setMCap(c.capacity);
    setMDur(c.durationMin);
    setMReason('');
    setMSeries(false);
    // Seeded from the class as it stands, so opening the sheet and saving
    // without touching the time changes nothing about the time.
    const at = new Date(c.startsAt);
    setMDayOff(0);
    setMHour(Number.isFinite(at.getTime()) ? at.getHours() : 18);
    setMMinute(Number.isFinite(at.getTime()) ? at.getMinutes() : 0);
  };

  /**
   * Where the class would start after the corrections in the sheet, or null
   * when its own date cannot be read.
   *
   * Both steps go through src/lib/classSeries.ts rather than through millisecond
   * arithmetic here: nudging the date by 86,400,000ms moves a 6pm class to 5pm
   * across a clocks change, which is the defect the Repeat loop on this same
   * screen had.
   */
  const movedStart = (c: GymClass): string | null => {
    const shifted = daysLater(c.startsAt, mDayOff);
    return shifted ? atTimeOfDay(shifted, mHour, mMinute) : null;
  };

  /** True when the sheet is actually asking to move the class. An unchanged
   *  time is left out of the patch entirely — `updateClass` writes only the
   *  keys it is given, and re-writing the same instant is a change nobody made
   *  that shows up in the row's history. */
  const startChanged = (c: GymClass): boolean => {
    const next = movedStart(c);
    return !!next && next !== new Date(c.startsAt).toISOString();
  };

  /** The one place a write's failure becomes a sentence. Every function in
   *  gymSchedule.ts throws with a sentence already written for the reader —
   *  `assertWrote` builds it — so it is shown rather than replaced. */
  const runWrite = async (title: string, done: string, fn: () => Promise<void>) => {
    if (mBusy) return;
    setMBusy(true);
    try {
      await fn();
      setManage(null);
      refresh();
      Alert.alert(title, done);
    } catch (e) {
      Alert.alert('Not Saved', e instanceof Error && e.message ? e.message : 'That did not reach the server, so nothing has changed on the timetable. Try again once you have signal.');
    } finally { setMBusy(false); }
  };

  const saveEdits = (c: GymClass) => {
    const patch: {
      title: string; instructor: string; room: string; capacity: number;
      durationMin: number; startsAt?: string;
    } = {
      title: mTitle.trim() || c.title,
      instructor: mInstructor.trim(),
      room: mRoom.trim(),
      capacity: mCap,
      durationMin: mDur,
    };
    // The correction this sheet could not make. Only for THIS class — see the
    // series branch below, which strips it and says why.
    const moved = movedStart(c);
    if (moved && startChanged(c)) patch.startsAt = moved;
    // Below what is already booked is refused here rather than by the server:
    // `gym_classes.capacity` has no such constraint, and a class of 12 dropped
    // to 8 with 12 people in it turns four members into an over-sell nobody
    // decided on. Withheld under an unread count, because "8 booked" is exactly
    // the figure `countsKnown` says may be a zero standing in for a failed read.
    // A class moved behind the coach is on nobody's timetable and cannot be
    // booked, and everybody already in it is left holding a place at a time
    // that has been and gone. Said under the control as well, because a Save
    // that silently will not commit reads as a broken button.
    if (patch.startsAt && Date.parse(patch.startsAt) <= Date.now()) {
      Alert.alert('That Time Has Already Passed',
        `${patch.title} would start ${dayShort(patch.startsAt)} at ${timeLabel(patch.startsAt)}, which is behind you. Members cannot book a class in the past, and the ones who already booked this would be holding a place at a time that has gone. Pick a time that is still ahead.`);
      return;
    }
    if (countsKnown && patch.capacity < c.booked) {
      Alert.alert('Capacity Is Below the Bookings',
        `${c.booked} ${c.booked === 1 ? 'person has' : 'people have'} already booked this class, so it cannot hold ${patch.capacity}. Cancel a booking first, or leave the capacity where it is.`);
      return;
    }
    if (mSeries && c.seriesId) {
      // Never the start time. Moving a whole series means moving each
      // occurrence by the same offset; setting them all to one instant would
      // stack twelve classes on one Tuesday evening. gymSchedule.ts refuses to
      // accept `startsAt` here for exactly that reason.
      //
      // The time control is not drawn under "This And Later", so a coach
      // cannot get here having set one — but the key is taken off the patch
      // rather than trusted to be absent, because the alternative is a silent
      // type error the day somebody reorders this sheet.
      const { startsAt: _movedForSeries, ...seriesPatch } = patch;
      void (async () => {
        if (mBusy) return;
        setMBusy(true);
        try {
          const n = await updateSeriesFrom(supabase, c.seriesId as string, c.startsAt, seriesPatch);
          // The count, not the absence of an error — the rule this sheet's own
          // header states and the single-class path keeps through `assertWrote`
          // inside `updateClass`. `updateSeriesFrom` hands back a row count and
          // nothing tested it, so a coach who opened Manage on a colleague's
          // class was shown a dialog TITLED "Series updated" reading "0 classes
          // from this one onward were changed", and left believing the term had
          // moved.
          //
          // Zero here can only be a refusal: the class the sheet was opened on
          // is itself in the series and its own start is the lower bound, so
          // `series_id = X and starts_at >= c.startsAt` matches at least that
          // row for anybody permitted to change it.
          assertChanged('That change to the series', n);
          setManage(null);
          refresh();
          Alert.alert('Series Updated', `${n} ${n === 1 ? 'class' : 'classes'} from this one onward ${n === 1 ? 'was' : 'were'} changed. Classes that have already run are untouched, because they are the gym's record of what happened.`);
        } catch (e) {
          Alert.alert('Not Saved', e instanceof Error && e.message ? e.message : 'That did not reach the server, so nothing has changed on the timetable.');
        } finally { setMBusy(false); }
      })();
      return;
    }
    // The move is named in the confirmation, because it is the one edit here
    // that changes where members have to be and when. Everything else changes
    // what the row says about a class they are already coming to.
    const done = patch.startsAt
      ? `${patch.title} now starts ${dayShort(patch.startsAt)} at ${timeLabel(patch.startsAt)}. Everyone who booked it keeps their place. Tell them, because moving a class does not notify anybody.`
      : `${patch.title} was changed.`;
    void runWrite('Class Updated', done, () => updateClass(supabase, c.id, patch));
  };

  /**
   * Tell everybody who had booked or was waiting.
   *
   * Called only with the ids of classes the server CONFIRMED it cancelled —
   * `cancelClass` throws when the update matched nothing and `cancelSeriesFrom`
   * returns only the rows it changed — so a second tap has nobody to notify
   * rather than sending a second round of banners about the same cancellation.
   *
   * ── What the three numbers mean ─────────────────────────────────────────
   *
   * `people` null is a roster that could not be READ, which is not nobody: it
   * is the case where the coach has to go and tell them, and reporting it as
   * zero is how twelve people arrive at a locked room believing the app told
   * them. `pushed` counts the people in the buckets whose send-push call was
   * accepted — queued with Expo, never witnessed as delivered.
   *
   * The person who pressed the button is dropped, the same exclusion part 493's
   * trigger makes with `auth.uid()`: a coach booked into their own class is
   * watching it happen.
   */
  const tellTheRoom = useCallback(async (
    classIds: readonly string[], classTitle: string, why: string,
  ): Promise<{ people: number | null; pushed: number; partial: boolean }> => {
    let me: string | null = null;
    // A failed read of our own id costs the coach one notification about their
    // own cancellation. A failed read of the roster costs twelve people theirs,
    // which is why only the second one is reported — and that is reported by
    // tellTheCancelledRoom, as `people: null`.
    try { me = (await supabase.auth.getUser()).data?.user?.id ?? null; } catch { me = null; }
    // The body of this function moved to src/lib/classOff.ts unchanged, so
    // studio-web can send the SAME aggregated notification instead of leaning
    // on the database dispatcher — which is what made this screen's push the
    // second of two. See that file's header and part 2392.
    return tellTheCancelledRoom(supabase, classIds, classTitle, why, me,
      (ids, title, body, data, channel) => sendPushChecked(ids, title, body, data, channel as any));
  }, []);

  const callOff = (c: GymClass) => {
    const why = mReason.trim();
    if (!why) {
      Alert.alert('Say Why It Is Off',
        'A cancelled class with no reason tells the next reader nothing. "Instructor off sick" and "nobody booked it" are the two answers that are worth having in three months.');
      return;
    }
    const series = !!(mSeries && c.seriesId);
    void (async () => {
      if (mBusy) return;
      setMBusy(true);
      try {
        // The ids of what was actually cancelled, and nothing else is notified.
        // The single case is `[c.id]` only because `cancelClass` throws unless
        // the update matched — see assertWrote in src/lib/wroteRows.ts.
        let ids: string[];
        if (series) {
          ids = await cancelSeriesFrom(supabase, c.seriesId as string, c.startsAt, why);
          // Counted, for the reason the single-class arm below does not have to
          // be: `cancelClass` throws unless the update matched, and
          // `cancelSeriesFrom` returns a list nobody was checking. An empty one
          // produced "Series called off — 0 classes were called off … there was
          // nobody to tell", under that title, over a term that is still on and
          // still bookable, and the coach walked away from it.
          //
          // Two innocent readings here rather than one, and the sentence
          // carries both: the writer adds `.neq('status', 'cancelled')`, so a
          // term already off matches nothing without anybody having been
          // refused. Which of the two happened is not visible from here, and
          // the coach's next act is the same either way.
          assertChanged('That series', ids.length, 'those classes were already called off');
        } else {
          await cancelClass(supabase, c.id, why);
          ids = [c.id];
        }
        const told = await tellTheRoom(ids, c.title, why);
        setManage(null);
        refresh();
        Alert.alert(
          series ? 'Series Called Off' : 'Class Called Off',
          classOffConfirmation(ids.length, told.people, told.pushed, told.partial),
        );
      } catch (e) {
        Alert.alert('Not Saved', e instanceof Error && e.message ? e.message : 'That did not reach the server, so the classes are still on the timetable.');
      } finally { setMBusy(false); }
    })();
  };

  const putBackOn = (c: GymClass) => {
    void runWrite('Class Back On', `${c.title} is on the timetable again and can be booked.`,
      () => restoreClass(supabase, c.id));
  };

  /**
   * Erase a class that should never have been typed in.
   *
   * `class_bookings.class_id` is `on delete cascade`, so this destroys every
   * booking, every check-in and the whole waiting list with the row — and the
   * month's fill rate quietly improves, because the class that went badly is no
   * longer in the average. It is offered ONLY for a class nobody has booked,
   * and only when the counts are known to be real: a zero standing in for a
   * failed read is exactly the number that would make this look safe.
   */
  const removeClass = (c: GymClass) => {
    Alert.alert('Remove This Class?',
      `${c.title} is deleted outright. Use Call Off instead for a class that was on the timetable and did not happen. That keeps the row and the record.`, [
      { text: 'Keep It', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => { void runWrite('Class Removed', `${c.title} is off the timetable.`, () => deleteClass(supabase, c.id)); },
      },
    ]);
  };

  /**
   * Whether deleting is even offered. Unknown counts are not an empty class.
   *
   * `c.waiting === 0`, never `(c.waiting ?? 0) === 0`. `GymClass.waiting` is
   * `number | null` and src/ui/classes.tsx says in so many words why: the
   * `waiting` column arrived with part 210, a read that cannot produce it
   * stores null, and "these NEVER settle to zero, because 'nobody is waiting'
   * is exactly the claim that…". The `??` made that claim anyway, one line
   * under a comment promising it would not.
   *
   * `countsKnown` does not cover it. That flag is about the counts read having
   * come back at all; a class can be IN that answer with a null `waiting` —
   * line 271 of the provider maps a non-numeric `waiting` to null per class,
   * not per read — so a whole, successful read can still carry "we do not know
   * who is waiting for this one".
   *
   * The consequence is the reason this is the guard and not a warning:
   * `class_bookings.class_id` is `on delete cascade`, so Remove destroys every
   * booking, every check-in and the whole waiting list with the row. An unknown
   * waiting list read as an empty one is a queue of members deleted by a coach
   * who was shown a control that said the class was empty.
   */
  const canRemove = (c: GymClass) => countsKnown && c.booked === 0 && c.waiting === 0;

  const upcoming = useMemo(() => [...classes].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), [classes]);

  /** How many days from today the class starts. Week and day are picked
   *  separately — hour then minute, applied to a date — because one scroller of
   *  eight weeks of days is a drag through a haystack, and two short reads is
   *  what the time picker on the sister screen already settled on. */
  const offsetDays = weekOff * 7 + dayOff;
  const startIso = () => { const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
  const canAdd = title.trim().length > 0 && branch.trim().length > 0;
  // `addClass` resolves false when the insert did not reach `gym_classes`, and
  // this used to discard that and announce "Class added" either way. A class
  // that exists on the coach's phone alone is on nobody's timetable and cannot
  // be booked — the members it was scheduled for never see it, and the coach has
  // been told it is up. What is reported now is what the server actually took.
  const submit = async () => {
    if (!canAdd || busy) return;
    // ── the same refusal the Manage sheet makes, on the form that needs it
    //    first ────────────────────────────────────────────────────────────
    //
    // `startIso` builds the start from a Day chip that defaults to TODAY and
    // an hour that defaults to 18:00, so a coach adding tomorrow's class at
    // eight in the evening and leaving the chip where it sits writes one two
    // hours behind them. `addClass` takes the row and resolves true, so the
    // alert says "Class added" — and the read this screen and every member's
    // timetable run is `.gte('starts_at', now - 1 hour)` (src/ui/classes.tsx),
    // so a class two hours past is outside the grace window and invisible to
    // everyone, permanently. The coach is told it is up and nobody can ever
    // book it. `saveEdits` below refuses this exact instant for this exact
    // reason; "Same Again" skips these dates; only the create form took them.
    //
    // The WHOLE batch is refused rather than the past occurrences skipped,
    // which is the opposite of what duplicatePlan does with the same problem,
    // and deliberately. Over there the dates in the past fall out of a run
    // length applied to a series that already exists — the coach never named
    // them, so dropping them and saying how many is a correction to an
    // estimate. Here the start IS the input: one chip and one hour, printed
    // back as a sentence under the picker. A start in the past is that input
    // typed wrong, and skipping it would silently move a twelve-week term to
    // begin a week later than the line the coach just read, at an hour they
    // had got wrong, and report it as added. One chip fixes it.
    const first = startIso();
    if (Date.parse(first) <= Date.now()) {
      Alert.alert('That Time Has Already Passed',
        `${title.trim()} would start ${dayShort(first)} at ${timeLabel(first)}, which is behind you. Members cannot book a class in the past, so it would be on nobody's timetable however many weeks it repeated for. Pick a time that is still ahead.`);
      return;
    }
    /* ── and what is already in that room ───────────────────────────────
     *
     * Every occurrence, not just the first: a term of twelve that collides on
     * week nine is nine weeks of two classes on sale for one room, and checking
     * only the opening night would clear it.
     *
     * Asked BEFORE `setBusy`, because the coach may answer no and the form has
     * to stay exactly as they left it. Answered with a confirmation rather than
     * a refusal — `gym_classes.room` is free text, a hall that splits in two is
     * a real gym, and this cannot see the room. What it must not do is say
     * nothing, and under a timetable that did not fully load it says that
     * instead of implying the hour is free.
     */
    const plannedStarts = Array.from({ length: Math.max(1, weeks) }, (_, w) => weeksLater(first, w))
      .filter((s): s is string => s !== null);
    const roomNote = roomClashNote(
      roomClashesFor(plannedStarts, dur, branch.trim(), room.trim(), classes, isWhole(status)),
      room.trim(),
      (iso) => `${dayShort(iso)} ${timeLabel(iso)}`,
    );
    if (roomNote) {
      const go = await new Promise<boolean>((resolve) => {
        Alert.alert('Check the Room', roomNote, [
          { text: 'Change It', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Add Anyway', onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) });
      });
      if (!go) return;
    }
    setBusy(true);
    try {
      /* ── one instant, read once ────────────────────────────────────────
       *
       * This called `startIso()` three more times after the guard above had
       * checked `first` — so four reads of `new Date()` for one value the coach
       * chose from two chips and a clock. `startIso` is `new Date()` with the
       * day offset added and the hour set, which makes it a function of WHEN IT
       * IS CALLED as much as of what was picked.
       *
       * The whole point of the guard is that the instant it approves is the
       * instant that gets written. It was not: a press that straddles midnight
       * has `first` validated against one calendar day and `base` — the value
       * actually written, and `when` — the value read back in the confirmation —
       * landing on the next one, a full day away from the chip the coach set.
       * The three could disagree with each other and with the sentence on
       * screen, and the class that appears is not the class that was approved.
       *
       * `first` is already that value. Everything below is derived from it.
       */
      const firstIso = first;
      const nm = title.trim(); const br = branch.trim();
      const when = `${dayShort(firstIso)} ${timeLabel(firstIso)}`;
      let saved = 0;
      for (let w = 0; w < weeks; w++) {
        // Weeks added on the CALENDAR, not on the clock. This was
        // `base.getTime() + w * 7 * 86400000`, which src/lib/classSeries.ts
        // names as wrong twice a year and already exports `weeksLater` to
        // replace: a 6pm class repeated across a daylight-saving boundary
        // lands at 5pm or 7pm, and the members who booked it turn up an hour
        // out. The whole of Repeat ×4/×8/×12 went through that one line.
        const at = weeksLater(firstIso, w);
        // Unreachable while `base` parses, which `startIso` guarantees — but
        // the loop must not write `undefined` as a start if it ever stops
        // being true, because that is a class nobody can find.
        if (!at) continue;
        if (await addClass({ title: nm, kind, instructor: instructor.trim() || 'Coach', branch: br, room: room.trim(), startsAt: at, durationMin: dur, capacity: cap })) saved++;
      }
      // The form is only cleared on a clean save. Clearing it after a refusal
      // throws away everything the coach typed and leaves them nothing to
      // retry from.
      if (saved === weeks) { setTitle(''); setRoom(''); }
      if (saved === weeks) {
        Alert.alert(weeks > 1 ? 'Classes Added' : 'Class Added', weeks > 1
          ? `${weeks} weekly ${nm} classes at ${br}, starting ${when}.`
          : `${nm} · ${br} · ${when}`);
      } else if (saved === 0) {
        Alert.alert('Not on the Timetable', weeks > 1
          ? `None of the ${weeks} ${nm} classes reached the server, so they are on this phone only and nobody can book them. They will be gone when you reopen the app. Try again once you have signal.`
          : `${nm} did not reach the server, so it is on this phone only and nobody can book it. It will be gone when you reopen the app. Try again once you have signal.`);
      } else {
        Alert.alert('Partly Added', `${saved} of ${weeks} ${nm} classes reached the server. The other ${weeks - saved} are on this phone only and cannot be booked. Add them again once you have signal.`);
      }
    } finally { setBusy(false); }
  };

  /* ── "same again next term" ────────────────────────────────────────────
   *
   * Repeat above is 1/4/8/12 weeks AT CREATION and nowhere else, so twelve
   * weeks later the Tuesday 6pm Reformer simply stops and the only way to put
   * it back is to re-type nine fields from memory for a class that is on the
   * screen in front of the coach. This copies the row it is given, weekly, from
   * the LAST occurrence of its series — see src/lib/classSeries.ts for what a
   * "series" is here (a description of matching rows, not a record) and why the
   * run starts after the last class rather than after today.
   *
   * It refuses under anything but a whole read of the timetable. A duplicate's
   * one job is to land on empty slots, and under 'partial' the rows missing
   * from this screen are the ones furthest ahead — exactly the ones a next-term
   * run would collide with.
   */
  const repeatSeries = async (c: GymClass) => {
    if (againBusy || repeating.current) return;
    repeating.current = true;
    try {
      await repeatSeriesOnce(c);
    } finally {
      repeating.current = false;
    }
  };

  const repeatSeriesOnce = async (c: GymClass) => {
    const why = duplicateBlocker(status);
    if (why) { Alert.alert('Not Repeated', why); return; }
    const plan = duplicatePlan(c, classes, againWeeks, new Date());
    const brief = duplicateBrief(plan);
    if (!brief.canWrite) { Alert.alert(brief.title, brief.body); return; }
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(brief.title, brief.body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: brief.confirmLabel, onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;
    setAgainBusy(c.id);
    let saved = 0;
    try {
      for (const occ of plan.toWrite) {
        if (await addClass({ ...plan.shape, startsAt: occ.startsAt })) saved++;
      }
    } finally { setAgainBusy(null); }
    const out = duplicateOutcome(plan.shape.title, plan.toWrite.length, saved);
    Alert.alert(out.title, out.body);
  };

  const G = layout.gutter;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;
  const lbl = { ...ty.caption, color: t.ink3, marginBottom: 6 } as const;
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, ...font('500'), color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  /**
   * The board's segment bar, for a choice with a FIXED handful of positions:
   * one `surface2` pill, equal segments, the chosen one filled in ink. The
   * chips above stay for the sets whose size this screen does not decide —
   * the branches a gym has, the eight weeks, the seven days — because a bar
   * with nine equal segments is nine labels each a syllable wide.
   */
  const seg = <K extends string | number>(items: readonly (readonly [K, string])[], active: K, onPick: (k: K) => void) => (
    <View accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.pill, padding: 3, gap: 2 }}>
      {items.map(([k, label]) => {
        const on = k === active;
        return (
          <Pressable key={String(k)} onPress={() => onPick(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 40, paddingHorizontal: sp.sm, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ink : 'transparent' }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
              style={{ ...ty.label, ...font(on ? '600' : '500'), ...HERO_FIT, color: on ? t.bg : t.ink2 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const stepper = (label: string, val: string, dec: () => void, inc: () => void) => (
    <View style={{ flexGrow: 1, flexBasis: 120, minWidth: 110 }}>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
        <Pressable onPress={dec} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Lower ' + label} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <Icon name="minus" size={15} color={t.ink2} />
        </Pressable>
        <Text style={{ ...value(15), color: t.ink, flex: 1, textAlign: 'center' }}>{val}</Text>
        <Pressable onPress={inc} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Raise ' + label} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <Icon name="plus" size={15} color={t.ink2} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <PageHead
          title="Classes"
          trailing={<Ghost icon="plus" a11yLabel={createOpen ? 'Close the new class form' : 'Schedule a class'} onPress={() => setCreateOpen((open) => !open)} />}
        />

        {/* ── how full the timetable is, as a picture ──────────────────────
            The page opened on a form heading and a list of "8/12"s. The one
            question a coach brings here — are my classes filling — was twenty
            fractions to add up. This is that sum: places taken over places
            offered, across the classes still going ahead.

            Gated the way every count on this screen is. `countsKnown` false
            means `booked` is a 0 standing in for a failed read, and a status
            other than 'ready' means the list itself is short or missing — in
            either case the ring draws its track and a dash, and the line
            beside it says which. The share goes through `sharePercent`, so one
            booking in two hundred places is not "0%". A cancelled class offers
            no places and is left out of both halves. */}
        {(() => {
          const live = upcoming.filter((c) => c.status !== 'cancelled');
          const whole = status === 'ready' && countsKnown;
          const places = live.reduce((a, c) => a + c.capacity, 0);
          const taken = live.reduce((a, c) => a + c.booked, 0);
          const waiting = live.reduce((a, c) => a + (c.waiting ?? 0), 0);
          const drawn = whole && places > 0;
          const share = drawn ? sharePercent(taken, places) : null;
          return (
            <Section>
              <SectionHead title="Places Filled" note="Upcoming classes" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.lg }}>
                <Ring tone="purple" size={112} value={drawn ? taken / places : null} figure={share}
                  spoken={drawn ? `${share ?? 'An unknown share'} of places filled, ${taken} of ${places}` : 'Places filled, not counted'} />
                <View style={{ flex: 1, minWidth: 140, gap: sp.xs }}>
                  <Text style={{ ...ty.head, color: t.ink }}>
                    {drawn ? `${taken} of ${places} places` : fig(null)}
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {status === 'loading' ? 'Reading your timetable…'
                      : status === 'error' ? 'Your timetable could not be read, so nothing is counted.'
                        : status === 'partial' ? 'Only part of your timetable loaded, so nothing is counted.'
                          : !countsKnown ? 'How many have booked could not be read. This is not a count of none.'
                            : places === 0 ? 'No classes scheduled yet.'
                              : `Across ${live.length} ${live.length === 1 ? 'class' : 'classes'}`}
                  </Text>
                  {drawn && waiting > 0 ? <TonedChip tone="amber" label={`${waiting} Waiting`} /> : null}
                </View>
              </View>
            </Section>
          );
        })()}

        {/* ── new class ──────────────────────────────────────────────────── */}
        <Section>
          {/* Folded until asked for. The form is eleven controls tall, and
              a coach who opens Classes to see today's timetable scrolled past
              all of them every time; the board keeps the timetable in view
              and offers the form as one row. Nothing about the form changed. */}
          <SectionHead title="Create a Class" note={createOpen ? 'Close' : 'New'} onPress={() => setCreateOpen((open) => !open)} />
          {!createOpen ? (
            <View>
              <Ghost label="Schedule a Class" icon="plus" onPress={() => setCreateOpen(true)} />
            </View>
          ) : (<>

          <TextInput value={title} onChangeText={setTitle} placeholder="Class title, e.g. Sunrise CrossFit" placeholderTextColor={t.ink3} style={inp}
            accessibilityLabel="Class Title" />

          <Text style={[lbl, { marginTop: sp.md }]}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {CLASS_KINDS.map((k) => chip(k, kind === k, () => setKind(k)))}
          </ScrollView>

          <Text style={[lbl, { marginTop: sp.md }]}>Branch</Text>
          <TextInput value={branch} onChangeText={setBranch} placeholder="Branch or location, e.g. your main studio" placeholderTextColor={t.ink3} style={inp} />
          {knownBranches.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2, marginTop: sp.sm }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
              {knownBranches.map((b) => chip(b, branch === b, () => setBranch(b)))}
            </ScrollView>
          ) : null}

          {/* Two names side by side, and which is which — and which of the two
              may be left empty — lived in placeholders that the first keystroke
              erased. */}
          <View style={{ flexDirection: stackControls ? 'column' : 'row', gap: sp.sm, marginTop: sp.md }}>
            <Field label="Instructor">
              <TextInput value={instructor} onChangeText={setInstructor} style={inp} />
            </Field>
            <Field label="Room" hint="optional">
              <TextInput value={room} onChangeText={setRoom} style={inp} />
            </Field>
          </View>

          {/* ── when ────────────────────────────────────────────────────────
              Week, then day, then hour, then quarter. The day row was seven
              chips starting today, so a one-off masterclass three weeks out
              could only be created by abusing weekly repeat and then deleting
              eleven classes — which, until this screen grew a delete, it could
              not do either. Eight weeks is the same horizon "Same Again"
              already writes into. */}
          <Text style={[lbl, { marginTop: sp.md }]}>Week</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((w) => chip(w === 0 ? 'This Week' : w === 1 ? 'Next Week' : `In ${w} Weeks`, weekOff === w, () => setWeekOff(w)))}
          </ScrollView>

          <Text style={[lbl, { marginTop: sp.md }]}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((o) => { const d = new Date(); d.setDate(d.getDate() + weekOff * 7 + o); return chip(fmtRelativeDay(d.toISOString()), dayOff === o, () => setDayOff(o)); })}
          </ScrollView>

          {/* All twenty-four, for the reason the calendar screen gives on
              `HOURS`: any hand-picked window is somebody's assumption about
              when training happens, and 5am to 10pm excluded the 4am opener
              and the late shift. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
            {stepper('Start Hour', fmtClock(hour, 0), () => setHour((h) => (h + 23) % 24), () => setHour((h) => (h + 1) % 24))}
            {/* "Minutes" — directly under "Start hour", and setting the class
                LENGTH. A coach reads "Start hour: 6:00 PM · Minutes: 45" as a
                quarter to seven, and the control that actually sets the minutes
                is the "Start time" row below. Named for what it does, and shown
                with its unit, the way the sister screen's Duration pills and
                the member's own class row already read (45m). */}
            {stepper('Duration', `${dur}m`, () => setDur((d) => (d > 15 ? d - 15 : d)), () => setDur((d) => (d < 90 ? d + 15 : d)))}
            {stepper('Capacity', String(cap), () => setCap((c) => (c > 4 ? c - 1 : c)), () => setCap((c) => c + 1))}
          </View>

          <Text style={[lbl, { marginTop: sp.md }]}>Start Time</Text>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {SERIES_MINUTES.map((m) => (
              <View key={m} style={{ flex: 1 }}>
                {/* The spoken label is the whole time. A row of four pills each
                    announcing a bare minute tells a screen-reader user nothing
                    about what they are choosing. */}
                <Pressable onPress={() => setMinute(m)} accessibilityRole="button"
                  accessibilityState={{ selected: m === minute }}
                  accessibilityLabel={fmtClock(hour, m)}
                  style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: m === minute ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, ...font(m === minute ? '500' : '400'), color: m === minute ? t.brandInk : t.ink2 }}>
                    :{String(m).padStart(2, '0')}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          {/* Said here as well as refused on Add, the way the Manage sheet says
              its capacity rule under the stepper it applies to: an Add Class
              that will not commit reads as a broken button, and this line —
              "Starts Today at 6:00 PM" under a Day chip that defaults to today
              — is the sentence that made the wrong time look right. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Starts {dayShort(startIso())} at {timeLabel(startIso())}.
          </Text>
          {Date.parse(startIso()) <= Date.now() ? (
            <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
              That is behind you. Members cannot book a class in the past, so it would be on nobody's timetable. Pick a later day or hour.
            </Flag>
          ) : null}

          <Text style={[lbl, { marginTop: sp.md }]}>Repeat</Text>
          {seg([[1, 'Just Once'], [4, 'Weekly ×4'], [8, 'Weekly ×8'], [12, 'Weekly ×12']] as const, weeks, setWeeks)}

          <View style={{ height: sp.lg }} />
          <Cta label={busy ? 'Adding…' : 'Add Class'} wide disabled={!canAdd || busy} onPress={submit} />
          </>)}
        </Section>


        {/* ── the schedule ───────────────────────────────────────────────── */}
        <Section>
          {/* The count is withheld unless the read was whole. Under 'partial'
              `upcoming.length` is the size of the page that arrived, and
              printing it beside "Upcoming" states it as the number of classes
              the gym has scheduled — which is the one figure a truncated read
              does not know. PartialRead below says "the first N" instead. */}
          <SectionHead title="Upcoming" note={status === 'ready' && upcoming.length ? String(upcoming.length) : undefined} />

          {/* How far "Same Again" runs. Above the list rather than inside each
              row, because it is one answer for whichever class the coach taps
              and repeating it per row would be twenty copies of the same
              control. Only drawn once there is something to repeat. */}
          {upcoming.length > 0 ? (
            <View style={{ marginBottom: sp.md }}>
              <Text style={lbl}>Same Again Runs For</Text>
              {seg([[4, '4 More Weeks'], [8, '8 More Weeks'], [12, '12 More Weeks']] as const, againWeeks, setAgainWeeks)}
              {/* One line. It states what the write will and will not do, which
                  is data about an act; the paragraph arguing for it was prose. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Counted from the last class in the series · dates already scheduled or past are skipped
              </Text>
            </View>
          ) : null}

          {/* An unread timetable is not an empty week. Without this the screen
              shows a coach with forty classes on the books a blank schedule and
              the words "No classes yet", and they plan their week around it. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Timetable" title="Your Schedule Could Not Be Read"
              note="Nothing is listed below because the classes did not come back. It does not mean nothing is scheduled. Anything you add here may duplicate a class that is already on the timetable, so check again once you have signal.">
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={refresh} /></View>
            </Notice>
          ) : status === 'partial' ? (
            <PartialRead what="classes on your timetable" shown={upcoming.length} onPress={refresh} />
          ) : null}

          {upcoming.map((c: GymClass, i) => {
            // Unknown is not "not full". Without the counts, `booked` is 0
            // for every class and nothing would ever read as full.
            const full = countsKnown && c.booked >= c.capacity;
            // Part 195 gave a called-off class a status and kept the row, with
            // its bookings and its attendance, precisely so it stays visible.
            // Until this branch existed the coach's timetable drew it exactly
            // like a class that was going ahead, so they turned up to a snowed
            // off Tuesday and told the members it was on.
            const off = c.status === 'cancelled';
            return (
              <View key={c.id} style={{
                flexDirection: stackControls ? 'column' : 'row', alignItems: stackControls ? 'stretch' : 'center', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    {/* The class plate: purple, the class colour on the calendar
                        and in the day sheet. A called-off class goes grey — it
                        is still on the record and no longer on the timetable. */}
                    <IconPlate icon="people" tone={off ? 'neutral' : 'purple'} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ ...ty.head, color: off ? t.ink2 : t.ink }}>{c.title}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.branch} · {dayShort(c.startsAt)} {timeLabel(c.startsAt)} · {c.kind}</Text>
                    </View>
                  </View>
                  {/* States as chips: the word on a plate in that hue's ink.
                      t.warn as TEXT does not clear 4.5:1 on the light palettes
                      and "Cancelled" is the most important word in this row —
                      the chip's ink is measured to, which is why it may now be
                      coloured where the old line could not. */}
                  {off || full || (countsKnown && c.waiting != null && c.waiting > 0) ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.xs, marginTop: sp.sm }}>
                      {off ? <TonedChip tone="amber" label="Cancelled" /> : null}
                      {!off && full ? <TonedChip tone="amber" label="Full" /> : null}
                      {/* ── the six people nobody could see ──────────────────
                          `class_counts()` counted a waitlister as a booking
                          until part 210, so this class read "17/12" and the
                          queue was folded into a number that made no sense.
                          Now they are separate, and the queue is the more
                          valuable of the two: a full class is a full class, and
                          a full class with six waiting is a second session on
                          Thursday.

                          Only drawn when there IS one. A "0 waiting" under
                          every class is furniture. A NULL waiting draws nothing
                          either — that is the counts read having failed or a
                          database without part 210, and "nobody is waiting" is
                          exactly the claim that would stop the second session.
                          The dash on the meter below already says the numbers
                          are unknown. */}
                      {countsKnown && c.waiting != null && c.waiting > 0 ? <TonedChip tone="orange" label={`${c.waiting} Waiting`} /> : null}
                    </View>
                  ) : null}
                  {off ? (
                    <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>
                      {c.cancelReason?.trim() ? c.cancelReason.trim() : 'No reason was recorded.'} Kept with its bookings for the record.
                    </Text>
                  ) : (
                    /* The fill as a bar, not a fraction to be divided in the
                       head. Unknown is not "not full": without the counts
                       `booked` is 0 for every class, so `val` is null — no
                       fill, and a dash where the figure goes. */
                    <Meter label="Booked" tone={full ? 'amber' : 'purple'}
                      val={countsKnown ? c.booked : null} target={c.capacity}
                      unit="" note={countsKnown ? `${c.booked} of ${c.capacity}` : undefined} />
                  )}
                </View>
                <View style={{ gap: 6, flexDirection: stackControls ? 'row' : 'column', flexWrap: stackControls ? 'wrap' : 'nowrap' }}>
                  {/* Neither verb is offered on a class that was called off.
                      There is no register to take for a room that never opened,
                      and repeating a cancelled Tuesday for twelve weeks is the
                      one thing a coach reaching for "Same Again" cannot mean. */}
                  {off ? null : (
                  <Ghost label="Check In" onPress={() => router.push({ pathname: '/(trainer)/class-checkin', params: { id: c.id, title: c.title, branch: c.branch } })} />
                  )}
                  {/* The nine fields a coach otherwise re-types every term. It
                      is a Ghost rather than a Cta because it is not the thing
                      this row is for — taking the register is — and because it
                      writes to the timetable rather than to somebody's record,
                      so it needs no destructive styling. */}
                  {off ? null : (
                  <Ghost label={againBusy === c.id ? 'Repeating…' : 'Same Again'} onPress={() => { void repeatSeries(c); }} />
                  )}
                  {/* The verbs that were only in the Studio console. Behind the
                      class rather than beside it, because a coach reads twenty
                      of these rows and three more buttons on each is a wall. */}
                  <Ghost label="Manage" onPress={() => openManage(c)} />
                </View>
              </View>
            );
          })}
          {/* Only a settled, whole read may claim the gym has no classes. Under
              'error' the Notice above has already said we do not know, and under
              'loading' nobody has been asked yet. */}
          {upcoming.length === 0 && status === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No classes yet. Add your first above.</Text>
          ) : upcoming.length === 0 && status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your timetable…</Text>
          ) : null}
        </Section>


        {/* The hours the gym has this coach on, under the classes they teach:
            both are the same fortnight and a coach reading one wants the other.
            Read-only — the rota is the gym's to write. */}
        <MyShifts rota={rota} />


        {/* Below the timetable rather than above it: this screen is for
            scheduling, and the register is the constraint on it, not the
            subject. A coach who has just typed a capacity of 14 scrolls past
            the reason it might only be 9. */}
        <GymKitRegister kit={kit} />

      </ScrollView>

      {/* ── manage one class ─────────────────────────────────────────────── */}
      {/* ── the keyboard covered this sheet ────────────────────────────────
          A bottom sheet is anchored to the bottom of the window, so the keyboard comes
          up OVER it: the reason a class was called off is typed at the very foot of a long form.

          The fix a sheet takes is not the page one. `automaticallyAdjustKeyboardInsets`
          scrolls a focused row inside a scroller that stays where it is; here the whole
          sheet has to move. This wrapper is the pattern app/(trainer)/invoices.tsx,
          costs.tsx and receipts.tsx already use and the one on the picker in
          app/(trainer)/log-session.tsx: `behavior="padding"` pads the KAV, which shrinks
          the flex:1 scrim above the sheet and lifts the sheet with it — and the sheet's
          percentage maxHeight resolves against the shrunken box, so it stays whole
          instead of running off the top. */}
      <Modal visible={!!manage} animationType="slide" transparent onRequestClose={() => setManage(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setManage(null)}
            accessibilityRole="button" accessibilityLabel="Close" />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.xl, maxHeight: '86%' }}>
            {manage ? (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={{ ...ty.micro, color: t.ink3 }}>{dayShort(manage.startsAt)} {timeLabel(manage.startsAt)}{manage.branch ? ' · ' + manage.branch : ''}</Text>
                <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>{manage.title}</Text>

                {manage.status === 'cancelled' ? (
                  <>
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
                      This class is called off. {manage.cancelReason?.trim() ? `Reason recorded: ${manage.cancelReason.trim()}` : 'No reason was recorded.'} Its bookings, check-ins and waiting list are all still here.
                    </Text>
                    <View style={{ height: sp.lg }} />
                    <Cta label="Put It Back On" wide disabled={mBusy} onPress={() => putBackOn(manage)} />
                  </>
                ) : (
                  <>
                    {/* ── correcting it ─────────────────────────────────────── */}
                    <Text style={[lbl, { marginTop: sp.lg }]}>Title</Text>
                    <TextInput value={mTitle} onChangeText={setMTitle} style={inp} />

                    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                      <Field label="Instructor">
                        <TextInput value={mInstructor} onChangeText={setMInstructor} style={inp} />
                      </Field>
                      <Field label="Room" hint="optional">
                        <TextInput value={mRoom} onChangeText={setMRoom} style={inp} />
                      </Field>
                    </View>

                    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                      {/* Named and united like the create form's, for the same
                          reason: this sheet carries a "Start hour" control too,
                          and a stepper called "Minutes" beside it reads as the
                          minutes past that hour. */}
                      {stepper('Duration', `${mDur}m`, () => setMDur((d) => (d > 15 ? d - 15 : d)), () => setMDur((d) => (d < 90 ? d + 15 : d)))}
                      {stepper('Capacity', String(mCap), () => setMCap((c) => (c > 1 ? c - 1 : c)), () => setMCap((c) => c + 1))}
                    </View>
                    {/* The one figure a coach can set below what is already sold.
                        Said here as well as refused on save, because a stepper
                        that silently will not commit reads as a broken control. */}
                    {countsKnown ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                        {manage.booked} booked. Capacity cannot go below that.
                      </Text>
                    ) : null}

                    {/* ── when it starts ─────────────────────────────────────
                        The field this sheet did not have. A class typed in at
                        6am instead of 6pm could only be called off and retyped,
                        and calling it off strands every booking on the row that
                        goes. Offered for THIS class only: `updateSeriesFrom`
                        refuses a start time by design, because setting a whole
                        series to one instant stacks twelve classes on one
                        evening. */}
                    {mSeries && manage.seriesId ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                        The start time is not offered for a whole series. Every occurrence would be set to the same instant, which stacks the term on one evening. Move one class at a time, with This Class selected.
                      </Text>
                    ) : (
                      <>
                        <Text style={[lbl, { marginTop: sp.lg }]}>Day</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
                          {MOVE_DAYS.map((o) => {
                            const at = daysLater(manage.startsAt, o);
                            if (!at) return null;
                            return chip(o === 0 ? `${dayShort(at)} · As Typed` : dayShort(at), mDayOff === o, () => setMDayOff(o));
                          })}
                        </ScrollView>

                        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                          {/* `fmtClock`, like the create form two hundred lines
                              above. This file removed the hand-built am/pm from
                              itself and left it standing on the one control that
                              relocates a class people have already paid for and
                              put in their diaries — so a 24-hour-clock coach set
                              the new time in a notation they do not use, on the
                              action with the most people downstream of it. */}
                          {stepper('Start Hour', fmtClock(mHour, 0),
                            () => setMHour((h) => (h + 23) % 24), () => setMHour((h) => (h + 1) % 24))}
                        </View>

                        <Text style={[lbl, { marginTop: sp.md }]}>Start Time</Text>
                        <View style={{ flexDirection: 'row', gap: 7 }}>
                          {SERIES_MINUTES.map((m) => (
                            <View key={m} style={{ flex: 1 }}>
                              <Pressable onPress={() => setMMinute(m)} accessibilityRole="button"
                                accessibilityState={{ selected: m === mMinute }}
                                accessibilityLabel={fmtClock(mHour, m)}
                                style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: m === mMinute ? t.brand : t.surface2 }}>
                                <Text style={{ ...ty.label, ...font(m === mMinute ? '500' : '400'), color: m === mMinute ? t.brandInk : t.ink2 }}>
                                  :{String(m).padStart(2, '0')}
                                </Text>
                              </Pressable>
                            </View>
                          ))}
                        </View>
                        {/* Three different things to say, and only one of them at
                            a time. A move into the past is the one that matters:
                            a class behind the coach is on nobody's timetable and
                            cannot be booked, and its bookings go with it. */}
                        {startChanged(manage) ? (
                          Date.parse(movedStart(manage) as string) <= Date.now() ? (
                            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>
                              That puts the class in the past, where nobody can book it and everybody who already has is left holding a place at a time that has been and gone. Pick a time that is still ahead.
                            </Text>
                          ) : (
                            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>
                              Moves from {dayShort(manage.startsAt)} {timeLabel(manage.startsAt)} to {dayShort(movedStart(manage) as string)} {timeLabel(movedStart(manage) as string)}. Bookings, check-ins and the waiting list all move with it, and nobody is notified. Tell them yourself.
                            </Text>
                          )
                        ) : (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                            Starts {dayShort(manage.startsAt)} at {timeLabel(manage.startsAt)}. Change any of these to move it; saving without touching them leaves the time exactly as it is.
                          </Text>
                        )}
                      </>
                    )}

                    {/* Only for a row that belongs to something. A one-off has no
                        series, and a series of one makes these two verbs the same
                        button. */}
                    {manage.seriesId ? (
                      <View style={{ marginTop: sp.md }}>
                        <Text style={lbl}>Apply To</Text>
                        <View style={{ flexDirection: 'row', gap: 7 }}>
                          {chip('This Class', !mSeries, () => setMSeries(false))}
                          {chip('This and Later', mSeries, () => setMSeries(true))}
                        </View>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                          Classes that have already run are never changed. They are the gym's record of what happened.
                        </Text>
                      </View>
                    ) : null}

                    <View style={{ height: sp.lg }} />
                    <Cta label={mBusy ? 'Saving…' : 'Save Changes'} wide disabled={mBusy} onPress={() => saveEdits(manage)} />

                    <Rule />

                    {/* ── calling it off ────────────────────────────────────── */}
                    <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>Call It Off</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.sm }}>
                      The class stays on the timetable marked as cancelled, and keeps its bookings, its check-ins and its waiting list. That is the evidence the hour was wanted.
                    </Text>
                    <TextInput value={mReason} onChangeText={setMReason} placeholder="Why is it off? e.g. instructor off sick" placeholderTextColor={t.ink3} style={inp}
                      accessibilityLabel="Why the class is off" />
                    <View style={{ height: sp.md }} />
                    <Ghost label={mSeries && manage.seriesId ? 'Call Off This and Later' : 'Call Off This Class'} onPress={() => callOff(manage)} />

                    {/* ── or erase it, if nobody ever booked it ─────────────── */}
                    {canRemove(manage) ? (
                      <View style={{ marginTop: sp.lg }}>
                        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                          Nobody has booked this class, so it can be removed outright. Use Call Off for anything that was on the timetable and did not happen.
                        </Text>
                        <Ghost label="Remove This Class" onPress={() => removeClass(manage)} />
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                        {countsKnown
                          ? 'This class has bookings, so it cannot be removed. Calling it off keeps them and keeps the record.'
                          : 'How many have booked could not be read, so removing is not offered. An unknown count is not an empty class.'}
                      </Text>
                    )}
                  </>
                )}

                <View style={{ height: sp.lg }} />
                <Ghost label="Done" onPress={() => setManage(null)} />
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
