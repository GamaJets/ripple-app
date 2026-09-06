// The muscle heatmap as a COACH reads it: Training Summary, the body, the
// rankings and the Recovery Map, in that order, over one window.
//
// ── why this is one component and not two copies ──────────────────────────
//
// Two coach screens want it and they want the same thing said two different
// ways. app/(trainer)/client-training.tsx is looking at ONE CLIENT — third
// person, a first name, "has" — and app/(trainer)/my-training.tsx is the
// trainer's own log — second person, "you", "have". That is a difference of
// voice and of nothing else: the arithmetic, the refusals and every sentence
// about what the picture cannot show are identical, and this app has already
// paid for the alternative once. `ExerciseHistoryPanel` beside this file exists
// for the same reason and carries the same `HistoryVoice`, which is why this
// takes that type rather than inventing a second one.
//
// It is also the reason the trainer's own view is built here and not on a
// coach-of-themselves path. Repple's rule is that TRAINERS SELF-TRACK on the
// client hooks — there is no client→trainer promotion anywhere in this product
// — so `my-training.tsx` hands this panel `useWorkoutLog()`, the signed-in
// user's own rows, exactly as the member's app does. Nothing in here knows or
// asks which app it is in.
//
// ── what this component is allowed to say, and what it refuses ────────────
//
// Nothing here computes anything. Every figure comes off `muscleWorkBoard` and
// every sentence about the figures comes out of `windowNote`, `gapNote`,
// `undrawnNote`, `rankingNotes` and `restMapNote`, which were written to say
// precisely what the data supports. Composing a friendlier version of one of
// those here would be this file holding an opinion those files have already
// refused to hold. The four things it does decide are:
//
//  1. WHERE each sentence goes. The modules overlap on purpose — `rankingNotes`
//     opens with `windowNote` and closes with `gapNote` and `undrawnNote`, so a
//     caller rendering only the rankings still gets them — and a screen that
//     renders all four blocks would print three of those sentences twice.
//     `notes` below drops the ones already printed above it, so each is said
//     once, under the block it is about.
//
//  2. WHAT SURVIVES 'partial'. src/ui/loadStatus.ts draws this line and it is
//     drawn again here: under a truncated read the LIST of muscles is real and
//     is shown, and every COUNT over it is withheld. `board.isFloor` is what
//     says the counts are floors; a coach acting on "14 sets" that is really
//     "at least 14, possibly forty" would program the next block against a
//     number nobody measured. The body diagram is the exception and it is not
//     an exception this file makes: `MuscleBody` takes the status itself and
//     draws a truncated read UNGRADED, in the coldest band, with its own
//     sentence saying so.
//
//  3. THAT THE SHADING IS RELATIVE, out loud, beside the key. `fullScaleAt` is
//     published by `diagramShading` for exactly this and the sentence below
//     prints it. A coach comparing two clients, or one client's deload against
//     their overload, must pass `fullScaleAt` in so both pictures share a
//     ceiling — the prop is here for that and the default is this window's own
//     peak, which is right for a single picture and wrong for two.
//
//  4. THAT A MUSCLE IS NEVER CALLED RECOVERED. src/lib/muscleRecovery.ts
//     refuses the word at the API and the refusal is worth nothing if a screen
//     reintroduces it in a heading — more so on a COACH screen, because a coach
//     acts on it and the person it is about is not in the room. Every line here
//     says how long something has rested. None of them says what that means.
import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, KpiRow, Flag, fig } from './kit';
import { sp, radius, hairline, type as ty } from '../theme/scale';
import { isWhole, type LoadStatus } from './loadStatus';
import { MuscleBody } from './MuscleBody';
import type { BodySide } from './muscleArt';
import type { HistoryVoice } from './ExerciseHistory';
import type { WorkoutEntry } from '../lib/mockData';
import { num } from '../lib/format';
import {
  muscleWorkBoard, diagramShading, windowNote, gapNote, undrawnNote,
  type MuscledExercise,
} from '../lib/muscleWork';
import { muscleRankings, rankingNotes, rankingLine } from '../lib/muscleRanking';
import { restMap, restLine, restMapNote, type MuscleRest } from '../lib/muscleRecovery';

const DAY = 86_400_000;

