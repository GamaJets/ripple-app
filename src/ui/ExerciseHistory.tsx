// "Where is she on bench press" — the panel, rendered the same on both sides.
//
// ── Why this is a component and not two blocks of JSX ──────────────────────
//
// The coach asked for a workout history he could search by exercise, and the
// owner then asked for the same thing on the member's own screen. Those are one
// question asked from two chairs, and the arithmetic behind it is identical:
// src/lib/exerciseHistory.ts holds it, and this file is the only drawing of it.
//
// Two renderings would drift, and this codebase knows exactly how that ends.
// Three write paths each converted pounds their own way and one of them didn't,
// so a member's 225 lb went into the database as 225 kg. The Tips engine
// existed on the client and not for the coach, so the two apps disagreed about
// what somebody had been told. A coach and a client looking at the SAME lift
// and reading two different numbers for it is the worst version of that: they
// are usually standing next to each other when it happens.
//
// ── Kilograms in, the reader's unit out, and only here ─────────────────────
//
// Every figure arriving from the module is in kilograms, because that is what
// `workouts` stores. This file is the render boundary and the only place a
// conversion happens: `liftLabel` for a load, `liftDeltaIn` for a movement in
// load, `est1RMIn` for an estimated max, `volumeIn` for a tonnage. Each of
// those converts the FIGURE ONCE — a span as a span — which is what stops a
// genuine 2.5 kg progression reading "+5 lb" one week and "+6 lb" the next off
// nothing the lifter did.
//
// The caller decides WHOSE unit, because the answer differs by screen and both
// answers are stated where they are chosen: the member's own history is their
// record and uses theirs; the coach's screen uses `unitFor` in
// src/lib/clientTraining.ts, which prefers the client's own so a coach cannot
// quote 100 at somebody whose phone says 220.
//
// ── And it does not tell anybody how they are doing ────────────────────────
//
// The owner's words were "how they are increasing". A screen that assumes the
// increase is what greeted a member on a fat-loss block whose bench has held
// steady with a disappointment they had not earned. So every movement here goes
// through `deltaLabel`, which gives a movement of nothing no sign at all, and
// nothing on this panel is coloured, arrowed or worded by direction. The figure
// is stated; what it means is the conversation the two of them have next.

import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Rule, Section, SectionHead, KpiRow, Flag } from './kit';
import { sp, radius, hairline, type as ty, numeric } from '../theme/scale';
import { type LoadStatus } from './loadStatus';
import { Fetched } from './fetched';
import { useReadStamp } from './readStamp';
import type { WorkoutEntry } from '../lib/mockData';
import { setsSummary } from '../lib/ownTraining';
import { dayLabel } from '../lib/adherence';
import { num } from '../lib/format';
import { liftLabel, liftDeltaIn, est1RMIn, volumeIn, type WeightUnit } from '../lib/units';
import { deltaLabel } from '../lib/deltaLabel';
import {
  exerciseIndex, matchExercises, exerciseOutings, exerciseTrend, readCoversRecord,
  type ExerciseOuting, type ExerciseRead, type ExerciseSummary,
} from '../lib/exerciseHistory';
import { holdLabel } from '../lib/timedSets';
import type { BodyweightHistory } from '../lib/bodyweightSets';

/**
 * How the panel refers to whoever's training this is.
 *
 * Carried as parts rather than as whole sentences with a name substituted in,
 * because "You have" and "Sam has" differ in the verb as well as the subject,
 * and a sentence assembled from a name plus a fixed verb reads as a mail merge.
 */
export interface HistoryVoice {
  /** Opens a sentence: 'You', or the client's first name. */
  they: string;
  /** Mid-sentence possessive: 'your', or "Sam's". */
  their: string;
  /** The verb after `they`: 'have', or 'has'. */
  have: string;
}

/** Movements listed before the search box has to do the narrowing. A display
 *  limit, not a read limit — everything read is still searchable, and the line
 *  under the list says how many there are rather than implying this is all. */
