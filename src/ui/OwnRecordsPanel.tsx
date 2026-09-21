// Somebody's own personal records — the three boards — as a panel.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(client)/records.tsx has had all of this since the client app was
// written. The coach app had no route to any of it: `personalRecords` had no
// importer anywhere under app/(trainer) before this, so a coach who lifts could
// see every client's best set and not their own.
//
// ── Built on the client hooks, because that is the rule ────────────────────
//
// Trainers self-track and there is no client→trainer promotion in this product.
// So the log this reads is whatever the mounting screen passes from
// `useWorkoutLog()` — the provider that reads `user_id = auth.uid()`, which in
// the coach app is the coach — and the boards are computed by the same three
// tested modules the client screen calls: `personalRecords` (src/lib/streaks.ts),
// `repRecords` (src/lib/bodyweightSets.ts) and `holdRecords`
// (src/lib/timedSets.ts). Nothing here re-derives a record, so this panel and
// the client screen cannot disagree about the same set.
//
// ── Why there are three boards and not one ─────────────────────────────────
//
// A barbell record is an estimated one-rep max; a pull-up record is how many
// reps; a plank record is how long. Ranking the three together means ranking a
// 45-second hold above every pull-up anybody has done, because 45 is a bigger
// number than 12. Each module refuses the sets that do not belong to it, and
// the screen shows whichever boards have anything on them.
//
// ── Why the bodyweight history is a prop, and what it costs when absent ────
//
// A pull-up has no load until you know what the body weighed ON THE DAY, and
// `personalRecords` prices one from the history it is handed (never from
// today's figure carried backwards, which would redraw last spring's records
// around a body that did not exist then). In the client app that history is the
// scan series on `useClientData`; a coach has no `clients` row, so the mounting
// screen passes their own weigh-ins off `useCheckIns` instead — the same series
// app/(trainer)/my-progress.tsx charts. An EMPTY history is not an error: plenty
// of people have never recorded a weight, and for them a bodyweight set simply
// has no known load and belongs on the reps board rather than being given an
// invented body here. `weightsKnown` is the difference between "never weighed"
// and "the weigh-ins could not be read", and only the second one is worth an
// apology.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, KpiRow, fig } from './kit';
import { sp, hairline, type as ty, numeric } from '../theme/scale';
import { isWhole, type LoadStatus } from './loadStatus';
import { personalRecords } from '../lib/streaks';
import { repRecords, bodyweightSetLabel, type BodyweightHistory } from '../lib/bodyweightSets';
import { holdRecords, timedSetLabel } from '../lib/timedSets';
import { bestSetLabel } from '../lib/bestSet';
import { est1RMIn, liftLabel, convertedNote, type WeightUnit } from '../lib/units';
import { num } from '../lib/format';
import { appLocale } from '../lib/locale';
import { useMovementName } from './catalogueTranslations';
import type { WorkoutEntry } from '../lib/mockData';

/** How many rows a board shows. Beyond this it stops being a board somebody
 *  reads and becomes their whole training history, which is what the log
 *  itself is for. */
const BOARD_ROWS = 12;

