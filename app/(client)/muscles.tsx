// Client · Muscles — the body, what it actually worked, and how long ago.
//
// Four things a member has asked for and this app could not answer, on one
// screen because they are one question asked four ways: a Training Summary,
// a body diagram, the muscle rankings, and a Recovery Map.
//
// Everything here is arithmetic that already exists and is asserted under plain
// node — src/lib/muscleWork.ts, src/lib/muscleRanking.ts,
// src/lib/muscleRecovery.ts and src/lib/bodyHeat.ts. This file READS and
// RENDERS and holds no opinion of its own about a muscle. Where a sentence
// below looks like a judgement, it came out of one of those modules
// (`windowNote`, `gapNote`, `undrawnNote`, `rankingNotes`, `restMapNote`,
// `rankingLine`, `restLine`) precisely so that it could be asserted somewhere.
//
// ── The three reads, and why the board folds them ─────────────────────────
//
// The workout log (src/ui/workoutLog.tsx) and the exercise catalogue
// (`useExerciseCatalogue`) are two independent reads that fail independently,
// and neither is any use without the other: a log with no catalogue names
// movements and no muscles, a catalogue with no log names muscles and no work.
// `muscleWorkBoard` takes both statuses and publishes the WORSE of them, so
// there is exactly one `board.status` on this screen and no way for half of it
// to be drawn from a read that did not finish. Every figure below is gated on
// `isWhole(board.status)` or on `board.isFloor`, never on `!== 'error'` — see
// src/ui/loadStatus.ts, and scripts/check-whole.mjs for what that mistake has
// cost fourteen times.
//
// The catalogue read has a fourth answer the status cannot carry: signed out.
// Its policy is `to authenticated`, so a signed-out session is handed zero rows
// and no error, which arrives here as a member who has trained nothing. That is
// checked before anything is counted.
//
// ── Three words this screen does not say ──────────────────────────────────
//
//   "recovered", "ready", "fresh".  src/lib/muscleRecovery.ts refuses all three
//   at length and the refusal is the feature: this app knows when a set was
//   logged and knows nothing about how hard it was, how somebody slept or how
//   they feel. So the Recovery Map says how long a muscle has RESTED, in the
//   bounded words `restLine` produces, and a member who wants to read
//   "recovered" into that has to supply the word themselves rather than being
//   handed it by a screen.
//
//   "sessions".  `workouts` writes one row per exercise and a single gym visit
//   produced seven rows with seven distinct `performed_at`, so a session count
//   is not derivable from this data at all — the note under Days Trained on
//   app/(client)/history.tsx is the write-up. Sets and days are provable; a
//   session is not, and nothing here prints one.
//
// ── The shading is RELATIVE, and the picture cannot say so ────────────────
//
// `diagramShading` scales against the hardest-worked muscle IN THE WINDOW, so
// a deload week and the heaviest week of somebody's life draw the identical
// darkest band. `fullScaleAt` is what the darkest band stands for, and it is
// printed beside the key rather than kept private — without it the diagram is
// a picture whose units change every time the window does.
//
// ── The window, and the caption that has already lied once ────────────────
//
// Three windows, and the caption is `windowNote(board)` rather than the member's
// own choice echoed back. "Over the last 90 days" printed above twelve days of
// log is a sentence this codebase has shipped; `windowNote` is the function
// that decides whether the window may be named at all, and what to say instead.
import { useCallback, useMemo, useState } from 'react';
import { trainIntent } from '../../src/lib/trainIntent';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, PageHead, KpiRow, Meter, Segmented, Expandable, Ghost, Cta, Flag, fig } from '../../src/ui/kit';
import { sp, layout, hairline, font, type as ty, numeric } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useNow } from '../../src/ui/today';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useClientData } from '../../src/ui/clientData';
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { useSettings } from '../../src/ui/settings';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { isWhole } from '../../src/ui/loadStatus';
import { MuscleBody } from '../../src/ui/MuscleBody';
import { layerNames, type BodySide } from '../../src/ui/muscleArt';
// Which view of the body this window's work is actually on. See its header for
// the session that produced the report: four posterior movements, and a screen
// that opened on the front and drew an unlit body.
import { busierSide } from '../../src/lib/bodyHeat';
import { num, num1 } from '../../src/lib/format';
import { volumeIn, convertedNote } from '../../src/lib/units';
import {
  muscleWorkBoard, diagramShading, windowNote, gapNote, undrawnNote,
} from '../../src/lib/muscleWork';
import { muscleRankings, rankingNotes, rankingLine } from '../../src/lib/muscleRanking';
import { restMap, restLine, restMapNote } from '../../src/lib/muscleRecovery';

