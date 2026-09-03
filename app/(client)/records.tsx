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
import { holdRecords, holdLabel, timedSetLabel } from '../../src/lib/timedSets';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { Rule, Section, SectionHead, Hero, Ghost, Notice, Cta, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';

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
 const prSpoken = (pr: ReturnType<typeof personalRecords>[number], rank: number): string => {
  const load = liftLabel(pr.weight, wu);
  const added = pr.addedKg ? liftLabel(pr.addedKg, wu) : null;
  const best = pr.bodyweight
   ? bodyweightSetLabel(pr.reps, pr.addedKg ?? 0, added != null ? `${added} ${wu}` : null)
   : (load != null ? `${load} ${wu} by ${pr.reps} reps` : `${pr.reps} reps`);
  const one = est1RMIn(pr.est1RM, wu);
  const parts = [`${rank}. ${pr.exercise}`];
  if (one != null) parts.push(`estimated one rep max ${one} ${wu}`);
  parts.push(`best set ${best}`, `on ${dstr(pr.at)}`);
  return parts.join(', ');
 };
 /** The same, for the hold board. The seconds are the record; a load is what
  *  was held on top and is never presented as the whole of it. */
 const holdSpoken = (h: { exercise: string; secs: number; loadKg: number; bodyweight: boolean; at: string }): string => {
  const added = h.loadKg > 0 ? liftLabel(h.loadKg, wu) : null;
  return `${h.exercise}, ${timedSetLabel(h.secs, added != null ? `${added} ${wu}` : null, h.bodyweight)}, on ${dstr(h.at)}`;
 };
 /** The same, for the reps board. Reps are always known there, so the only
  *  withholdable clause is the belt. */
 const repSpoken = (r: { exercise: string; reps: number; addedKg: number; at: string }): string => {
  const added = r.addedKg ? liftLabel(r.addedKg, wu) : null;
  return `${r.exercise}, ${bodyweightSetLabel(r.reps, r.addedKg, added != null ? `${added} ${wu}` : null)}, on ${dstr(r.at)}`;
 };
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Best estimated 1-rep max per lift</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Personal Records</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

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
   <Rule />
   <Section>
    <Notice tone={t.warn} kicker="Records" title="We couldn’t read your weight history"
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
   <Rule />
   <Section>
    <Notice tone={t.warn} kicker="Records" title="We couldn’t read your training log"
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
   <Rule />
   <Section>
    <Text style={{ ...ty.body, color: t.ink3 }}>Loading your records…</Text>
   </Section>
  </>) : nothing ? (<>
   <Rule />
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
    <Rule />
    <Section>
     <Notice tone={t.warn} kicker="Records" title="Read from your recent sessions only"
      note="You have logged more sessions than this screen can read in one go, so this board is your best from the most recent ones. A record set before that is still on your log and is not on this list — nothing has been reset." >
      <View style={{ marginTop: sp.lg }}>
       <Cta label="Try Again" wide onPress={reload} />
      </View>
     </Notice>
    </Section>
   </>) : null}

   {/* ── the hero: the heaviest thing you have lifted ────────────────── */}
   {top ? (<>
   <Hero
    label={logStatus === 'partial' ? 'Heaviest Read' : 'Heaviest Lift'}
    figure={fig(est1RMIn(top.est1RM, wu))}
    unit={`${wu} est. 1RM`}
    note={`${top.exercise} · best set ${fig(liftLabel(top.weight, wu))} × ${top.reps} on ${dstr(top.at)}`}
   />
   {/* The board is kept in kilograms and read out in pounds, so the figures
       here and the ones on a coach's console are the same lifts said twice
       rather than a discrepancy. Absent for a metric reader, who is being
       shown the record itself. */}
   {note ? <Text style={{ ...ty.caption, color: t.ink3 }}>{note}</Text> : null}

   <Rule />

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
       <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{pr.exercise}</Text>
       <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>Best set {pr.bodyweight ? bodyweightSetLabel(pr.reps, pr.addedKg ?? 0, pr.addedKg ? `${fig(liftLabel(pr.addedKg, wu))} ${wu}` : null) : `${fig(liftLabel(pr.weight, wu))} × ${pr.reps}`} · {dstr(pr.at)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
       <Text style={{ ...value(17), color: t.ink }}>{fig(est1RMIn(pr.est1RM, wu))}</Text>
       <Text style={{ ...ty.caption, color: t.ink3 }}>est 1RM · {wu}</Text>
      </View>
     </View>
    ))}
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
    <Rule />
    <Section>
     <SectionHead title="Bodyweight Bests" note={logStatus === 'partial' ? undefined : `${repsOnly.length} movement${repsOnly.length === 1 ? '' : 's'}`} />
     {repsOnly.map((r, i) => (
      <View key={r.exercise} accessible accessibilityRole="text"
       accessibilityLabel={repSpoken(r)}
       style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{r.exercise}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
         {/* delta-ok: the plus is not a movement, it is the weight hung off a belt. Nothing here changed from anything. */}
         {r.addedKg > 0 ? `+${fig(liftLabel(r.addedKg, wu))} ${wu} added · ` : 'At bodyweight · '}{dstr(r.at)}
        </Text>
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
    <Rule />
    <Section>
     <SectionHead title="Longest Holds" note={logStatus === 'partial' ? undefined : `${holds.length} movement${holds.length === 1 ? '' : 's'}`} />
     {holds.map((h, i) => (
      <View key={h.exercise} accessible accessibilityRole="text"
       accessibilityLabel={holdSpoken(h)}
       style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{h.exercise}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
         {/* delta-ok: the plus is a plate on a belt, not a change in anything. */}
         {h.loadKg > 0
          ? `${h.bodyweight ? 'At bodyweight +' : '+'}${fig(liftLabel(h.loadKg, wu))} ${wu} · `
          : h.bodyweight ? 'At bodyweight · ' : ''}{dstr(h.at)}
        </Text>
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
