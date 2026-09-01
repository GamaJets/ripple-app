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
import type { WorkoutEntry } from '../lib/mockData';
import { setsSummary } from '../lib/ownTraining';
import { dayLabel } from '../lib/adherence';
import { num } from '../lib/format';
import { liftLabel, liftDeltaIn, est1RMIn, volumeIn, type WeightUnit } from '../lib/units';
import { deltaLabel } from '../lib/deltaLabel';
import {
  exerciseIndex, matchExercises, exerciseOutings, exerciseTrend,
  type ExerciseOuting, type ExerciseSummary,
} from '../lib/exerciseHistory';

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

/** One movement's row in the list of what somebody has been doing. */
function MovementRow({ e, unit, picked, onPress }: {
  e: ExerciseSummary; unit: WeightUnit; picked: boolean; onPress: () => void;
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
          {e.days} day{e.days === 1 ? '' : 's'}
          {e.lastDay ? ` · last ${dayLabel(e.lastDay)}` : ' · no readable date'}
        </Text>
      </View>
      {/* An estimate, so it says it is one. A movement nobody has loaded gets
          no figure at all rather than a nought — a chin-up is not a 0 kg lift. */}
      {best != null ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{num(best)} {unit}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>best est. 1RM</Text>
        </View>
      ) : (
        <Text style={{ ...ty.caption, color: t.ink3 }}>no load logged</Text>
      )}
    </Pressable>
  );
}

/** One day of one movement: what was done to it, and the two derived figures
 *  that are worth having beside the sets. */
function OutingRow({ o, unit, first }: { o: ExerciseOuting; unit: WeightUnit; first: boolean }) {
  const t = useTheme();
  const sets = setsSummary(o.sets.map(([r, w]) => [r, w ?? 0] as [number, number]), unit);
  const top = o.topLoadKg != null ? liftLabel(o.topLoadKg, unit) : null;
  const best = est1RMIn(o.best1RMKg, unit);
  const vol = volumeIn(o.volumeKg, unit);
  return (
    <View style={{ paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
          {o.day ? dayLabel(o.day) : 'No readable date'}
        </Text>
        <Text style={{ ...ty.caption, color: t.ink3 }}>
          {o.setCount} set{o.setCount === 1 ? '' : 's'} · {o.reps} reps
        </Text>
      </View>
      {sets ? (
        <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: 4 }}>{sets}</Text>
      ) : null}
      {/* Bodyweight work reaches here with no top load, no estimate and no
          tonnage, and gets a sentence rather than three dashes — the sets above
          are the whole record of a set of chin-ups and there is nothing
          missing from it. */}
      {top != null ? (
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 4 }}>
          Top set {top} × {o.topReps}
          {best != null ? ` · est. 1RM ${num(best)} ${unit}` : ''}
          {vol != null ? ` · volume ${num(vol)} ${unit}` : ''}
        </Text>
      ) : (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
          No load was recorded against any set, so there is no tonnage and no estimated max —
          bodyweight work reads exactly like this.
        </Text>
      )}
      {o.bodyweightSets > 0 && top != null ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {o.bodyweightSets} of those set{o.bodyweightSets === 1 ? '' : 's'} carried no load, so the volume does not cover
          {o.bodyweightSets === 1 ? ' it' : ' them'}.
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

export function ExerciseHistoryPanel({ log, status, unit, voice }: {
  /** Everything read, in any order. Null means the read did not land, and is
   *  the ONLY thing that produces "could not be read" — an empty array that
   *  arrived from a successful read means they have not done this, which is a
   *  completely different sentence about a named person. */
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  unit: WeightUnit;
  voice: HistoryVoice;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const index = useMemo(() => (log ? exerciseIndex(log) : []), [log]);
  const matches = useMemo(() => matchExercises(index, q), [index, q]);
  const chosen = useMemo(() => index.find((e) => e.slug === picked) ?? null, [index, picked]);
  const trend = useMemo(
    () => exerciseTrend(log && chosen ? exerciseOutings(log, chosen.name) : null, status),
    [log, chosen, status],
  );

  const whole = status === 'ready';
  const shown = matches.slice(0, LIST_CAP);
  // The day a movement is measured FROM, already formatted. Null where that
  // outing's timestamp could not be read: "+5 kg since —" is a hole in a
  // sentence rather than a fact, so the line is not drawn at all.
  const lastFrom = trend.sinceLast.from?.day ? dayLabel(trend.sinceLast.from.day) : null;
  const firstFrom = trend.sinceFirst.from?.day ? dayLabel(trend.sinceFirst.from.day) : null;

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
        // label. See src/lib/rowCap.ts.
        note={whole ? `${index.length} movement${index.length === 1 ? '' : 's'}` : undefined}
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
            <MovementRow key={e.slug} e={e} unit={unit} picked={e.slug === picked}
              onPress={() => setPicked(e.slug === picked ? null : e.slug)} />
          ))}
        </View>
      )}

      {matches.length > LIST_CAP ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          Showing {LIST_CAP} of the {matches.length} movements {whole ? 'on record' : 'read'} — type
          above to narrow it.
        </Text>
      ) : null}

      {/* ── one movement, followed ───────────────────────────────────────── */}
      {chosen && trend.state === 'some' && trend.latest ? (
        <View>
          <Rule />
          <SectionHead
            title={chosen.name}
            note={trend.outingCount != null ? `${trend.outingCount} day${trend.outingCount === 1 ? '' : 's'}` : undefined}
          />

          <KpiRow items={[
            {
              label: 'Last Done',
              value: trend.latest.day ? dayLabel(trend.latest.day) : '—',
              delta: trend.latest.topLoadKg != null
                ? `top ${liftLabel(trend.latest.topLoadKg, unit)} × ${trend.latest.topReps}`
                : 'bodyweight',
            },
            {
              label: 'Best Est. 1RM',
              value: num(est1RMIn(trend.best?.best1RMKg, unit)),
              unit: trend.best?.best1RMKg != null ? unit : undefined,
              delta: trend.best?.day
                ? `${whole ? 'set' : 'best read'} ${dayLabel(trend.best.day)}`
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
                {whole ? 'Since the First Day on Record' : 'Since the First Day on This Page'}
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

          {!whole ? (
            <View style={{ marginTop: sp.md }}>
              <Flag tone={t.warn}>
                There is more training on record than fits in one read, so every day below is real
                and current but the earliest of them is not necessarily the first time this was
                done. Nothing here is counted as a lifetime.
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
      ) : null}
    </Section>
  );
}
