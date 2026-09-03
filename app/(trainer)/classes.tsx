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
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead, Field } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
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
import {
  classOffBuckets, classOffConfirmation, classOffNotification,
} from '../../src/lib/notifyCopy';
import { readByIds } from '../../src/lib/idLookup';
import { sendPushChecked } from '../../src/ui/pushNotifications';
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
  // One source, and the booking counts on these rows move without this coach
  // doing anything — a member books or drops a class from their own phone.
  const pull = usePullToRefresh(useCallback(() => { refresh(); }, [refresh]));

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
      Alert.alert('Not saved', e instanceof Error && e.message ? e.message : 'That did not reach the server, so nothing has changed on the timetable. Try again once you have signal.');
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
      Alert.alert('That time has already passed',
        `${patch.title} would start ${dayShort(patch.startsAt)} at ${timeLabel(patch.startsAt)}, which is behind you. Members cannot book a class in the past, and the ones who already booked this would be holding a place at a time that has gone. Pick a time that is still ahead.`);
      return;
    }
    if (countsKnown && patch.capacity < c.booked) {
      Alert.alert('Capacity is below the bookings',
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
          Alert.alert('Series updated', `${n} ${n === 1 ? 'class' : 'classes'} from this one onward ${n === 1 ? 'was' : 'were'} changed. Classes that have already run are untouched, because they are the gym's record of what happened.`);
        } catch (e) {
          Alert.alert('Not saved', e instanceof Error && e.message ? e.message : 'That did not reach the server, so nothing has changed on the timetable.');
        } finally { setMBusy(false); }
      })();
      return;
    }
    // The move is named in the confirmation, because it is the one edit here
    // that changes where members have to be and when. Everything else changes
    // what the row says about a class they are already coming to.
    const done = patch.startsAt
      ? `${patch.title} now starts ${dayShort(patch.startsAt)} at ${timeLabel(patch.startsAt)}. Everyone who booked it keeps their place — tell them, because moving a class does not notify anybody.`
      : `${patch.title} was changed.`;
    void runWrite('Class updated', done, () => updateClass(supabase, c.id, patch));
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
    if (!classIds.length) return { people: 0, pushed: 0, partial: false };
    let me: string | null = null;
    // A failed read of our own id costs the coach one notification about their
    // own cancellation. A failed read of the roster costs twelve people theirs,
    // which is why only the second one is reported.
    try { me = (await supabase.auth.getUser()).data?.user?.id ?? null; } catch { me = null; }
    // ── Why this is `readByIds` and not one capped `.in()` ─────────────────
    //
    // It was `.in('class_id', classIds).limit(capLimit())`, and both halves of
    // that were bounds nobody had checked against the thing being read.
    //
    // The id list is a whole SERIES. `cancelSeriesFrom` hands back every
    // remaining occurrence, and a weekly class booked out three years ahead is
    // 156 of them — past `ID_CHUNK`, where a single `.in()` truncates the
    // filter or 414s, both in silence. The row list is every booking across all
    // of them: forty people a week for a year is two thousand rows, and 1,001
    // of them came back. Neither failure said anything.
    //
    // What it cost: `people` is printed to the coach as "N people had booked",
    // and `pushed` decides whether the confirmation says "a push was queued to
    // all of them". A truncated read makes both numbers smaller AND sends
    // fewer notifications, so the coach is told a reassuring figure about a
    // room that is partly still expecting a class. `readByIds` chunks the ids
    // and pages each chunk to the end; `id` is the primary key and supplies the
    // total order `readAll` requires.
    let rows: { userId: string; classId: string }[];
    try {
      const read = await readByIds<{ id: string; user_id: unknown; class_id: unknown }>(
        classIds as string[],
        (chunk, from, to) => supabase
          .from('class_bookings')
          .select('id, user_id, class_id')
          .in('class_id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
        'who had booked these classes',
      );
      rows = read
        .map((r) => ({
          userId: String(r?.user_id ?? '').trim(),
          classId: String(r?.class_id ?? '').trim(),
        }))
        .filter((r) => r.userId && r.classId && r.userId !== me);
    } catch {
      // Including a set too big to read honestly. `people: null` is already the
      // "we could not read who had booked" sentence, and it is the right one:
      // the classes ARE off, and the coach has to tell the room themselves.
      return { people: null, pushed: 0, partial: false };
    }
    // Grouped by how many of THEIR OWN bookings went, so nine weeks of a series
    // is one notification per person rather than nine, and nobody is told a
    // figure about somebody else's diary. See src/lib/notifyCopy.ts.
    const buckets = classOffBuckets(rows);
    let people = 0;
    let pushed = 0;
    // send-push pages `push_tokens` and reports `partial` when a chunk of that
    // read failed or ran off its page ceiling. It was thrown away here, so a
    // send that reached an unknown fraction of a full room was reported to the
    // coach as "a push was queued to all of them" — the truncation-as-total
    // defect this screen's `readByIds` was added to fix, one layer further out.
    // ANY bucket reporting it makes the whole sentence's claim a floor: the
    // buckets are one cancellation seen from several diaries, not several
    // events, and the coach acts on the sentence as a whole.
    let partial = false;
    for (const b of buckets) {
      people += b.userIds.length;
      const n = classOffNotification(classTitle, b.classes, why);
      const res = await sendPushChecked(b.userIds, n.title, n.body, { route: n.route });
      if (res.ok) pushed += b.userIds.length;
      if (res.partial) partial = true;
    }
    return { people, pushed, partial };
  }, []);

  const callOff = (c: GymClass) => {
    const why = mReason.trim();
    if (!why) {
      Alert.alert('Say why it is off',
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
          series ? 'Series called off' : 'Class called off',
          classOffConfirmation(ids.length, told.people, told.pushed, told.partial),
        );
      } catch (e) {
        Alert.alert('Not saved', e instanceof Error && e.message ? e.message : 'That did not reach the server, so the classes are still on the timetable.');
      } finally { setMBusy(false); }
    })();
  };

  const putBackOn = (c: GymClass) => {
    void runWrite('Class back on', `${c.title} is on the timetable again and can be booked.`,
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
    Alert.alert('Remove this class?',
      `${c.title} is deleted outright. Use Call Off instead for a class that was on the timetable and did not happen — that keeps the row and the record.`, [
      { text: 'Keep It', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => { void runWrite('Class removed', `${c.title} is off the timetable.`, () => deleteClass(supabase, c.id)); },
      },
    ]);
  };

  /** Whether deleting is even offered. Unknown counts are not an empty class. */
  const canRemove = (c: GymClass) => countsKnown && c.booked === 0 && (c.waiting ?? 0) === 0;

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
    setBusy(true);
    try {
      const base = new Date(startIso());
      const nm = title.trim(); const br = branch.trim();
      const when = `${dayShort(startIso())} ${timeLabel(startIso())}`;
      let saved = 0;
      const firstIso = base.toISOString();
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
        Alert.alert(weeks > 1 ? 'Classes added' : 'Class added', weeks > 1
          ? `${weeks} weekly ${nm} classes at ${br}, starting ${when}.`
          : `${nm} · ${br} · ${when}`);
      } else if (saved === 0) {
        Alert.alert('Not on the timetable', weeks > 1
          ? `None of the ${weeks} ${nm} classes reached the server, so they are on this phone only and nobody can book them. They will be gone when you reopen the app — try again once you have signal.`
          : `${nm} did not reach the server, so it is on this phone only and nobody can book it. It will be gone when you reopen the app — try again once you have signal.`);
      } else {
        Alert.alert('Partly added', `${saved} of ${weeks} ${nm} classes reached the server. The other ${weeks - saved} are on this phone only and cannot be booked — add them again once you have signal.`);
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
      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  const stepper = (label: string, val: string, dec: () => void, inc: () => void) => (
    <View style={{ flex: 1 }}>
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

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your branches</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Classes</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Schedule group classes across your branches. Members book and waitlist automatically.
        </Text>

        <Rule inset={0} />

        {/* ── new class ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="New Class" />

          <TextInput value={title} onChangeText={setTitle} placeholder="Class title — e.g. Sunrise CrossFit" placeholderTextColor={t.ink3} style={inp} />

          <Text style={[lbl, { marginTop: sp.md }]}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {CLASS_KINDS.map((k) => chip(k, kind === k, () => setKind(k)))}
          </ScrollView>

          <Text style={[lbl, { marginTop: sp.md }]}>Branch</Text>
          <TextInput value={branch} onChangeText={setBranch} placeholder="Branch or location — e.g. your main studio" placeholderTextColor={t.ink3} style={inp} />
          {knownBranches.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2, marginTop: sp.sm }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
              {knownBranches.map((b) => chip(b, branch === b, () => setBranch(b)))}
            </ScrollView>
          ) : null}

          {/* Two names side by side, and which is which — and which of the two
              may be left empty — lived in placeholders that the first keystroke
              erased. */}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
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
            {[0, 1, 2, 3, 4, 5, 6, 7].map((w) => chip(w === 0 ? 'This week' : w === 1 ? 'Next week' : `In ${w} weeks`, weekOff === w, () => setWeekOff(w)))}
          </ScrollView>

          <Text style={[lbl, { marginTop: sp.md }]}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((o) => { const d = new Date(); d.setDate(d.getDate() + weekOff * 7 + o); return chip(fmtRelativeDay(d.toISOString()), dayOff === o, () => setDayOff(o)); })}
          </ScrollView>

          {/* All twenty-four, for the reason the calendar screen gives on
              `HOURS`: any hand-picked window is somebody's assumption about
              when training happens, and 5am to 10pm excluded the 4am opener
              and the late shift. */}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            {stepper('Start hour', fmtClock(hour, 0), () => setHour((h) => (h + 23) % 24), () => setHour((h) => (h + 1) % 24))}
            {stepper('Minutes', String(dur), () => setDur((d) => (d > 15 ? d - 15 : d)), () => setDur((d) => (d < 90 ? d + 15 : d)))}
            {stepper('Capacity', String(cap), () => setCap((c) => (c > 4 ? c - 1 : c)), () => setCap((c) => c + 1))}
          </View>

          <Text style={[lbl, { marginTop: sp.md }]}>Start time</Text>
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
                  <Text style={{ ...ty.label, fontWeight: m === minute ? '500' : '400', color: m === minute ? t.brandInk : t.ink2 }}>
                    :{String(m).padStart(2, '0')}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Starts {dayShort(startIso())} at {timeLabel(startIso())}.
          </Text>

          <Text style={[lbl, { marginTop: sp.md }]}>Repeat</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {([[1, 'Just once'], [4, 'Weekly ×4'], [8, 'Weekly ×8'], [12, 'Weekly ×12']] as [number, string][]).map(([n, label]) => chip(label, weeks === n, () => setWeeks(n)))}
          </ScrollView>

          <View style={{ height: sp.lg }} />
          <Cta label={busy ? 'Adding…' : 'Add Class'} wide disabled={!canAdd || busy} onPress={submit} />
        </Section>

        <Rule />

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
              <Text style={lbl}>Same Again runs for</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
                {([[4, '4 more weeks'], [8, '8 more weeks'], [12, '12 more weeks']] as [number, string][]).map(([n, label]) => chip(label, againWeeks === n, () => setAgainWeeks(n)))}
              </ScrollView>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Counted from the last class in that series rather than from today, so a term that is nearly over carries straight on. Dates already on the timetable, and any that fall in the past, are skipped rather than doubled.
              </Text>
            </View>
          ) : null}

          {/* An unread timetable is not an empty week. Without this the screen
              shows a coach with forty classes on the books a blank schedule and
              the words "No classes yet", and they plan their week around it. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Timetable" title="Your schedule could not be read"
              note="Nothing is listed below because the classes did not come back — it does not mean nothing is scheduled. Anything you add here may duplicate a class that is already on the timetable, so check again once you have signal.">
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
                flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {/* A 6pt mark and the word, never coloured text: t.warn does
                        not clear 4.5:1 on the light palettes and "Cancelled" is
                        the most important word in this row. */}
                    {off ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                    <Text style={{ ...ty.body, fontWeight: '500', color: off ? t.ink2 : t.ink }}>{c.title}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.branch} · {dayShort(c.startsAt)} {timeLabel(c.startsAt)} · {c.kind}</Text>
                  {off ? (
                    <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3 }}>
                      Cancelled. {c.cancelReason?.trim() ? c.cancelReason.trim() : 'No reason was recorded.'} It stays here with its bookings so the gym keeps the record.
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {full ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn }} /> : null}
                    <Text style={{ ...value(16), color: t.ink }}>{countsKnown ? c.booked : '—'}/{c.capacity}</Text>
                  </View>
                  {/* ── the six people nobody could see ────────────────────
                      `class_counts()` counted a waitlister as a booking until
                      part 210, so this class read "17/12" and the queue was
                      folded into a number that made no sense. Now they are
                      separate, and the queue is the more valuable of the two: a
                      full class is a full class, and a full class with six
                      waiting is a second session on Thursday.

                      Only drawn when there IS one. A "0 waiting" under every
                      class in the timetable is furniture, and the line that
                      matters would be lost in it. A NULL waiting draws nothing
                      either — that is the counts read having failed or a
                      database without part 210, and "nobody is waiting" is
                      exactly the claim that would stop the second session. The
                      dash on the booked figure beside it already says the
                      numbers are unknown. */}
                  {countsKnown && c.waiting != null && c.waiting > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {/* The tone is the dot, the count is ink. t.warn measures
                          3.87–4.08:1 on the three light palettes — under the
                          4.5:1 a word needs and over the 3:1 a mark needs, so
                          it draws the mark and never the number. The word
                          "waiting" is on the line regardless, so colour is not
                          carrying the meaning on its own. */}
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>
                        {c.waiting} waiting
                      </Text>
                    </View>
                  ) : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{!countsKnown ? 'capacity' : full ? 'full' : 'booked'}</Text>
                </View>
                <View style={{ gap: 6 }}>
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
            <Text style={{ ...ty.label, color: t.ink3 }}>No classes yet — add your first above.</Text>
          ) : upcoming.length === 0 && status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your timetable…</Text>
          ) : null}
        </Section>

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
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setManage(null)} />
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
                      {stepper('Minutes', String(mDur), () => setMDur((d) => (d > 15 ? d - 15 : d)), () => setMDur((d) => (d < 90 ? d + 15 : d)))}
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
                        The start time is not offered for a whole series. Every occurrence would be set to the same instant, which stacks the term on one evening — move one class at a time, with This Class selected.
                      </Text>
                    ) : (
                      <>
                        <Text style={[lbl, { marginTop: sp.lg }]}>Day</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
                          {MOVE_DAYS.map((o) => {
                            const at = daysLater(manage.startsAt, o);
                            if (!at) return null;
                            return chip(o === 0 ? `${dayShort(at)} · as typed` : dayShort(at), mDayOff === o, () => setMDayOff(o));
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
                          {stepper('Start hour', fmtClock(mHour, 0),
                            () => setMHour((h) => (h + 23) % 24), () => setMHour((h) => (h + 1) % 24))}
                        </View>

                        <Text style={[lbl, { marginTop: sp.md }]}>Start time</Text>
                        <View style={{ flexDirection: 'row', gap: 7 }}>
                          {SERIES_MINUTES.map((m) => (
                            <View key={m} style={{ flex: 1 }}>
                              <Pressable onPress={() => setMMinute(m)} accessibilityRole="button"
                                accessibilityState={{ selected: m === mMinute }}
                                accessibilityLabel={fmtClock(mHour, m)}
                                style={{ paddingVertical: sp.sm, borderRadius: radius.pill, alignItems: 'center', backgroundColor: m === mMinute ? t.brand : t.surface2 }}>
                                <Text style={{ ...ty.label, fontWeight: m === mMinute ? '500' : '400', color: m === mMinute ? t.brandInk : t.ink2 }}>
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
                              Moves from {dayShort(manage.startsAt)} {timeLabel(manage.startsAt)} to {dayShort(movedStart(manage) as string)} {timeLabel(movedStart(manage) as string)}. Bookings, check-ins and the waiting list all move with it, and nobody is notified — tell them yourself.
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
                        <Text style={lbl}>Apply to</Text>
                        <View style={{ flexDirection: 'row', gap: 7 }}>
                          {chip('This Class', !mSeries, () => setMSeries(false))}
                          {chip('This And Later', mSeries, () => setMSeries(true))}
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
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Call it off</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.sm }}>
                      The class stays on the timetable marked as cancelled, and keeps its bookings, its check-ins and its waiting list. That is the evidence the hour was wanted.
                    </Text>
                    <TextInput value={mReason} onChangeText={setMReason} placeholder="Why is it off? e.g. instructor off sick" placeholderTextColor={t.ink3} style={inp} />
                    <View style={{ height: sp.md }} />
                    <Ghost label={mSeries && manage.seriesId ? 'Call Off This And Later' : 'Call Off This Class'} onPress={() => callOff(manage)} />

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