export function OwnRecordsPanel({ log, status, weights, weightsKnown, unit }: {
  /** The signed-in person's own workout log. Pass null under 'error': a stale
   *  array drawn as a record board is the one thing this panel must never
   *  present as current. */
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  /** Their own weight over time, which is what lets a bodyweight set onto the
   *  estimated-max board at all. Empty is fine and is not an error. */
  weights: BodyweightHistory;
  /** Whether that weight history was actually read. False means a pull-up is
   *  missing from the board below because of US, not because it was never
   *  done. */
  weightsKnown: boolean;
  unit: WeightUnit;
}) {
  const t = useTheme();
  // A record is stored under its ENGLISH name — that is the identity, and it is
  // what every lookup uses. `movement()` is what the reader sees: somebody
  // reading "Kniebeuge" in the library should not be told their record is for
  // "Barbell Back Squat".
  const { textOf: movement } = useMovementName();

  const rows = log ?? [];
  // Ranked in the kilograms the board is stored in and only then read out —
  // `personalRecords` sorts on `est1RM` in kg. The order comes out the same
  // today either way, but an estimate rounded to the whole pound can tie two
  // lifts that are a kilogram apart, and a board sorted on the rounded figure
  // would order those two arbitrarily.
  //
  // Every board is computed WHOLE and sliced only for drawing. The counts
  // underneath are taken off the whole ones: "Movements 12" read off a list
  // that was capped at twelve is a figure about this component's layout
  // wearing the name of a figure about somebody's training.
  const allPrs = personalRecords(rows, weights);
  // A movement whose best set is already on the board above is not repeated
  // here as a lesser record of itself. Compared against ALL the estimated-max
  // records, not the twelve drawn, or a thirteenth-ranked pull-up would appear
  // on both boards.
  const allReps = repRecords(rows)
    .filter((r) => !allPrs.some((p) => p.exercise === r.exercise && p.bodyweight));
  const allHolds = holdRecords(rows);
  const prs = allPrs.slice(0, BOARD_ROWS);
  const repsOnly = allReps.slice(0, BOARD_ROWS);
  const holds = allHolds.slice(0, BOARD_ROWS);
  const hidden = (allPrs.length - prs.length) + (allReps.length - repsOnly.length)
    + (allHolds.length - holds.length);
  const nothing = allPrs.length === 0 && allReps.length === 0 && allHolds.length === 0;
  const note = convertedNote(unit);

  const dstr = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short' })
      : '';
  };
  /** The record's load in the reader's own unit, or null when it could not be
   *  read. `liftLabel` already carries the unit, so nothing appends a second
   *  one — that defect read "12 reps at bodyweight +20 kg kg" in three places
   *  at once on the client screen. */
  const setLoad = (pr: { weight: number }): string | null => liftLabel(pr.weight, unit);
  /** What was hung, belted or held on top — null when nothing was. Null rather
   *  than a dash: "at bodyweight +— kg" is worse than "at bodyweight". */
  const setAdded = (pr: { addedKg?: number }): string | null =>
    pr.addedKg ? liftLabel(pr.addedKg, unit) : null;

  /** One row of a board. Assembled as a SENTENCE for the ear, because a
   *  Pressable-free row is still merged into one accessibility element and an
   *  em dash read aloud is a word that has gone missing. Every clause is
   *  withheld when the figure behind it is not there.
   *
   *  A PLAIN FUNCTION, called as `row(key, {…})`, and not a component rendered
   *  as `<Row …/>`. This is the app/(client)/injuries.tsx shape exactly: the
   *  outer View below is `accessible` with a label composed out of four
   *  clauses, so it is ONE element to VoiceOver. A component declared in this
   *  body is a new function object on every render, so React sees a different
   *  element TYPE, unmounts the subtree and mounts a fresh one — and the
   *  reader's cursor goes with it, re-announcing the whole board from the top
   *  every time the unit, the log read or the weigh-in read changes anything.
   *  It closes over `t`, `sp`, `ty`, `hairline` and `numeric` from this body,
   *  which is why it stays here as a call rather than being lifted to module
   *  scope. The `key` is passed in and lands on the returned View, because
   *  there is no longer an element above it to carry one. */
  const row = (k: string, { title, line, when, trail, trailUnit }: {
    title: string; line: string; when: string; trail?: string; trailUnit?: string;
  }) => (
    <View key={k} accessible accessibilityLabel={[title, line, trail ? `${trail} ${trailUnit ?? ''}`.trim() : '', when ? `on ${when}` : '']
      .filter(Boolean).join(', ')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {when ? `${line} · ${when}` : line}
        </Text>
      </View>
      {trail ? (
        <View>
          <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{trail}</Text>
          {trailUnit ? <Text style={{ ...ty.micro, color: t.ink3 }}>{trailUnit}</Text> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
        Your own best set for each movement you have logged. Nothing here is about a client, and
        nobody else can see it.
      </Text>

      {/* ── can any of this be trusted? ───────────────────────────────────
          Three states, three sentences, and only one of them is "you have no
          records". Saying that to somebody whose log simply did not load
          reports their whole board as gone, on the panel whose entire job is
          to keep it. */}
      {status === 'error' ? (
        <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>
          Your records are safe. This could not read your training log just now, so there is no
          board below. Nothing has been reset.
        </Text>
      ) : status === 'loading' ? (
        <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.md }}>Reading your log…</Text>
      ) : status === 'partial' ? (
        <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
          You have logged more than this can read in one go, so these are the best sets among the
          ones it read. A record set outside that may not be here. This is not a statement about
          your whole history.
        </Text>
      ) : null}

      {/* The OTHER read these boards depend on, and the one the client screen
          was silently missing for months: every bodyweight record is priced
          from the weigh-in history, so a failed read of it takes every pull-up
          and dip off the estimated-max board and says nothing. */}
      {!weightsKnown ? (
        <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
          Your weigh-ins could not be read, so pull-ups, dips and press-ups are not on the
          estimated-max board, because they are priced against what you weighed on the day. They are not
          gone, and your barbell records are unaffected.
        </Text>
      ) : null}

      {status === 'error' ? null : nothing && status === 'loading' ? null : nothing ? (
        <Section>
          <Text style={{ ...ty.body, color: t.ink2 }}>
            No records of your own yet. Log a set above and the first one lands here. Pull-ups, dips
            and press-ups count, and so do planks and hangs. A hold gets a board of its own.
          </Text>
        </Section>
      ) : (<>
        {prs.length ? (
          <Section>
            <SectionHead title="Best Estimated Max" note={isWhole(status) ? undefined : 'Not All Read'} />
            {prs.map((pr, i) => row(`${pr.exercise}-${i}`, {
              title: movement(pr.exercise),
              line: bestSetLabel(pr, setLoad(pr), setAdded(pr)),
              when: dstr(pr.at),
              trail: fig(est1RMIn(pr.est1RM, unit)),
              trailUnit: unit,
            }))}
            {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{note}</Text> : null}
          </Section>
        ) : null}

        {repsOnly.length ? (<>
          <Rule />
          <Section>
            <SectionHead title="Most Reps at Bodyweight" />
            {repsOnly.map((r, i) => row(`${r.exercise}-${i}`, {
              title: movement(r.exercise),
              line: bodyweightSetLabel(r.reps, r.addedKg, r.addedKg ? liftLabel(r.addedKg, unit) : null),
              when: dstr(r.at),
              trail: fig(r.reps),
              trailUnit: r.reps === 1 ? 'rep' : 'reps',
            }))}
          </Section>
        </>) : null}

        {holds.length ? (<>
          <Rule />
          <Section>
            <SectionHead title="Longest Hold" />
            {holds.map((h, i) => row(`${h.exercise}-${i}`, {
              title: movement(h.exercise),
              // The seconds are the record. A load is what was held on top
              // and is never presented as the whole of it.
              line: timedSetLabel(h.secs, h.loadKg > 0 ? liftLabel(h.loadKg, unit) : null, h.bodyweight),
              when: dstr(h.at),
            }))}
          </Section>
        </>) : null}

        <Rule />
        <Section>
          {/* Counts, not records — so they are gated on `isWhole`. "9 movements
              on record" computed over a truncated read is a subtotal wearing a
              total's name. */}
          <KpiRow items={[
            { label: 'Movements', value: isWhole(status) ? fig(allPrs.length + allReps.length) : fig(null) },
            { label: 'Holds', value: isWhole(status) ? fig(allHolds.length) : fig(null) },
          ]} />
          {/* Said, rather than left to be noticed. A board that quietly stops
              at twelve is a board that tells a coach with thirty movements that
              they have twelve — and the count above it, which is honest, would
              then be the thing that looked wrong. */}
          {hidden > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {/* `num`, not `fig`: both of these are counts this component
                  just took off arrays it holds, so neither can be unknown —
                  and an em dash inside a sentence is a word that has gone
                  missing rather than an answer in a slot. */}
              The boards above show the top {num(BOARD_ROWS)} of each. {num(hidden)} more
              {hidden === 1 ? ' record is' : ' records are'} on record and counted here.
            </Text>
          ) : null}
        </Section>
      </>)}
    </View>
  );
}