/**
 * How tall the figure is drawn.
 *
 * A number rather than letting it fill its container, because this panel sits
 * inside a `ScrollView` with no bounded height and `flex: 1` in an unbounded
 * scroller collapses to nothing. 300pt is roughly a third of a phone, which
 * leaves the legend and the first ranking rows on the same screenful — the
 * whole argument in src/lib/bodyHeat.ts is that the picture confirms and the
 * list informs, and they have to be readable together for that to be true.
 */
const BODY_HEIGHT = 300;

/** Muscles listed on the map before it says how many more there are. The map's
 *  own order is longest-rested first, so a cut here would take the muscles
 *  trained today off the bottom — which is why it is deliberately generous and
 *  the tail is named rather than dropped. */
const REST_ROWS = 18;

export function MuscleWorkPanel({
  log, logStatus, catalogue, catalogueStatus, nowMs, windowDays,
  windows, onWindowDays, voice, fullScaleAt,
}: {
  /**
   * Everything read, in any order. Null is "the read did not land" and must
   * arrive with `logStatus` 'error' — an empty array under a successful read is
   * a person who trained nothing, which is a different sentence about a named
   * human being.
   */
  log: readonly WorkoutEntry[] | null;
  logStatus: LoadStatus;
  /**
   * The movement catalogue. `CatalogueRow` from src/ui/exerciseDetail.ts
   * satisfies `MuscledExercise` structurally, so a caller passes `cat.rows`
   * with no mapping step.
   *
   * A caller whose catalogue hook reports `signedOut` must pass 'error' as the
   * status below rather than 'ready': that case comes back as zero rows with no
   * error, and a whole read of an EMPTY catalogue would publish an empty
   * vocabulary — which is the board asserting that every muscle in the body is
   * untrained.
   */
  catalogue: readonly MuscledExercise[];
  catalogueStatus: LoadStatus;
  /** The instant the window ends. From `useNow()`, never `Date.now()` in a
   *  memo — both coach screens are `href: null` routes that mount once. */
  nowMs: number;
  windowDays: number;
  /** The windows offered, in days. Omit — or omit `onWindowDays` — and no
   *  control is drawn, for a screen that already has one of its own. */
  windows?: readonly number[];
  onWindowDays?: (days: number) => void;
  voice: HistoryVoice;
  /**
   * Fix the darkest band to this `primaryEquivalentSets` score instead of to
   * this window's own peak.
   *
   * Two pictures shown side by side MUST share one, and the reason is in
   * `DiagramShading`: scaled to their own peaks, a deload fortnight and the
   * hardest block of somebody's life are drawn the identical red. Left unset
   * for a single picture, where scaling to the window is what makes a beginner
   * visible at all.
   */
  fullScaleAt?: number;
}) {
  const t = useTheme();
  // Which way round the figure is standing. Local state: it is a way of looking
  // at one board, not a second question about the data, and the two sides share
  // one `shading` so they cannot be scaled differently from each other.
  const [side, setSide] = useState<BodySide>('front');

  const board = useMemo(() => muscleWorkBoard(log ?? [], catalogue, {
    sinceMs: nowMs - windowDays * DAY,
    nowMs,
    logStatus,
    catalogueStatus,
  }), [log, catalogue, nowMs, windowDays, logStatus, catalogueStatus]);

  const shading = useMemo(
    () => diagramShading(board, fullScaleAt != null ? { fullScaleAt } : {}),
    [board, fullScaleAt],
  );
  const rankings = useMemo(() => muscleRankings(board), [board]);
  const rest = useMemo(() => restMap(board), [board]);

  /* ── the sentences, each said once ─────────────────────────────────────
     `rankingNotes` deliberately repeats three of these so that a screen
     rendering only a ranking table still carries them. This screen renders four
     blocks, so the three are printed under the block they are actually about
     and dropped from the ranking's own list. Dropping by VALUE rather than by
     index: the module is free to reorder or to withhold any of them, and an
     index would silently start deleting the wrong sentence the day it did. */
  const win = windowNote(board);
  const gap = gapNote(board);
  const undrawn = undrawnNote(board);
  const notes = useMemo(() => {
    const said = new Set([win, gap, undrawn].filter((s): s is string => !!s));
    return rankingNotes(board, rankings).filter((n) => !said.has(n));
  }, [board, rankings, win, gap, undrawn]);
  const restNote = restMapNote(board);

  // `isWhole`, never `status !== 'error'`. 'partial' is a prefix of an unknown
  // set and 'loading' is nothing at all, and each of the four blocks below says
  // something different in each of those two states.
  const whole = isWhole(board.status);
  const loading = board.status === 'loading';
  const floor = board.isFloor;

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg,
    paddingVertical: sp.sm,
    borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  const caption = (s: string, top: number = sp.sm) => (
    <Text style={{ ...ty.caption, color: t.ink3, marginTop: top }}>{s}</Text>
  );

  /** One ranked muscle. The figures come off `rankingLine`, which prints REAL
   *  sets and never the dimensionless score the order runs on — a coach who
   *  read "18 sets" for a trapezius that was assisting on ninety movements
   *  would write next week's programme against a number nobody performed. */
  const rankRow = (muscle: string, line: string | null, i: number) => (
    <View key={`${muscle}-${i}`} accessible
      accessibilityLabel={line ? `${muscle}. ${line}` : muscle}
      style={{ paddingVertical: sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{muscle}</Text>
      {line ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{line}</Text> : null}
    </View>
  );

  /**
   * One muscle on the map.
   *
   * `restLine` carries the bound IN THE WORDS — "Not trained in the last 28
   * days", "Last trained 3 days ago", "…in the part of your log we could read
   * — it may be more recent" — so there is no caveat to append and no colour to
   * read it off. The sets on the last day are printed only where the gap is
   * EXACT: under a truncated read that count is a floor like every other, and a
   * coach reading "6 sets" for a day whose other rows never came back is being
   * handed a session that was heavier than it looks.
   */
  const restRow = (r: MuscleRest, i: number) => {
    const line = restLine(r);
    const sets = r.bound === 'exact' && r.lastDaySets != null && r.lastDaySets > 0
      ? `${r.lastDaySets} set${r.lastDaySets === 1 ? '' : 's'} that day.`
      : null;
    return (
      <View key={r.muscle} accessible
        accessibilityLabel={[r.muscle, line, sets, r.drawn ? null : 'Not shown on the body.']
          .filter(Boolean).join(' ')}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.sm,
          borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <Text style={{ ...ty.label, fontWeight: '500', color: t.ink, flex: 1 }}>{r.muscle}</Text>
        <View style={{ flex: 1.4 }}>
          <Text style={{ ...ty.caption, color: t.ink2 }}>{line}</Text>
          {sets ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{sets}</Text> : null}
        </View>
      </View>
    );
  };

  return (
    <View>
      {/* ── the window ────────────────────────────────────────────────────
          Drawn only where the caller has not already got one. On
          client-training.tsx this control and the one over "By Muscle Group"
          are two views of a single piece of state, so the two boards on that
          screen can never be describing different fortnights — which is the
          failure the coach would have no way to see. */}
      {windows && onWindowDays ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
          {windows.map((d) => (
            <Pressable key={d} onPress={() => onWindowDays(d)}
              accessibilityRole="button" accessibilityState={{ selected: windowDays === d }}
              accessibilityLabel={`Last ${d} days`} style={chip(windowDays === d)}>
              <Text style={{ ...ty.micro, color: windowDays === d ? t.brandInk : t.ink2 }}>{d} days</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* ── Training Summary ──────────────────────────────────────────────
          Two figures and no third. There is no SESSIONS count here and there
          will not be one: `workouts` writes one row per exercise, and one real
          gym visit in this product's own data produced seven rows with seven
          distinct `performed_at` values. A day is provable and a session is
          not, and the day count is `board.dayCount` on the screen above rather
          than anything this board could hand back. */}
      <Section>
        <SectionHead title="Training Summary" note={whole ? `last ${windowDays} days` : undefined} />
        {loading ? (
          <Text style={{ ...ty.body, color: t.ink3 }}>Reading the training&hellip;</Text>
        ) : (
          <>
            <KpiRow items={[
              // Withheld under anything but a whole read, and a floor is not a
              // total: `isFloor` means every count is "at least this", so the
              // caption below carries the figure in words rather than the slot
              // carrying it as a number a coach would read as one.
              { label: 'Sets Counted', value: whole ? num(board.setsCounted) : fig(null) },
              { label: 'Muscles Trained', value: whole ? num(board.muscles.length) : fig(null) },
            ]} />
            {win ? (
              <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{win}</Text>
            ) : null}
            {whole && board.setsCounted > 0
              ? caption('That is sets performed, counted once each. One set reaches every muscle the '
                + 'movement names, so the per-muscle counts further down are per muscle and may not be '
                + 'added together.', sp.md)
              : null}
            {floor && board.muscles.length > 0
              ? caption(`${board.muscles.length} muscles appear in the part of the log that came back. `
                + 'There may be more, and each of them may have been worked harder than the rows here '
                + 'show, so no count over them is printed.', sp.md)
              : null}
            {gap ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{gap}</Flag> : null}
          </>
        )}
      </Section>

      {/* ── the body ──────────────────────────────────────────────────────
          `MuscleBody` takes the status and draws four different pictures from
          it, so nothing is gated here — a gate would replace a picture that
          already says which of the four it is with a sentence that says less. */}
      <Section>
        <SectionHead title="Where the Work Landed" />
        <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
          {(['front', 'back'] as const).map((s) => (
            <Pressable key={s} onPress={() => setSide(s)}
              accessibilityRole="button" accessibilityState={{ selected: side === s }}
              accessibilityLabel={s === 'front' ? 'Front of the body' : 'Back of the body'}
              style={chip(side === s)}>
              <Text style={{ ...ty.micro, color: side === s ? t.brandInk : t.ink2 }}>
                {s === 'front' ? 'Front' : 'Back'}
              </Text>
            </Pressable>
          ))}
        </View>

        <MuscleBody side={side} intensity={shading.byLayer} status={board.status}
          height={BODY_HEIGHT} />

        {/* ── the sentence the picture cannot say about itself ───────────
            The shading is scaled to the hardest-worked muscle IN THIS WINDOW,
            so the darkest band means "the most of it here" and never a
            quantity. Without this line a coach reads a deload fortnight as a
            hard one, and reads one client's easy week as another client's
            heavy one — which is the specific misreading `fullScaleAt` is
            published to prevent. The score is printed WITHOUT the word "sets"
            after it: `primaryEquivalentSets` is dimensionless and a member
            never performed it. */}
        {whole && shading.hasWork ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Shading is relative to this window and to nothing else. The darkest band is the
            hardest-worked muscle in it, scoring {num(shading.fullScaleAt)} where a set as the main
            mover counts one and a set assisting counts a half
            {fullScaleAt != null ? ', on a scale fixed by the screen so two pictures can be compared' : ''}.
            {' '}A quiet {windowDays} days and a brutal {windowDays} days are drawn the same way, so the
            colours compare muscles with each other, never one period with another.
          </Text>
        ) : null}

        {/* Which of the picture's muscles are drawn by a stand-in rather than
            by their own layer. Only the ones this window actually relies on. */}
        {shading.approximations.map((a) => (
          <Text key={a} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{a}</Text>
        ))}

        {/* Work that happened, is in every figure above, and has no artwork.
            `serratus anterior` is the real one — forty movements name it and
            the manifest has no layer for it — and a coach who saw an unlit
            chest wall after a fortnight of pullovers would conclude the log
            was broken. */}
        {undrawn ? <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{undrawn}</Flag> : null}
      </Section>

      {/* ── the rankings ──────────────────────────────────────────────────
          Beside the body deliberately: the four bands are 1.24–1.38:1 apart,
          which is two oranges that read as one, so src/lib/bodyHeat.ts asks
          that a screen drawing this body draws the list too. The picture
          confirms; the list informs. */}
      <Section>
        <SectionHead title="Most and Least Trained"
          note={whole && rankings.most.length ? `${board.muscles.length}` : undefined} />
        {loading ? (
          <Text style={{ ...ty.body, color: t.ink3 }}>Reading the training&hellip;</Text>
        ) : board.status === 'error' ? (
          /* The window sentence in the Training Summary above has already said
             the read failed. What this block owes on top of that is why there
             is no table under a heading that promises one — and it must not be
             the empty-window sentence below, which is a claim about training
             that did not happen. */
          <Text style={{ ...ty.body, color: t.ink2 }}>
            No ordering is drawn, because there is nothing to order. That is the read and not
            {' '}{voice.their} training.
          </Text>
        ) : !board.muscles.length ? (
          <Text style={{ ...ty.body, color: t.ink2 }}>
            Nothing in the last {windowDays} days could be filed to a muscle, so there is no ordering
            to draw. Cardio is logged as time and distance rather than as sets and never appears here.
          </Text>
        ) : !whole ? (
          /* ── a prefix has an order and no figures ─────────────────────
             The muscles below are real: they were named by sets that really
             happened, and src/ui/loadStatus.ts permits a LIST under 'partial'.
             What is withheld is every number, and the ORDER is offered as what
             it is — an ordering of the rows that came back, not of the log. */
          <>
            <Flag tone={t.warn}>
              The log was read in part, so the counts behind this order are floors rather than totals
              and are not printed. The muscles are real and so is what {voice.they} did to them; how
              much of it is here is not something this read can say.
            </Flag>
            <View style={{ marginTop: sp.md }}>
              {board.muscles.slice(0, 10).map((m, i) => rankRow(m.muscle, null, i))}
            </View>
          </>
        ) : (
          <>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Hardest worked first</Text>
            <View style={{ marginTop: sp.sm }}>
              {rankings.most.map((m, i) => rankRow(m.muscle, rankingLine(m), i))}
            </View>

            {/* One list when the board is short. `overlapping` is the module
                saying that both ends would print the same muscle under two
                opposite headings, which reads as a bug and is in fact a board
                with fewer muscles on it than the two lists have rows. */}
            {rankings.overlapping ? (
              caption(`That is every muscle ${voice.they} ${voice.have} trained in this window, hardest `
                + 'first, so there is no separate least-trained list to draw — the bottom of this one '
                + 'is it.', sp.md)
            ) : (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Least worked, of the muscles with work</Text>
                {caption('Every muscle here was trained. A muscle with nothing against it is not in this '
                  + 'list — that is the sentence below, and it is a different kind of claim.', 4)}
                <View style={{ marginTop: sp.sm }}>
                  {rankings.least.map((m, i) => rankRow(m.muscle, rankingLine(m), i))}
                </View>
              </View>
            )}

            {/* ── the absence, stated only where it can be ───────────────
                `untrained` is null unless BOTH reads came back whole, because
                it is a claim built on rows that are not there and a short read
                manufactures those for free. Where it is null, `notes` below
                carries the sentence saying which of the two reads withheld it
                — an absent section with no explanation reads as "they have
                trained everything", which is the strongest claim this screen
                could make and the one nothing here supports. */}
            {rankings.untrained && rankings.untrained.length ? (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>No logged set in this window</Text>
                <Text style={{ ...ty.body, color: t.ink2, marginTop: 4 }}>
                  {rankings.untrained.slice(0, 8).join(', ')}
                  {rankings.untrained.length > 8 ? `, and ${rankings.untrained.length - 8} more` : ''}.
                </Text>
                {caption(`That is the last ${windowDays} days and not ${voice.their} training. A muscle `
                  + 'here may have been worked hard a month ago; the window is what this list is about.', 4)}
              </View>
            ) : null}
          </>
        )}
        {notes.map((n) => (
          <Text key={n} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{n}</Text>
        ))}
      </Section>

      {/* ── the Recovery Map ──────────────────────────────────────────────
          Elapsed time since the last logged set, banded and bounded, and
          nothing else. There is no readiness figure on this screen and there is
          no green tick, because this app measures none of what those words
          would be claiming — not how hard the session was, not how the person
          slept, not whether they are hurt. `REST_MEANS`, inside `restMapNote`
          below, is the sentence that says so, and it matters more here than on
          the member's own screen: a coach acts on this, and the person it
          describes is not in the room to disagree. */}
      <Section>
        <SectionHead title="Recovery Map" note={rest.length ? `${rest.length}` : undefined} />
        {loading ? (
          <Text style={{ ...ty.body, color: t.ink3 }}>Reading the training&hellip;</Text>
        ) : rest.length === 0 ? (
          <Text style={{ ...ty.body, color: t.ink2 }}>
            {board.status === 'error'
              ? 'No map is drawn, because nothing came back to draw it from.'
              : `Nothing in the last ${windowDays} days names a muscle, so there is no last-trained time `
                + 'to show for any of them.'}
          </Text>
        ) : (
          <>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Longest since a logged set first</Text>
            <View style={{ marginTop: sp.sm }}>
              {rest.slice(0, REST_ROWS).map(restRow)}
            </View>
            {rest.length > REST_ROWS
              ? caption(`${rest.length - REST_ROWS} more muscles are further down this order, which `
                + 'runs from the longest since a logged set to the shortest.', sp.md)
              : null}
          </>
        )}
        {restNote ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{restNote}</Text>
        ) : null}
      </Section>
    </View>
  );
}