const LIST_CAP = 20;

/** Outings drawn for one movement. Same kind of limit, said the same way: a
 *  lifter four years into a programme has done bench press three hundred times
 *  and nobody scrolls that, but nothing may imply they have not. */
const TRAIL_CAP = 30;

/* ── saying how much of somebody's training a figure is about ──────────────
 *
 * Every count on this panel is a count over WHAT WAS READ, and the read is not
 * always the record. app/(trainer)/client-training.tsx narrows its query to a
 * window on purpose — that is what the 12 Weeks control does — and the answer
 * comes back complete, so `LoadStatus` is 'ready' and there is nothing to flag
 * about truncation. `ExerciseRead` in src/lib/exerciseHistory.ts is what tells
 * the two apart, and these two helpers are how the difference is said out loud.
 *
 * The rule is that a count is never dropped for being windowed. "20 movements"
 * over twelve weeks is a true and useful number; what it may not do is wear the
 * words "on record". So it keeps the figure and gains the qualifier.
 */

/** A count of days, pluralised. */
const dayCount = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/**
 * The phrase that has to follow a count when the count is not about the whole
 * record. Empty when it is, so a full read reads exactly as it always did.
 *
 * `windowDays` null with `covers` false is a read that came back CUT, which is
 * the page rather than a span of time — the caller's own truncation flag says
 * the rest.
 */
function readQualifier(covers: boolean, windowDays: number | null): string {
  if (covers) return '';
  return windowDays != null ? ` in the last ${windowDays} days` : ' on this page';
}

/** One movement's row in the list of what somebody has been doing. */
function MovementRow({ e, unit, windowDays, picked, onPress }: {
  e: ExerciseSummary; unit: WeightUnit; windowDays: number | null; picked: boolean; onPress: () => void;
}) {
  const t = useTheme();
  const best = est1RMIn(e.best1RMKg, unit);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={e.name}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: sp.md,
        paddingVertical: sp.md, paddingHorizontal: sp.md,
        borderRadius: radius.sm,
        backgroundColor: picked ? t.surface2 : 'transparent',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{e.name}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {/* `recordDays` is `days` offered as a fact about the person, and it
              is null under a windowed or a cut read. The figure is shown
              either way — it is real — but only the record-shaped one is
              allowed to stand on its own. */}
          {dayCount(e.days)}{readQualifier(e.recordDays != null, windowDays)}
          {e.lastDay ? ` · last ${dayLabel(e.lastDay)}` : ' · no readable date'}
        </Text>
      </View>
      {/* An estimate, so it says it is one. A movement nobody has loaded gets
          no figure at all rather than a nought — a chin-up is not a 0 kg lift,
          and neither is an hour on a bike. */}
      {best != null ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{num(best)} {unit}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>best est. 1RM</Text>
        </View>
      ) : (
        <Text style={{ ...ty.caption, color: t.ink3 }}>
          {e.daysWithSets === 0 ? 'no sets recorded' : 'no load logged'}
        </Text>
      )}
    </Pressable>
  );
}

/** One day of one movement: what was done to it, and the two derived figures
 *  that are worth having beside the sets. */