/** The windows on offer, in days. Seven answers "what have I trained this
 *  week"; thirty answers "what have I neglected this block"; ninety is the
 *  longest a Recovery Map can be read as being about a body at all. The
 *  CAPTION is never built from this number — see `windowNote`. */
const WINDOWS = [7, 30, 90] as const;
type WindowDays = (typeof WINDOWS)[number];

const DAY = 86_400_000;

/** A catalogue muscle name as a heading. The anatomical names are not
 *  prettified beyond their capital — inventing a friendlier word for
 *  `infraspinatus` would be inventing a claim about which muscle it is, which
 *  is the same line `sayLayer` in src/lib/bodyHeat.ts holds. */
const say = (m: string): string => m.charAt(0).toUpperCase() + m.slice(1);

export default function Muscles() {
  const t = useTheme();
  const router = useRouter();
  // The reader's own language for a movement name. The stored name is untouched
  // — it is the identity the catalogue is keyed on, and the join in
  // `muscleWorkBoard` runs on the slug of it.
  const { textOf: movement } = useMovementName();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const { rows, status: catalogueStatus, signedOut, reload: reloadCatalogue } = useExerciseCatalogue();
  // A bodyweight set is priced at what the member weighed ON OR BEFORE the day
  // of it, never at today's figure carried backwards — see
  // src/lib/bodyweightSets.ts. Without it a member who trains on rings has a
  // window of real work carrying no tonnage at all.
  const cd = useClientData();
  const { weightSeries } = cd;
  // And whether that read answered. An empty `weightSeries` under a failed scans
  // read is indistinguishable from somebody who has never been weighed, and the
  // difference decides whether the sentence under a short tonnage blames their
  // record or this screen.
  const bodyKnown = isWhole(cd.scansStatus);
  // And whether it has ANSWERED at all yet, which is a third thing.
  //
  // `bodyKnown` is false under 'loading' as well as under 'error' and
  // 'partial', so the unpriced-sets line below told a member their weight
  // history "could not be read just now" while the read was still in flight —
  // the weight read and the two reads behind `board.status` are independent, so
  // a board that has landed sitting over scans that have not is the ordinary
  // case rather than a rare one. A failure claimed before there is a failure is
  // the mirror image of the rule this whole screen is built on, and it is the
  // half nothing checks for: check-whole.mjs gates a FIGURE on 'did not fail',
  // and this was a SENTENCE asserting a failure that had not happened.
  const bodyPending = cd.scansStatus === 'loading';
  const wu = useSettings().weightUnit;
  const unitNote = convertedNote(wu);

  const [days, setDays] = useState<WindowDays>(7);
  /* ── which way round the body opens ──────────────────────────────────────
   *
   * Null means "nobody has chosen", and the picture then follows the work —
   * `busierSide` below. A member who taps Front or Back has chosen, and their
   * choice stands for the rest of the visit including across a change of
   * window, because it is an answer about what they want to look at and not
   * about any one window's data.
   *
   * Two pieces of state and not one, deliberately. Seeding `useState` from the
   * board would freeze the answer at whatever the reads held on the first
   * render — which on a screen mounted before the log lands is an empty board,
   * so the default would be computed from nothing and never revisited. That is
   * the frozen-at-mount defect src/ui/today.ts exists for, one field over.
   */
  const [sidePick, setSidePick] = useState<BodySide | null>(null);

  /* `useNow()`, and it is IN the dependency list. A window whose start comes
   * from `Date.now()` inside a memo keyed on the reads is pinned to whenever
   * those reads last answered — which, on a screen reached from a tab and never
   * unmounted, is whenever it first mounted. app/(client)/trends.tsx and
   * app/(client)/history.tsx both carry the write-up of what that cost; this
   * screen says "the last 7 days" in those words and has to mean today's. */
  const now = useNow();

  const board = useMemo(
    () => muscleWorkBoard(log, rows, {
      sinceMs: now.getTime() - days * DAY,
      nowMs: now.getTime(),
      history: weightSeries,
      // Carried, not consulted for filtering. The arithmetic is the same
      // however the rows arrived; what changes is what this screen may SAY
      // about the answer, and that is `board.status` and `board.isFloor`.
      logStatus,
      catalogueStatus,
    }),
    [log, rows, days, weightSeries, logStatus, catalogueStatus, now],
  );

  const shading = useMemo(() => diagramShading(board), [board]);
  /* The side to draw: the member's own choice, or the one their window's work
   * is actually on. `layerNames` is the artwork's manifest for each view, so
   * this asks the same question the picture answers. */
  const side: BodySide = sidePick
    ?? busierSide(shading.byLayer, layerNames('front'), layerNames('back'));
  const rankings = useMemo(() => muscleRankings(board), [board]);
  const notes = useMemo(() => rankingNotes(board, rankings), [board, rankings]);
  const rests = useMemo(() => restMap(board), [board]);

  // Distinct movements that reached a muscle. A union of names, never a sum:
  // one set of back squats is one set and five muscles, so `board.muscles`
  // cannot be added up — the header of src/lib/muscleWork.ts is explicit that
  // `setsCounted` is the only figure that answers "sets performed".
  const movements = useMemo(() => {
    const seen = new Set<string>();
    for (const m of board.muscles) for (const e of m.exercises) seen.add(e);
    return seen.size;
  }, [board]);

  const pull = usePullToRefresh(useCallback(() => {
    reloadLog(); reloadCatalogue(); cd.reload();
  }, [reloadLog, reloadCatalogue, cd.reload]));

  const retry = useCallback(() => { reloadLog(); reloadCatalogue(); }, [reloadLog, reloadCatalogue]);

  const G = layout.gutter;
  // The board's pushed-page head: back, the title centred. The eyebrow it
  // had ("What you have actually worked") is what the Training Summary card
  // below now says in figures.
  const header = <PageHead title="Your Muscles" />;

  // The window as the kit's segmented bar, over everything it filters. The
  // CAPTION is never built from this number — see `windowNote`.
  const picker = (
    <Segmented style={{ marginTop: sp.md }}
      value={String(days) as `${WindowDays}`}
      onChange={(k) => setDays(Number(k) as WindowDays)}
      options={WINDOWS.map((d) => ({ key: String(d) as `${WindowDays}`, label: `${d} Days`, a11yLabel: `Last ${d} Days` }))} />
  );

  const frame = (children: React.ReactNode) => (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>
        {header}
        {children}
      </ScrollView>
    </SafeAreaView>
  );

  /* ── the catalogue's fourth answer, which no status carries ────────────── */
  //
  // Zero rows and no error, because the read policy is `to authenticated`. It
  // arrives at `muscleWorkBoard` as a catalogue that names no muscles, and
  // every movement in the log then lands in `unmatched` — a member who has
  // trained all week reading "nothing we can file to a muscle". Checked first.
  if (signedOut) {
    return frame(
      <><Section>
        <SectionHead title="Sign in to See This" />
        <Text style={{ ...ty.body, color: t.ink2 }}>
          The exercise catalogue is only available once you are signed in, so we cannot say which
          muscles your sessions worked. Your training is not affected and nothing is missing
          from it.
        </Text>
      </Section></>
    );
  }

  /* ── 1 of 3: still asking ─────────────────────────────────────────────── */
  //
  // Three states, three sentences, and they are never collapsed. This one
  // claims nothing at all.
  if (board.status === 'loading') {
    return frame(
      <><Section>
        <Text style={{ ...ty.label, color: t.ink3 }}>Reading your training and the exercise catalogue&hellip;</Text>
      </Section></>
    );
  }

  /* ── 2 of 3: a read broke ─────────────────────────────────────────────── */
  //
  // Deliberately NOT the empty state. "You have trained nothing" is the one
  // sentence a failed read must never produce, because it is a statement about
  // a member's own week made by a screen that could not look at it.
  if (board.status === 'error') {
    return frame(
      <><Section>
        <SectionHead title="Could Not Read This" />
        <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>
          We could not read your training, the exercise catalogue, or both, so there is no picture
          of your muscles to draw. Nothing has been lost — this screen failed to read what is
          there, so it cannot tell you what is in it either way.
        </Text>
        <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try Again" onPress={retry} /></View>
      </Section></>
    );
  }

  /* ── 3 of 3: the reads landed ─────────────────────────────────────────── */
  //
  // 'ready' or 'partial' from here down. Under 'partial' every count on the
  // board is a FLOOR — `board.isFloor` — and is worded as one rather than
  // printed as a total. That is the whole of the difference and it is carried
  // in the WORDS, not in a footnote after the number.
  const whole = isWhole(board.status);
  const floor = board.isFloor;
  const caption = windowNote(board);
  const gaps = gapNote(board);
  const undrawn = undrawnNote(board);
  const restNote = restMapNote(board);
  // `most` and `least` come off the same short array when a member has trained
  // fewer than ten muscles, so showing both would print the same muscle under
  // two opposite headings. One list then, and it is the honest one.
  const showLeast = rankings.least.length > 0 && !rankings.overlapping;

  return frame(<>
    {picker}

    {/* ── the body ─────────────────────────────────────────────────────── */}
    <Section>
      {/* The body is what this screen is for, so it is the first card and
          the front/back choice is the board's segmented bar over it. */}
      <Segmented style={{ marginBottom: sp.lg }} value={side} onChange={setSidePick}
        options={[
          { key: 'front', label: 'Front', a11yLabel: 'Front of the body' },
          { key: 'back', label: 'Back', a11yLabel: 'Back of the body' },
        ] as const} />

      {/* The diagram takes the status because an empty intensity map means two
          different things — nothing trained, or nothing read — and it draws
          them differently. It says its own sentence for each; nothing here has
          to guess.

          A HEIGHT and not a flex, because this is a scroller and not a column
          with a spare vertical: `flex: 1` inside a `ScrollView` content view
          has no height to take a share of, so the figure would collapse. Only
          the height is given — the component holds each side's own aspect
          ratio (0.3716 at the front, 0.3879 at the back) and a shared width
          would squash one of them. 330 points is the whole figure above the
          fold on a phone and grows nothing when the reader's text does, which
          is right: it is a drawing and not type. */}
      {/* `onFlip` turns the "n muscles you trained are drawn on the back" note
          into the control that takes the reader there. Without it that
          sentence tells somebody their work is on the other view and leaves
          them to find the bar above the picture — and the reader most likely
          to miss the bar is exactly the one staring at an unlit body. */}
      <MuscleBody side={side} intensity={shading.byLayer} status={board.status} height={330}
        onFlip={() => setSidePick(side === 'front' ? 'back' : 'front')} />

      {/* ── what the darkest colour is worth ──────────────────────────────
          Printed, and printed as a figure rather than implied, because the
          shading is scaled against the hardest-worked muscle IN THIS WINDOW.
          Without this line a deload week and the heaviest week of somebody's
          training draw the same body, and the member has no way to tell.

          Withheld under 'partial': there the bands are not claimed at all —
          MuscleBody draws every lit muscle in band 1 and suppresses the key —
          so a scale for a grading that did not happen would be a caption for a
          picture that is not there. */}
      {/* One tap away rather than under the picture: it is the answer to
          "what does dark mean", and five lines of it pushed the figures the
          picture is ABOUT off the first screen. The scale's own number stays
          inside it, whole. */}
      {whole && shading.hasWork ? (
        <View style={{ marginTop: sp.md }}>
        <Expandable title="How the Colours Work">
        <Text style={{ ...ty.caption, color: t.ink3 }}>
          {/* "in this window" and not "over the last N days". The window is the
              filter and the record may be shorter than it — naming the window
              beside a figure is the mistake `windowNote` exists to prevent, and
              its sentence is already the Hero's note above. */}
          The colours compare your muscles with each other in this window and never with a
          target. The darkest band is your hardest-worked muscle, which scores{' '}
          {num1(shading.fullScaleAt)} on a count that takes a set where the muscle is the main mover
          as one and a set where it assists as a half. A quiet fortnight and a brutal one both fill
          the body, so read the list below for the sets themselves.
        </Text>
        </Expandable>
        </View>
      ) : null}

      {/* The approximations this particular picture is leaning on. Only the
          ones actually used — a window of exactly-drawn work carries none. */}
      {shading.approximations.map((a) => (
        <Flag key={a} tone={t.ink3} style={{ marginTop: sp.sm }}>{a}</Flag>
      ))}

      {/* Muscles counted in every figure on this screen that the artwork has no
          layer for. `serratus anterior` is the real one — forty movements name
          it and the manifest draws none of them — and a member who trained it
          and sees an unlit body is owed the reason. */}
      {undrawn ? <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>{undrawn}</Flag> : null}
    </Section>


    {/* ── Training Summary ─────────────────────────────────────────────── */}
    {/* `setsCounted`, never `Σ muscles[].primarySets`. One set of back squats
        is one set here and five muscles on the board below it; summing the
        rows would report a number of sets nobody performed. */}
    {/* Three tiles on the ground under the picture, where the figure card
        was: the picture is this page's hero, and these are what it counts.
        Under a prefix read every one is a floor, and says so as its unit —
        "at least" is part of the figure, not a footnote to it. */}
    <KpiRow tiles items={[
      { label: 'Sets Logged', value: fig(num(board.setsCounted)), unit: floor ? 'at least' : undefined, tone: 'brand' },
      { label: 'Muscles Worked', value: fig(num(board.muscles.length)), unit: floor ? 'at least' : undefined, tone: 'orange' },
      { label: 'Movements', value: fig(num(movements)), unit: floor ? 'at least' : undefined, tone: 'blue' },
    ]} />
    {caption ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{caption}</Text> : null}
    {/* Work that happened and is in NO figure above: a movement we have never
        heard of, and a movement in our own catalogue with no muscles recorded
        against it. Two different problems with two different owners, which is
        why `gapNote` writes them as two sentences. */}
    {gaps ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{gaps}</Flag> : null}


    {/* ── the rankings ─────────────────────────────────────────────────── */}
    {/* The list, not the picture, is the information. src/lib/bodyHeat.ts is
        explicit about why: the four bands are 1.24–1.38:1 apart, which is two
        oranges that read as one in sunlight or with any red-green deficiency,
        so a screen drawing the body is expected to draw this beside it. */}
    <Section>
      <SectionHead title="Most Trained" note={rankings.most.length ? `Top ${rankings.most.length}` : undefined} />
      {/* `rankingLine` writes "6 sets as the main muscle", flat, because it is a
          pure function of one row and cannot see how the rows were read. Under
          a prefix read every one of those counts is a floor, so the qualifier
          goes over the list once rather than being wedged into thirty lines —
          and it goes ABOVE them, where it is read before the numbers are,
          rather than under them as a footnote nobody reaches. */}
      {floor && rankings.most.length ? (
        <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
          Your log was read in part, so every count here is at least this and may be more.
        </Flag>
      ) : null}
      {rankings.most.length === 0 ? (
        <Text style={{ ...ty.body, color: t.ink2 }}>
          Nothing in this window could be filed to a muscle, so there is nothing to rank. Cardio is
          logged as time and distance rather than as sets and never appears here.
        </Text>
      ) : rankings.most.map((e, i) => (
        <View key={e.muscle} style={{ paddingBottom: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
          {/* ── the bar is the picture's own scale ──────────────────────────
              Its length is this muscle's score over the hardest-worked
              muscle's — exactly what shades the body above, in the body's own
              orange, so the list and the picture are one reading. It is drawn
              and never printed (see below for why no number may be), and not
              drawn at all under a read that was not whole: the picture claims
              no bands there, so the list claims no lengths. */}
          <Meter label={say(e.muscle)} note={rankingLine(e)} tone="orange"
            val={whole ? e.primaryEquivalentSets : null} target={shading.fullScaleAt} />
          {/* ── the row carries no figure of its own, on purpose ────────────
              The obvious layout puts a number against the trailing edge, and
              there is no number here that may go in it. `primaryEquivalentSets`
              orders the list and is dimensionless — a member who did six direct
              trapezius sets must never read "18" because thirty other movements
              list the trapezius as an assistant. And `primarySets` and
              `secondarySets` are both real counts of real sets that
              src/lib/muscleWork.ts forbids adding: "safe to print — as
              ASSISTING sets, never added to the line above and shown as one
              total". So the two figures stay two figures and `rankingLine`
              writes them out, which also fits the case a single number cannot
              say at all — a muscle that only ever assisted. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
            {e.exercises.slice(0, 3).map(movement).join(', ')}
            {e.exercises.length > 3 ? `, and ${e.exercises.length - 3} more` : ''}
          </Text>
          {/* Labelled by the ROLE and never by the muscle. This is the tonnage
              of the sets in which this muscle was the prime mover — a real
              measurement of a bar — and not a claim that the muscle moved it.
              src/lib/muscleWork.ts refuses to compute the second thing at all
              and says why: "your hamstrings moved 4,200 kg" is a measurement
              nobody took, of a quantity that does not exist. */}
          {whole && e.primaryVolumeKg != null ? (
            <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
              {num(volumeIn(e.primaryVolumeKg, wu))} {wu} moved in the sets where it led.
            </Text>
          ) : null}
          {/* Said whether or not a tonnage was printed. A bodyweight set that
              nobody can price is real work either way, and the two sentences
              are two different facts: one is a gap in the member's own record
              and the other is this screen failing to read it. The version that
              says the first when the truth is the second tells somebody with
              two years of weigh-ins to go and add their weight. */}
          {e.unpricedSets > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              {bodyKnown
                ? `${num(e.unpricedSets)} of the sets counted here carry no load on record, so no weight is shown for them.`
                : bodyPending
                ? `${num(e.unpricedSets)} of the sets counted here carry no load yet — your weight history is still being read. Nothing is missing from your record.`
                : `${num(e.unpricedSets)} of the sets counted here carry no load because your weight history could not be read just now. That is this screen rather than a gap in your record.`}
            </Text>
          ) : null}
        </View>
      ))}
      {whole && rankings.most.some((e) => e.primaryVolumeKg != null) && unitNote ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{unitNote}</Text>
      ) : null}

      {/* Least trained is the dangerous half and it is not the other end of one
          list: every row here is a muscle with work in the window, ordered up
          from the least of it. A muscle with NOTHING against it is an assertion
          of absence and lives in `rankings.untrained`, which is null unless
          both reads landed whole. */}
      {showLeast ? (<>
        <View style={{ height: sp.xl }} />
        <SectionHead title="Least Trained" note="Of the muscles you did work" />
        {rankings.least.map((e) => (
          // The same bar on the same scale as the list above, so a short one
          // here is short BESIDE those — in blue, because this list is not
          // the heat the body is drawn in.
          <Meter key={e.muscle} label={say(e.muscle)} note={rankingLine(e)} tone="blue"
            val={whole ? e.primaryEquivalentSets : null} target={shading.fullScaleAt} />
        ))}
      </>) : null}

      {/* Muscles the catalogue knows and this window does not contain, stated
          only where the claim is supportable — and where it is not,
          `rankingNotes` says so out loud below rather than leaving the silence
          to be read as "you have trained everything". */}
      {rankings.untrained && rankings.untrained.length ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Nothing logged for {rankings.untrained.slice(0, 6).map(say).join(', ')}
          {rankings.untrained.length > 6 ? `, and ${num(rankings.untrained.length - 6)} more` : ''} in
          this window.
        </Text>
      ) : null}

      {/* ── every sentence the ranking is not saying ──────────────────────
          `rankingNotes` assembles the window caption, the basis of the
          ordering, the reason there is no "not trained" list when there is
          none, and both halves of `gapNote` and `undrawnNote` — as a LIST
          rather than one string, so a screen can put the caption at the top and
          the caveats at the bottom, and so a caller that renders none of them
          fails review visibly.

          Three of those are already on this screen in the places they belong
          to: the window caption is the Hero's note, `gapNote` sits under the
          figures it is about, and `undrawnNote` sits under the picture that
          cannot draw them. So they are filtered out HERE rather than dropped
          from the list — compared by value against the very strings that were
          rendered, so that a sentence which stopped being shown up there starts
          being shown down here on its own. Nothing is silently omitted and
          nothing is printed twice.

          `RANKING_BASIS` and the withheld-`untrained` explanation are what
          survive, and they are the two the list itself needs: the first says an
          assisting set counted as a half, and the second stops the ABSENCE of
          an untrained section reading as "you have trained everything". */}
      {notes.some((n) => n !== caption && n !== gaps && n !== undrawn) ? (
        <View style={{ marginTop: sp.md }}>
          <Expandable title="How This Is Ranked">
            {notes.filter((n) => n !== caption && n !== gaps && n !== undrawn).map((n) => (
              <Text key={n} style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{n}</Text>
            ))}
          </Expandable>
        </View>
      ) : null}
    </Section>


    {/* ── the Recovery Map ─────────────────────────────────────────────── */}
    {/* Named for what a member calls it and careful about what it says. Every
        row is elapsed time since a logged set, bounded in the words themselves
        — "Not trained in the last 30 days", "Last trained 3 days ago", "in the
        part of your log we could read". There is no readiness figure here, no
        tick and no green, because this app measures none of the things that
        would justify one. */}
    <Section>
      <SectionHead title="Recovery Map" note={rests.length ? `${num(rests.length)} muscles` : undefined} />
      {rests.length === 0 ? (
        <Text style={{ ...ty.body, color: t.ink2 }}>
          There is nothing to map yet — no set in this window could be filed to a muscle, and the
          exercise catalogue is what would otherwise list the muscles you have not trained.
        </Text>
      ) : rests.map((r, i) => (
        <View key={r.muscle} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
          <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{say(r.muscle)}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{restLine(r)}</Text>
          {/* What it was asked to DO that day, beside how long ago it was and
              deliberately not combined with it. A single score mixing "three
              days ago" with "eleven sets" is a readiness index, it would be
              read as one, and src/lib/muscleRecovery.ts has already said why it
              will not produce one. Both figures; the member decides. */}
          {r.lastDaySets != null && r.lastDaySets > 0 ? (
            <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
              {num(r.lastDaySets)} set{r.lastDaySets === 1 ? '' : 's'} that day.
            </Text>
          ) : null}
          {!r.drawn ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              Counted here, not shown on the body above.
            </Text>
          ) : null}
        </View>
      ))}
      {restNote ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{restNote}</Text>
      ) : null}
    </Section>


    {/* Nothing on this screen is a plan. The one thing a member can do about
        any of it is train, so the way out goes there rather than to another
        page of the same numbers. */}
    <Section>
      <Cta label="Log a Workout" wide onPress={() => router.push(trainIntent('/(client)/workouts') as any)} />
    </Section>
  </>);
}
