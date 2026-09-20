// Client · Personal Records. The full PR board (the dashboard shows only the top
// three) — every lift's best estimated 1RM, sorted, with the set that set it.
// Read-only from the workout log via personalRecords().
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: the heaviest lift is the
// screen's one hero figure, the stack of bordered cards became hairline rows,
// and the est-1RM column reads as ink rather than accent.
import { useCallback } from 'react';
import { trainIntent } from '../../src/lib/trainIntent';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useSettings } from '../../src/ui/settings';
import { est1RMIn, liftLabel, convertedNote } from '../../src/lib/units';
import { personalRecords } from '../../src/lib/streaks';
import { repRecords, bodyweightSetLabel } from '../../src/lib/bodyweightSets';
import { bestSetLabel } from '../../src/lib/bestSet';
// The heaviest load actually touched on a movement, which this board has never
// shown. `exerciseIndex` already computes it as `topLoadKg`, is tested for it —
// including the belted pull-up, where the heaviest thing lifted is the body
// plus the belt and not the 20 kg on it — and is what the panel at the foot of
// app/(client)/history.tsx draws. Nothing new is computed here.
import { exerciseIndex } from '../../src/lib/exerciseHistory';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { holdRecords, holdLabel, timedSetLabel } from '../../src/lib/timedSets';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { Section, SectionHead, PageHead, Ghost, Notice, Cta, fig, KpiRow, IconPlate, Expandable } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value, font, radius, elevation } from '../../src/theme/scale';
import { useMovementName } from '../../src/ui/catalogueTranslations';

/**
 * The ranking, drawn: this record beside the best on the same board.
 *
 * A board is a ranked list, and the rank was a grey numeral — the bar is how
 * far down the list a row really is, which "3" does not say (third by a
 * kilogram and third by forty look the same). It compares rows of ONE board
 * with each other and with nothing else: an estimated max is never drawn
 * against a hold. Decoration inside a row that already speaks its own
 * sentence, so it is hidden from a screen reader; `null` draws the track alone.
 */
function RankBar({ share, tone }: { share: number | null; tone: 'blue' | 'orange' | 'purple' }) {
 const t = useTheme();
 const pct = share != null && Number.isFinite(share) ? Math.max(0, Math.min(100, Math.round(share * 100))) : null;
 return (
  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
   style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, marginTop: 6, overflow: 'hidden' }}>
   {pct != null ? <View style={{ height: 6, borderRadius: 3, width: `${pct}%`, backgroundColor: t.data[tone] }} /> : null}
  </View>
 );
}