function OutingRow({ o, unit, first }: { o: ExerciseOuting; unit: WeightUnit; first: boolean }) {
  const t = useTheme();
  const sets = setsSummary(o.sets.map(([r, w]) => [r, w ?? 0] as [number, number]), unit);
  // Holds are written out here rather than pushed through `setsSummary`, which
  // reads a pair as reps × load and would print "45 × 10 kg" over a plank.
  const holds = o.holds.length
    ? o.holds.map(([secs, w]) => (w != null && w > 0 ? `${holdLabel(secs)} × ${liftLabel(w, unit)}` : holdLabel(secs))).join(', ')
    : null;
  const top = o.topLoadKg != null ? liftLabel(o.topLoadKg, unit) : null;
  const best = est1RMIn(o.best1RMKg, unit);
  const vol = volumeIn(o.volumeKg, unit);
  return (
    <View style={{ paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
          {o.day ? dayLabel(o.day) : 'No readable date'}
        </Text>
        {/* Reps and seconds are named separately, and a figure of nought is not
            printed at all. A day of three planks is "3 sets · 2:15 held", not
            "3 sets · 0 reps", which reads as a session that failed. */}
        <Text style={{ ...ty.caption, color: t.ink3 }}>
          {o.setCount} set{o.setCount === 1 ? '' : 's'}
          {o.reps > 0 ? ` · ${o.reps} reps` : ''}
          {o.holdSeconds > 0 ? ` · ${holdLabel(o.holdSeconds)} held` : ''}
        </Text>
      </View>
      {sets ? (
        <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: 4 }}>{sets}</Text>
      ) : null}
      {holds ? (
        <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: 4 }}>{holds}</Text>
      ) : null}
      {/* Bodyweight work with nothing to price it by reaches here with no top
          load, no estimate and no tonnage, and gets a sentence rather than
          three dashes — the sets above are the whole record of a set of
          chin-ups and there is nothing missing from it. */}
      {top != null ? (
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 4 }}>
          Top set {top} × {o.topReps}
          {best != null ? ` · est. 1RM ${num(best)} ${unit}` : ''}
          {vol != null ? ` · volume ${num(vol)} ${unit}` : ''}
        </Text>
      ) : o.sets.length ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
          No load could be put on any set of this day, so there is no tonnage and no estimated max —
          bodyweight work with no weight on record reads exactly like this.
        </Text>
      ) : null}
      {/* Folded, not deduplicated. The live record holds one squat session
          written as four rows a second apart, and folding them into one day is
          what stops the trail reading as four sessions — but the sets above
          are then all twelve of them, which overstates the afternoon. Saying
          so is the same call app/(trainer)/client-training.tsx makes on the
          day block: report the shape of the record rather than pick a winner. */}
      {o.entryCount > 1 ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          Saved in {o.entryCount} separate entries that day, and the sets above are all of them —
          if the same work was saved twice, this day reads high.
        </Text>
      ) : null}
      {/* What the tonnage does not cover, said beside it. A bodyweight set is
          priced at what the person weighed on or before that day, so this is
          now about the sets nobody has a weight for rather than about
          bodyweight work in general. */}
      {o.unpricedSets > 0 && top != null ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {o.unpricedSets} of those set{o.unpricedSets === 1 ? '' : 's'} has no load we can put on
          {o.unpricedSets === 1 ? ' it' : ' them'}, so the volume does not cover
          {o.unpricedSets === 1 ? ' it' : ' them'}.
        </Text>
      ) : null}
      {o.timedSets > 0 ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {o.timedSets === 1 ? 'One set was held' : `${o.timedSets} sets were held`} rather than repeated, so
          {o.timedSets === 1 ? ' it is' : ' they are'} counted in the time above and not in the reps or the tonnage.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A single movement, stated and not judged. `from` is the day it is measured
 * from; without one there is no sentence to write, so nothing is drawn.
 *
 * `decimals` is the grain the figure was converted at and therefore the
 * precision at which "nothing moved" is judged — one for a load, because
 * `liftDeltaIn` reads a 2.5 kg step out at the half-pound the plates justify
 * and rounding that to a whole would report "+3 kg" for a plate pair; none for
 * an estimated max, a tonnage or a rep count, which are whole by construction.
 */
function MovementLine({ label, value, unit, from, decimals }: {
  label: string; value: number | null; unit: string | null; from: string | null; decimals: number;
}) {
  const t = useTheme();
  if (from == null) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: 3 }}>
      <Text style={{ ...ty.caption, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>
        {deltaLabel(value, { since: from, unit, decimals })}
      </Text>
    </View>
  );
}

/**
 * One movement, followed — the trail on its own, with no search box over it.
 *
 * Pulled out of the panel below rather than written twice. The panel is a
 * search AND a trail; the exercise screen (app/(client)/exercise.tsx) already
 * knows which movement it is about and needs only the second half, and the
 * question "what did I do on this last time" is the one thing that screen
 * could not answer while standing in front of the machine. Two drawings of a
 * lift's history is exactly the divergence this file's header was written
 * against, so there is one.
 */
export function ExerciseTrail({ summary, log, status, windowDays, unit, voice, history = [] }: {
  /** The movement, as the index of somebody's record holds it. Null when they
   *  have never logged it — the caller says what that means on its screen,
   *  because "you have not done this yet" and "your client has not" are
   *  different sentences and only the caller knows which. */
  summary: ExerciseSummary | null;
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  /**
   * How many days back the read behind `log` ASKED for, or null when it asked
   * for the whole record.
   *
   * Required rather than optional, and carried separately from `status`,
   * because they are two different facts and this panel had been deriving both
   * from one. `status` says whether anything fell off the end; this says
   * whether the question covered the person's record at all. A coach tapping
   * 12 Weeks on app/(trainer)/client-training.tsx gets a read that is complete
   * AND is not the record, and every sentence below that says "on record",
   * "the first day" or names a lifetime best is worded off the second fact.
   */
  windowDays: number | null;
  unit: WeightUnit;
  voice: HistoryVoice;
  /** The member's own weight over time, so a bodyweight set carries the load it
   *  actually moved. Absent is not an error — see `exerciseOutings`. */
  history?: BodyweightHistory;
}) {
  const t = useTheme();
  const trend = useMemo(
    () => exerciseTrend(
      log && summary ? exerciseOutings(log, summary.name, history) : null,
      { status, windowDays },
    ),
    [log, summary, status, windowDays, history],
  );
  // The day a movement is measured FROM, already formatted. Null where that
  // outing's timestamp could not be read: "+5 kg since —" is a hole in a
  // sentence rather than a fact, so the line is not drawn at all.
  const lastFrom = trend.sinceLast.from?.day ? dayLabel(trend.sinceLast.from.day) : null;
  const firstFrom = trend.sinceFirst.from?.day ? dayLabel(trend.sinceFirst.from.day) : null;

  if (!summary) return null;

  /* Cardio arrives here: `workouts` rows with a distance and a duration and no
     `sets`. There are no reps and no loads to trail, and saying so is the whole
     job — the alternative is either an empty trail that reads as a movement
     never done, or the movement missing from the search entirely, which would
     have told a coach that a client who cycles four times a week has never
     cycled. */
  if (summary.daysWithSets === 0) {
    return (
      <View>
        <SectionHead
          title={summary.name}
          note={`${dayCount(summary.days)}${readQualifier(summary.recordDays != null, windowDays)}`}
        />
        <Text style={{ ...ty.body, color: t.ink2 }}>
          Logged on {dayCount(summary.days)}{readQualifier(summary.recordDays != null, windowDays)}
          {summary.lastDay ? `, most recently ${dayLabel(summary.lastDay)}` : ''}, with no sets
          recorded against any of them — so there are no reps or loads to follow here. Cardio is
          logged as time and distance rather than as sets, and it reads exactly like this.
        </Text>
      </View>
    );
  }

  if (trend.state !== 'some' || !trend.latest) return null;

  return (
    <View>
      <SectionHead
        title={summary.name}
        // `recordOutingCount` is the count offered as a fact about the person
        // and is null under a window; `outingCount` is the same number as a
        // fact about the read, and is null only when the read was cut. So a
        // windowed read still shows how many days it holds — it just says
        // which days they are.
        note={trend.recordOutingCount != null
          ? dayCount(trend.recordOutingCount)
          : trend.outingCount != null
            ? `${dayCount(trend.outingCount)}${readQualifier(false, windowDays)}`
            : undefined}
      />

      <KpiRow items={[
        {
          label: 'Last Done',
          value: trend.latest.day ? dayLabel(trend.latest.day) : '—',
          delta: trend.latest.topLoadKg != null
            ? `top ${liftLabel(trend.latest.topLoadKg, unit)} × ${trend.latest.topReps}`
            : trend.latest.holdSeconds > 0 ? `${holdLabel(trend.latest.holdSeconds)} held`
            : 'bodyweight',
        },
        {
          label: 'Best Est. 1RM',
          value: num(est1RMIn(trend.best?.best1RMKg, unit)),
          unit: trend.best?.best1RMKg != null ? unit : undefined,
          // "set" is a claim that this is the best there has ever been, and
          // only a read that covers the record supports it. Under the coach's
          // twelve-week window it is the best of the window, and the word for
          // that is the one a truncated read already used.
          delta: trend.best?.day
            ? `${trend.coversRecord ? 'set' : 'best read'} ${dayLabel(trend.best.day)}`
            : undefined,
        },
        {
          label: 'Last Volume',
          value: num(volumeIn(trend.latest.volumeKg, unit)),
          unit: trend.latest.volumeKg != null ? unit : undefined,
          delta: `${trend.latest.setCount} set${trend.latest.setCount === 1 ? '' : 's'}`,
        },
      ]} />

      {/* ── where it has gone ──────────────────────────────────────── */}
      {/* Every line is `deltaLabel`'s. A movement of nothing carries no
          sign, an unmeasurable one says there is nothing to measure
          against, and none of them is coloured or arrowed: whether more
          load is the right direction depends on the block being run, and
          this screen does not know what that is. */}
      <View style={{ marginTop: sp.lg }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>Since the Day Before</Text>
        <View style={{ marginTop: sp.xs }}>
          <MovementLine label="Top load" unit={unit} decimals={1} from={lastFrom}
            value={liftDeltaIn(trend.sinceLast.topLoadKg, unit)} />
          <MovementLine label="Estimated 1RM" unit={unit} decimals={0} from={lastFrom}
            value={est1RMIn(trend.sinceLast.est1RMKg, unit)} />
          <MovementLine label="Volume" unit={unit} decimals={0} from={lastFrom}
            value={volumeIn(trend.sinceLast.volumeKg, unit)} />
          <MovementLine label="Reps" unit={null} decimals={0} from={lastFrom}
            value={trend.sinceLast.reps} />
        </View>
        {trend.sinceLast.from == null ? (
          <Text style={{ ...ty.caption, color: t.ink2 }}>
            This is the only day {voice.their} record holds for this movement, so there is nothing
            to measure it against yet.
          </Text>
        ) : null}
      </View>

      {trend.sinceFirst.from ? (
        <View style={{ marginTop: sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>
            {trend.coversRecord ? 'Since the First Day on Record' : 'Since the First Day on This Page'}
          </Text>
          <View style={{ marginTop: sp.xs }}>
            <MovementLine label="Top load" unit={unit} decimals={1} from={firstFrom}
              value={liftDeltaIn(trend.sinceFirst.topLoadKg, unit)} />
            <MovementLine label="Estimated 1RM" unit={unit} decimals={0} from={firstFrom}
              value={est1RMIn(trend.sinceFirst.est1RMKg, unit)} />
          </View>
        </View>
      ) : null}

      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
        A movement is stated here and not judged. Whether more load, more reps or the same
        weight held is the right direction depends on the block being run, which this screen
        does not know — so nothing above is marked as good or bad, and a lift that has not
        moved is said to have not moved rather than given a sign.
      </Text>

      {/* Two different things can be missing, and they need two different
          sentences. This one is truncation: the read hit the row cap and the
          rest fell off the end of it. */}
      {!trend.whole ? (
        <View style={{ marginTop: sp.md }}>
          <Flag tone={t.warn}>
            There is more training on record than fits in one read, so every day below is real
            and current but the earliest of them is not necessarily the first time this was
            done. Nothing here is counted as a lifetime.
          </Flag>
        </View>
      ) : null}

      {/* And this one is the window: nothing fell off the end, because the
          question was only ever asked about part of the record. The coach's
          range control does this deliberately, which is exactly why the screen
          had nothing to warn about and said "on record" anyway. */}
      {trend.whole && !trend.coversRecord ? (
        <View style={{ marginTop: sp.md }}>
          <Flag tone={t.warn}>
            {windowDays != null
              ? `This read asked for the last ${windowDays} days only, and it came back complete — so every day below is the whole of that window. Training before it is still on record and is in nothing above: the best and the earliest here are the best and the earliest of these ${windowDays} days, not of a lifetime.`
              : 'This read did not ask for the whole record, so the best and the earliest above are the best and the earliest of what was asked for rather than of a lifetime.'}
          </Flag>
        </View>
      ) : null}

      {/* ── every day of it ────────────────────────────────────────── */}
      <View style={{ marginTop: sp.lg }}>
        {trend.outings.slice(0, TRAIL_CAP).map((o, i) => (
          <OutingRow key={`${o.day ?? 'undated'}-${o.at}`} o={o} unit={unit} first={i === 0} />
        ))}
      </View>
      {trend.outings.length > TRAIL_CAP ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          The {TRAIL_CAP} most recent days are listed. {voice.they} {voice.have} done this on{' '}
          {trend.outings.length} of the days read.
        </Text>
      ) : null}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
        Grouped by the day it was done on. Sets logged twice on one day are one day here, so a
        movement saved in two goes — or saved twice by a double tap — is not read as two
        sessions. Loads are shown in {unit}.
      </Text>
    </View>
  );
}

export function ExerciseHistoryPanel({ log, status, windowDays, unit, voice, history = [], onRefresh }: {
  /** Everything read, in any order. Null means the read did not land, and is
   *  the ONLY thing that produces "could not be read" — an empty array that
   *  arrived from a successful read means they have not done this, which is a
   *  completely different sentence about a named person. */
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  /** How far back the read behind `log` asked, or null for the whole record.
   *  Required, and it fails closed: see `ExerciseTrail`'s own note and
   *  `ExerciseRead` in src/lib/exerciseHistory.ts. */
  windowDays: number | null;
  unit: WeightUnit;
  voice: HistoryVoice;
  /** The member's own weight over time. Optional, and absent means a
   *  bodyweight set has no load rather than an invented one. */
  history?: BodyweightHistory;
  /**
   * Read this again. Optional, and the line below still says WHEN without it —
   * but a stamp with no way to act on it is half an answer, so a screen that
   * has a `reload` should pass it.
   *
   * See src/lib/readStamp.ts for why this panel is the first thing outside
   * `app/(owner)/**` to carry a read stamp at all: all eighteen `<Fetched>`
   * call sites were owner screens, and the argument for the line — a figure
   * with nothing on the page saying when it was fetched is read as current —
   * was never an argument about owners.
   */
  onRefresh?: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  // Before the early returns below, because hooks are not conditional. `log` is
  // the token: this panel is handed a new array whenever the read behind it
  // lands, including a re-read that never announced itself as 'loading'.
  const read = useReadStamp(status, log);

  // The read is handed to the index, not just its status: `recordDays` on each
  // summary is the only thing that licenses printing a day count bare, and it
  // is withheld unless the read covered the whole record.
  const readShape = useMemo<ExerciseRead>(() => ({ status, windowDays }), [status, windowDays]);
  const index = useMemo(() => (log ? exerciseIndex(log, history, readShape) : []), [log, history, readShape]);
  const matches = useMemo(() => matchExercises(index, q), [index, q]);
  const chosen = useMemo(() => index.find((e) => e.slug === picked) ?? null, [index, picked]);

  const whole = status === 'ready';
  const covers = readCoversRecord(readShape);
  const shown = matches.slice(0, LIST_CAP);

  if (status === 'loading') {
    return (
      <Section>
        <SectionHead title="Exercise History" />
        <Text style={{ ...ty.body, color: t.ink3 }}>Reading the movements&hellip;</Text>
      </Section>
    );
  }

  // A failed read says nothing about what anybody has lifted. The screens that
  // mount this panel already carry their own failure notice, so this stays
  // short — but it must never fall through to the empty state below, which is
  // a claim about a person rather than about a connection.
  if (log == null || status === 'error') {
    return (
      <Section>
        <SectionHead title="Exercise History" />
        <Flag tone={t.warn}>
          The training could not be read, so there is nothing to search. That is not the same as
          having none on record.
        </Flag>
      </Section>
    );
  }

  if (!index.length) {
    return (
      <Section>
        <SectionHead title="Exercise History" />
        <Text style={{ ...ty.body, color: t.ink2 }}>
          Nothing has been logged with sets against it yet, so there is no movement to search for.
          The first logged set puts one here.
        </Text>
      </Section>
    );
  }

  return (
    <Section>
      <SectionHead
        title="Exercise History"
        // A count over a truncated read would be a subtotal wearing a total's
        // label, and is not shown at all. See src/lib/rowCap.ts. A count over a
        // WINDOW is a different thing: it is complete, so it is shown, with the
        // window named beside it rather than passed off as the record.
        note={covers
          ? `${index.length} movement${index.length === 1 ? '' : 's'}`
          : whole
            ? `${index.length} movement${index.length === 1 ? '' : 's'}${readQualifier(false, windowDays)}`
            : undefined}
      />
      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
        Pick a movement to see every day it appears in — the sets, the reps and the load as they
        were recorded, newest first, with how the top set has moved.
      </Text>

      {/* ── finding one ──────────────────────────────────────────────────── */}
      {/* The query is slugged by the same `exerciseSlug` the record is, so
          "Bench Press", "bench press" and "bench-press" are one search and
          there is no second opinion in the app about what counts as the same
          lift. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
        <Icon name="search" size={16} color={t.ink3} />
        <TextInput
          value={q} onChangeText={setQ}
          placeholder="Search exercises…" placeholderTextColor={t.ink3}
          autoCapitalize="none" autoCorrect={false}
          accessibilityLabel="Search exercises"
          style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {matches.length === 0 ? (
        <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
          Nothing logged matches that. {voice.they} may have written it down under another name —
          the search matches the words in it, in any order.
        </Text>
      ) : (
        <View style={{ marginTop: sp.sm }}>
          {shown.map((e) => (
            <MovementRow key={e.slug} e={e} unit={unit} windowDays={windowDays} picked={e.slug === picked}
              onPress={() => setPicked(e.slug === picked ? null : e.slug)} />
          ))}
        </View>
      )}

      {matches.length > LIST_CAP ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          Showing {LIST_CAP} of the {matches.length} movements {covers ? 'on record' : 'read'} — type
          above to narrow it.
        </Text>
      ) : null}

      {/* ── the movement itself, drawn by the same component the exercise
          screen mounts on its own. See `ExerciseTrail`. */}
      {chosen ? (
        <View>
          <Rule />
          <ExerciseTrail summary={chosen} log={log} status={status} windowDays={windowDays}
            unit={unit} voice={voice} history={history} />
        </View>
      ) : null}

      {/* ── and when this was read ───────────────────────────────────────────
          Drawn only here, in the branch that actually shows the record. Under
          'error' this panel returns the "could not be read" flag above and puts
          no figures on screen, so a "read 20 minutes ago" there would be an age
          for something nobody is looking at.

          It is worth having on this panel in particular because the providers
          behind it now repair themselves on reconnect (src/lib/readRefresh.ts),
          silently — so "this landed a second ago" and "this landed before you
          came downstairs" look identical, and a lifter checking what they did
          last week is deciding what to load onto a bar from it. */}
      <Fetched at={read.at} onRefresh={onRefresh} busy={read.busy} />
    </Section>
  );
}