export default function Records() {
 const t = useTheme();
 const router = useRouter();
 const { log, status: logStatus, reload } = useWorkoutLog();
 // A failed read used to strand this screen for the whole session: the only
 // way to ask again was the Try Again button inside the failure notice, and
 // there is no such button on a screen that merely went stale. Pull to refresh
 // is the gesture people already try — see src/ui/pullToRefresh.tsx.
 //
 // It asked for the LOG alone. Every bodyweight record on this board is priced
 // from `weightSeries` — the scan history, a second read with its own way of
 // failing — so a member whose profile read had failed could pull all day and
 // watch their pull-ups stay off the board. Both reads now.
 const cd = useClientData();
 const pull = usePullToRefresh(useCallback(() => { reload(); cd.reload(); }, [reload, cd.reload]));

 const wu = useSettings().weightUnit;
 const note = convertedNote(wu);
 // The member's own weight over time, which is what lets a pull-up onto this
 // board at all. A bodyweight set is priced at what they weighed ON OR BEFORE
 // the day they did it (src/lib/bodyweightSets.ts) — never at today's figure
 // carried backwards, which would redraw last spring's records around a body
 // that did not exist then. Empty when nobody has ever been scanned or typed a
 // weight, and then a bodyweight set has no load and belongs on the reps board
 // below rather than being given an invented body here.
 // ── and whether that read answered ─────────────────────────────────────
 //
 // A failed scans read leaves `weightSeries` EMPTY, which is indistinguishable
 // from never having been weighed — so every pull-up and dip falls off the
 // estimated-1RM board and the sentence at the bottom of this screen tells a
 // member with two years of weigh-ins to go and start recording their weight.
 // `scansStatus` is the difference and this screen never asked it.
 const { weightSeries } = cd;
 const bodyKnown = isWhole(cd.scansStatus);
 // Ranked in the kilograms the board is stored in, and only then read out. The
 // order would come out the same either way today, but an estimate rounded to
 // the whole pound can tie two lifts that are a kilogram apart, and a board
 // sorted on the rounded figure would then order those two arbitrarily.
 const prs = [...personalRecords(log, weightSeries)].sort((a, b) => b.est1RM - a.est1RM);
 const top = prs[0];
 // Movements the member does at their own bodyweight, ranked by reps. Shown
 // whether or not their weight is known: a pull-up board built from "most reps
 // in a set" needs nothing the log does not already hold, and for a member who
 // has never been weighed it is the ONLY honest record of their calisthenics —
 // which for months read back to them as no training at all.
 const reps = repRecords(log);
 // A movement whose best set is already the hero of the board above is not
 // repeated down here as a lesser record of itself.
 const repsOnly = reps.filter((r) => !prs.some((p) => p.exercise === r.exercise && p.bodyweight));
 // The third board. `holdRecords` has existed, ranked and tie-broken, with its
 // only importer its own test — the app asks for holds, stores them properly,
 // and refuses (correctly) to count them as tonnage or as an estimated max.
 // Having taken them off every board they do not belong on, it never put them
 // on the one they do: a member whose plank has gone from forty seconds to
 // three minutes had no screen anywhere that said so, and their timed work read
 // back as work that produced no record of any kind.
 const holds = holdRecords(log);
 const nothing = prs.length === 0 && repsOnly.length === 0 && holds.length === 0;

 /* ── the record this board has never shown ────────────────────────────────
  *
  * Every row here ranks by ESTIMATED one-rep max, and `PR.weight` is the load
  * of the set that produced the best estimate — not the heaviest load on the
  * movement. Those are two different records and they routinely disagree: a
  * member who has benched 100 × 1 and 90 × 8 estimates highest off the 90, so
  * the row reads "Best set 90 kg × 8" and the screen titled Personal Records
  * never says 100 anywhere. Strong and Hevy both keep the two side by side and
  * this app already computes ours — `topLoadKg` in src/lib/exerciseHistory.ts,
  * drawn by the exercise panel at the foot of app/(client)/history.tsx, and
  * nowhere on the board people actually open to look up a record.
  *
  * Keyed on `exerciseSlug` because that is what `exerciseIndex` groups by;
  * `PR.exercise` is the stored English name and slugging it is the same
  * mapping the index made on the way in. */
 const topLoadBySlug = new Map<string, number | null>();
 for (const e of exerciseIndex(log, weightSeries, logStatus)) topLoadBySlug.set(e.slug, e.topLoadKg);
 /* Movements with any BODYWEIGHT set in the log. Their heaviest "load" is the
  * member's own weigh-in plus whatever was belted on, which is a real load and
  * the right thing to estimate from — and is not a thing that was ever on a
  * bar. src/lib/bestSet.ts exists because this screen printed one as if it
  * were, in the hero, and the same figure must not come back in through a new
  * line three rows down. So a movement that has ever been logged at bodyweight
  * gets no heaviest-load line at all, rather than one that is sometimes a bar
  * and sometimes a body. */
 const bodyPriced = new Set<string>();
 for (const e of log) if (e.bw?.some(Boolean)) bodyPriced.add(exerciseSlug(e.exercise));
 /**
  * The heaviest load on this movement, in the reader's unit — null whenever
  * there is nothing to add to the row.
  *
  * Compared as the STRINGS that will be drawn, not as kilograms. The board is
  * stored in kg and read out rounded, so a 100.4 kg top set over a 100.0 kg
  * record is two different numbers and one printed figure, and "Best set
  * 100 kg × 8 / Heaviest 100 kg" is a line that says nothing twice.
  */
 const heaviestLine = (pr: { exercise: string; weight: number; bodyweight?: boolean }): string | null => {
  if (pr.bodyweight) return null;
  const slug = exerciseSlug(pr.exercise);
  if (!slug || bodyPriced.has(slug)) return null;
  const topKg = topLoadBySlug.get(slug);
  if (topKg == null || !(topKg > pr.weight)) return null;
  const shown = liftLabel(topKg, wu);
  const already = liftLabel(pr.weight, wu);
  return shown != null && shown !== already ? shown : null;
 };
 const dstr = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
 /**
  * What a row SAYS, as one sentence.
  *
  * Built rather than interpolated, because `fig()` renders an unknown figure as
  * an em dash and a dash inside a spoken sentence is a word that has gone
  * missing — "estimated one rep max, dash, kilograms" is not a thing to read
  * out to somebody. Every clause here is withheld when its figure is not there,
  * which is the same rule the visible figures on this screen already follow.
  */
 /** The record's load in the reader's own unit, or null when it could not be
  *  read.
  *
  *  It took a `voice: 'screen' | 'spoken'` and appended the unit on the spoken
  *  arm, on the reading that the screen has its own "est 1RM · kg" caption and
  *  a sentence read aloud does not. Both true, and both already handled:
  *  `liftLabel` returns "104 kg", not "104" (src/lib/units.ts), so the spoken
  *  arm was appending a SECOND unit and VoiceOver announced "104 kg kg by 12
  *  reps". With the unit where it always was, the two voices want the same
  *  string and there is no arm left to choose between. */
 const setLoad = (pr: { weight: number }): string | null => liftLabel(pr.weight, wu);
 /** What was hung, belted or held on top, in the reader's unit — null when
  *  nothing was, or when the figure itself could not be read. Null rather than
  *  a dash: "at bodyweight +— kg" is worse than "at bodyweight". */
 const setAdded = (pr: { addedKg?: number }): string | null => {
  if (!pr.addedKg) return null;
  // The unit comes from `liftLabel` and is not added again. This one string
  // feeds the hero, every row and the spoken label, so the doubled unit read
  // "Best set 12 reps at bodyweight +20 kg kg" in three places at once for
  // anyone with a belted pull-up, a weighted dip or a loaded plank.
  return liftLabel(pr.addedKg, wu);
 };
 // A record is stored under its ENGLISH name — that is the identity, and it is
 // what `key` and every lookup on this screen still use. `movement()` is what
 // the reader sees and hears: a German member reading "Kniebeuge" in the
 // library was told their own record for it was for "Barbell Back Squat".
 const { textOf: movement } = useMovementName();
 const prSpoken = (pr: ReturnType<typeof personalRecords>[number], rank: number): string => {
  const best = bestSetLabel(pr, setLoad(pr), setAdded(pr), 'spoken');
  const one = est1RMIn(pr.est1RM, wu);
  const parts = [`${rank}. ${movement(pr.exercise)}`];
  if (one != null) parts.push(`estimated one rep max ${one} ${wu}`);
  parts.push(`best set ${best}`, `on ${dstr(pr.at)}`);
  // Spoken where it is drawn, and only where it is drawn. A row whose heaviest
  // load IS the record's load has no extra clause, so VoiceOver reads exactly
  // what the eye sees.
  const heavy = heaviestLine(pr);
  if (heavy) parts.push(`${logStatus === 'partial' ? 'heaviest read' : 'heaviest logged'} ${heavy}`);
  return parts.join(', ');
 };
 /** The same, for the hold board. The seconds are the record; a load is what
  *  was held on top and is never presented as the whole of it. */
 const holdSpoken = (h: { exercise: string; secs: number; loadKg: number; bodyweight: boolean; at: string }): string => {
  const added = h.loadKg > 0 ? liftLabel(h.loadKg, wu) : null;
  return `${movement(h.exercise)}, ${timedSetLabel(h.secs, added, h.bodyweight)}, on ${dstr(h.at)}`;
 };
 /** The same, for the reps board. Reps are always known there, so the only
  *  withholdable clause is the belt. */
 const repSpoken = (r: { exercise: string; reps: number; addedKg: number; at: string }): string => {
  const added = r.addedKg ? liftLabel(r.addedKg, wu) : null;
  return `${movement(r.exercise)}, ${bodyweightSetLabel(r.reps, r.addedKg, added)}, on ${dstr(r.at)}`;
 };
 // ── the three boards, counted ────────────────────────────────────────
 // Each tile is the length of one board below, in that board's colour —
 // strength blue, bodyweight orange, holds purple, the same three the bars
 // under the rows use. A count over a truncated read is the size of what
 // came back, so it is a dash that says why where its unit would be.
 // Only a read that finished whole can count a board: 'partial' is the newest
 // part of it, and 'error' is whatever this phone was already holding.
 const counted = logStatus === 'ready';
 const tiles = (
 <KpiRow tiles items={[
  { label: 'Lifts on the Board', tone: 'blue', value: !counted ? fig(null) : fig(prs.length), unit: counted ? undefined : 'not all read' },
  { label: 'Bodyweight Bests', tone: 'orange', value: !counted ? fig(null) : fig(repsOnly.length), unit: counted ? undefined : 'not all read' },
  { label: 'Longest Holds', tone: 'purple', value: !counted ? fig(null) : fig(holds.length), unit: counted ? undefined : 'not all read' },
 ]} />
 );
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  {/* The board's pushed-page head; what a record IS here is the one quiet
      line under the title. */}
  <PageHead title="Personal Records" subtitle="Best estimated 1-rep max per lift" />

  {/* An empty PR board has three causes and only one of them is "you have not
      set a PR yet". Saying that to a lifter whose log simply did not load
      reports their whole board as gone, on the screen whose entire job is to
      keep a record of it. */}
  {/* Shown whenever the read failed, not only when the board came back empty.
      `useWorkoutLog` does NOT clear `log` on a failed refresh, so a reload that
      failed over rows already in memory rendered the whole board — hero, count,
      ranked list — with no banner and no retry anywhere on the screen. A stale
      PR board is the one thing this screen must never present as current. */}
  {/* The OTHER read this board depends on. Every bodyweight record here is
      priced from the scan history, so a failed scans read silently takes every
      pull-up and dip off the estimated-max board — and says nothing, because
      every notice on this screen was gated on the training log alone. */}
  {!bodyKnown && cd.scansStatus !== 'loading' ? (<>
   <Section>
    <Notice tone={t.warn} kicker="Records" title="We Couldn’t Read Your Weight History"
     note={cd.scansStatus === 'partial'
      ? 'You have more scans on record than this screen can read at once, so a bodyweight set may be priced against an older weigh-in than the one that applied. Your barbell records are unaffected.'
      : 'Pull-ups, dips and press-ups are priced against what you weighed on the day, and that history did not load — so they are not on the estimated-max board below. They are not gone, and nothing has been reset.'}>
     <View style={{ marginTop: sp.lg }}>
      <Cta label="Try Again" wide onPress={() => cd.reload()} />
     </View>
    </Notice>
   </Section>
  </>) : null}

  {logStatus === 'error' ? (<>
   <Section>
    <Notice tone={t.warn} kicker="Records" title="We Couldn’t Read Your Training Log"
     note={prs.length === 0
      ? "Your records are safe — this screen can't see them right now. Nothing has been reset."
      : "The board below is what this phone had before the read failed. It is real, but it may not be current — a record set since is not on it. Nothing has been reset."}>
     <View style={{ marginTop: sp.lg }}>
      <Cta label="Try Again" wide onPress={reload} />
     </View>
    </Notice>
   </Section>
  </>) : null}

  {/* `nothing` rather than `prs.length === 0`. A member who trains on rings and
      a bar has no weighted set anywhere in their log, and this screen used to
      tell them, in as many words, that they had no records — over a board that
      had every pull-up they had ever done and could not read one of them. The
      empty state is now reached only when BOTH boards are empty. */}
  {nothing && logStatus === 'error' ? null
   : nothing && logStatus === 'loading' ? (<>
   <Section>
    <Text style={{ ...ty.body, color: t.ink3 }}>Loading your records…</Text>
   </Section>
  </>) : nothing ? (<>
   <Section>
    {/* 'partial' had no arm of its own and fell into "No Records Yet". A
        truncated read holds the newest thousand sessions, and a lifter whose
        weighted sets are all older than that was told their whole board is
        empty. */}
    <SectionHead title={logStatus === 'partial' ? 'No Records in This Read' : 'No Records Yet'} />
    <Text style={{ ...ty.body, color: t.ink2 }}>
     {logStatus === 'partial'
      ? 'You have logged more sessions than this screen can read in one go, and there were no sets among the ones it read that could set a record. This is not a statement that you have no records.'
      : 'No records yet — log a strength workout to set your first PR. Pull-ups, dips and press-ups count: tick Bodyweight when you log the set. So do planks and hangs: log them as a hold and your longest one gets a board of its own.'}
    </Text>
    {/* The sentence above names the one thing that fills this screen and, until
        now, left the member to find it. The three `Cta`s elsewhere in this file
        are all "Try Again" for a read that failed — nothing here answered the
        empty case, which is the case every new member meets first.
        Not under 'partial': that read found sessions and could not reach the
        old ones, so sending somebody to log another would be answering the
        wrong question. */}
    {logStatus !== 'partial' ? (
     <View style={{ marginTop: sp.lg }}>
      <Cta label="Log a Workout" wide onPress={() => router.push(trainIntent('/(client)/workouts') as any)} />
     </View>
    ) : null}
   </Section>
  </>) : (<>
   {/* An empty board has three causes and the FULL board has a fourth. Every
       figure here is a best-ever: "Heaviest Lift", "best set", the ranking
       itself. A truncated read (src/lib/rowCap.ts) holds the newest thousand
       sessions and nothing behind them, so a squat PR set two years ago is
       simply not in the set — and the board would print the best of what
       remained under the words "Personal Records" and rank it first. Said
       before the hero, because the hero is the figure it qualifies. */}
   {logStatus === 'partial' ? (<>
    <Section>
     <Notice tone={t.warn} kicker="Records" title="Read from Your Recent Sessions Only"
      note="You have logged more sessions than this screen can read in one go, so this board is your best from the most recent ones. A record set before that is still on your log and is not on this list — nothing has been reset." >
      <View style={{ marginTop: sp.lg }}>
       <Cta label="Try Again" wide onPress={reload} />
      </View>
     </Notice>
    </Section>
   </>) : null}

   {/* Under the hero when there is one; first when the only boards are
       bodyweight and holds, which have no estimated max to lead with. */}
   {!top ? tiles : null}

   {/* ── the hero: the heaviest thing you have lifted ────────────────── */}
   {top ? (<>
   {/* The board's figure card where the Hero was. The sentence under the
       figure goes through `bestSetLabel`, like the row below and the spoken
       label above. It used to build the phrase by hand and skipped
       `PR.bodyweight` doing it, so an 84 kg member's weighted pull-up was
       announced here as "best set 104 kg × 12" — a load that is partly their
       own weigh-in, presented as a bar — while the row eleven lines down read
       "12 reps at bodyweight +20 kg" about the very same set. This is the
       figure people quote. See src/lib/bestSet.ts. */}
   <View style={{ backgroundColor: t.brandSoft, borderRadius: radius.xl, padding: 18, marginTop: 14, ...elevation.card }}>
     <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.xs }}>
       <IconPlate icon="trophy" tone="amber" size={36} />
       <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink, flex: 1 }}>{logStatus === 'partial' ? 'Heaviest Read' : 'Heaviest Lift'}</Text>
     </View>
     {/* Label, figure, unit and sentence are one fact, and one stop. */}
     <View accessible accessibilityLabel={[logStatus === 'partial' ? 'Heaviest Read' : 'Heaviest Lift', [fig(est1RMIn(top.est1RM, wu)), `${wu} est. 1RM`].filter(Boolean).join(' '), `${top.exercise} · best set ${bestSetLabel(top, setLoad(top), setAdded(top))} on ${dstr(top.at)}`].filter(Boolean).join(', ')}>
       <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
         {/* Shrunk to fit and never wrapped: a figure broken across two lines
             is a figure read wrong. */}
         <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.35}
           style={{ ...ty.hero, ...numeric, color: t.ink, flexShrink: 1 }}>{fig(est1RMIn(top.est1RM, wu))}</Text>
         <Text numberOfLines={1} style={{ ...ty.head, color: t.ink2, marginStart: 6, letterSpacing: 0, flexShrink: 0 }}>{`${wu} est. 1RM`}</Text>
       </View>
       <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{`${top.exercise} · best set ${bestSetLabel(top, setLoad(top), setAdded(top))} on ${dstr(top.at)}`}</Text>
     </View>
     {/* The board is kept in kilograms and read out in pounds, so the figures
         here and the ones on a coach's console are the same lifts said twice
         rather than a discrepancy. Absent for a metric reader, who is being
         shown the record itself. */}
     {note ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{note}</Text> : null}
   </View>
   {tiles}

   <Section>
    {/* The count goes on a truncated read for the same reason the totals go
        on Consistency: it is the size of what came back, not of the board. */}
    <SectionHead title="All Records" note={logStatus === 'partial' ? undefined : `${prs.length} lift${prs.length === 1 ? '' : 's'}`} />
    {prs.map((pr, i) => (
     <View key={pr.exercise} accessible accessibilityRole="text"
      accessibilityLabel={prSpoken(pr, i + 1)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 18 }}>{i + 1}</Text>
      <View style={{ flex: 1 }}>
       <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }}>{movement(pr.exercise)}</Text>
       <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>Best set {bestSetLabel(pr, setLoad(pr), setAdded(pr))} · {dstr(pr.at)}</Text>
       {/* Only where it differs from the set above — see `heaviestLine`. The
           word changes with the read: "logged" is a claim about the movement's
           whole record and a truncated read cannot make one. */}
       {(() => { const heavy = heaviestLine(pr); return heavy ? (
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
         {logStatus === 'partial' ? 'Heaviest read' : 'Heaviest logged'} {heavy}
        </Text>
       ) : null; })()}
       <RankBar share={top.est1RM > 0 ? pr.est1RM / top.est1RM : null} tone="blue" />
      </View>
      <View style={{ alignItems: 'flex-end' }}>
       <Text style={{ ...value(17), color: t.ink }}>{fig(est1RMIn(pr.est1RM, wu))}</Text>
       <Text style={{ ...ty.caption, color: t.ink3 }}>est 1RM · {wu}</Text>
      </View>
     </View>
    ))}
    {/* Why a row can name two loads. Said once, under the board, rather than in
        every row that carries the second line. */}
    <View style={{ marginTop: sp.md }}>
    <Expandable title="How This Is Ranked">
    <Text style={{ ...ty.caption, color: t.ink3 }}>
     Ranked by estimated one-rep max, which is worked out from the reps you logged and is not a max you
     tested. Where the heaviest load you have put on a lift came off a different set, that set is named
     underneath it — the two are different records and this board is about the first.
    </Text>
    </Expandable>
    </View>
   </Section>
   </>) : null}

   {/* ── the second board: reps at your own bodyweight ────────────────── */}
   {/* A board of its own rather than rows on the one above, because an
       estimated 1RM needs a load and a bodyweight set has one only if the
       member has been weighed. The choice was between inventing a body and
       leaving calisthenics off the screen entirely, and this is neither: reps
       at bodyweight is the record a gymnast actually keeps, and it needs
       nothing the log does not already hold. */}
   {repsOnly.length ? (<>
    <Section>
     <SectionHead title="Bodyweight Bests" note={logStatus === 'partial' ? undefined : `${repsOnly.length} movement${repsOnly.length === 1 ? '' : 's'}`} />
     {repsOnly.map((r, i) => (
      <View key={r.exercise} accessible accessibilityRole="text"
       accessibilityLabel={repSpoken(r)}
       style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }}>{movement(r.exercise)}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
         {/* delta-ok: the plus is not a movement, it is the weight hung off a belt. Nothing here changed from anything. */}
         {r.addedKg > 0 ? `+${fig(liftLabel(r.addedKg, wu))} added · ` : 'At bodyweight · '}{dstr(r.at)}
        </Text>
        <RankBar share={repsOnly[0].reps > 0 ? r.reps / Math.max(...repsOnly.map((x) => x.reps)) : null} tone="orange" />
       </View>
       <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ ...value(17), color: t.ink }}>{r.reps}</Text>
        <Text style={{ ...ty.caption, color: t.ink3 }}>reps</Text>
       </View>
      </View>
     ))}
     <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
      {bodyKnown
       ? 'Ranked by reps in a single set. Record your weight on Body and these join the board above with an estimated max too.'
       : cd.scansStatus === 'loading'
        ? 'Ranked by reps in a single set. Still reading your weight history — these join the board above with an estimated max once it lands.'
        : 'Ranked by reps in a single set. Your weight history could not be read, so these cannot be priced against your own bodyweight just now — that is this screen, not a gap in your record. Pull down to try again.'}
     </Text>
    </Section>
   </>) : null}

   {/* ── the third board: how long you held it ─────────────────────────── */}
   {/* Seconds, not reps and not kilograms. A hold's record is its duration —
       everything else in this app deliberately refuses to price one, and this
       is the screen where it is finally stated in its own units. Load breaks a
       tie, so a 60-second plank with a plate is never shown as the same
       achievement as a bare 60. */}
   {holds.length ? (<>
    <Section>
     <SectionHead title="Longest Holds" note={logStatus === 'partial' ? undefined : `${holds.length} movement${holds.length === 1 ? '' : 's'}`} />
     {holds.map((h, i) => (
      <View key={h.exercise} accessible accessibilityRole="text"
       accessibilityLabel={holdSpoken(h)}
       style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }}>{movement(h.exercise)}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
         {/* delta-ok: the plus is a plate on a belt, not a change in anything. */}
         {h.loadKg > 0
          ? `${h.bodyweight ? 'At bodyweight +' : '+'}${fig(liftLabel(h.loadKg, wu))} · `
          : h.bodyweight ? 'At bodyweight · ' : ''}{dstr(h.at)}
        </Text>
        <RankBar share={h.secs / Math.max(1, ...holds.map((x) => x.secs))} tone="purple" />
       </View>
       <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ ...value(17), color: t.ink }}>{holdLabel(h.secs)}</Text>
        <Text style={{ ...ty.caption, color: t.ink3 }}>held</Text>
       </View>
      </View>
     ))}
     <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
      Ranked by how long a single set was held. A hold is never counted as reps or as tonnage, so it does not appear on the boards above.
     </Text>
    </Section>
   </>) : null}
  </>)}
 </ScrollView>
 </SafeAreaView>
 );
}
