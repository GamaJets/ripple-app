// Client · Build a Workout — the member names the target and the app writes the
// session.
//
// ── The request ───────────────────────────────────────────────────────────
//
// Passed on by the owner from a member: "they want the ability to say i want to
// train for example 'triceps' and the app builds a workout for triceps for them
// to follow", and "they should be able to select what muscle groups they want to
// work out and the app builds the workout program for them".
//
// Two levels, and this screen is where they are the SAME control. `triceps` is
// not one of the catalogue's 11 `muscle_group` values — it is one of the 27
// names in `primary_muscles` — so a member who only ever met the group picker
// would have to know that Triceps lives under Arms, and then accept an Arms day
// that is mostly curls. So each group's row carries the group chip AND the
// muscles filed under it, side by side: Arms, then Triceps, Biceps, Forearms.
// Tap the group for a group day, tap the muscle for that muscle. The difference
// between the two is real and is what src/lib/targetedWorkout.ts keeps apart.
//
// ── Why this is its own screen and not a section of Programs ─────────────
//
// app/(client)/programs.tsx lists `workout_templates` — fifteen plans somebody
// else wrote. This reads `public.exercises` and composes a new one on the
// phone. Different source, different read, different failure modes; the one
// thing they share is the shape of the page, which is deliberate.
//
// ── What it must never do ────────────────────────────────────────────────
//
// Biceps has 39 movements in the catalogue and not one of them can be done with
// no equipment. A member who picks Biceps and No equipment must be TOLD that,
// by name, with the count — never handed triceps work because it is also arms,
// and never handed four movements dressed as a whole answer. The sentence comes
// from `targetedCoverageNote` and is printed above the week it describes. Same
// rule the no-equipment program follows; see src/lib/noKitProgram.ts.
//
// The four read statuses are four different sentences, as everywhere else: a
// failed catalogue read is not an empty catalogue, and the `exercises` policy
// is `to authenticated`, so a signed-out session is handed zero rows and no
// error. "There are no triceps exercises" must never be what a member is told
// about a read that did not happen.
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useBackFromHub } from '../../src/ui/backTo';
import {
  Cta, Flag, Ghost, Notice, PageHead, PartialRead, Rule, Section, SectionHead, Segmented, TonedChip,
} from '../../src/ui/kit';
import { useClientData } from '../../src/ui/clientData';
// The injury check and the swap, both of them out of src/lib/builtWorkout.ts
// rather than written again here. `checkInjury` will not answer "nothing is
// flagged" without being handed the status the disclosure arrived under, which
// is the one thing this screen must not get wrong.
import { checkInjury, nextAlternative } from '../../src/lib/builtWorkout';
import { groupTone } from '../../src/ui/groupTone';
import { MusclePicker } from '../../src/ui/MusclePicker';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { grown, hairline, layout, sp, type as ty, font } from '../../src/theme/scale';
import { WEEK_DAYS, WEEK_DAY_NAMES, weekIndexOf } from '../../src/lib/weekStart';
import { useToday } from '../../src/ui/today';
import { localDate } from '../../src/lib/localDate';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { FORWARD_CHAR } from '../../src/ui/direction';
import { NO_KIT } from '../../src/lib/equipmentFacet';
import {
  targetedProgram, targetedCoverageNote, type Target,
} from '../../src/lib/targetedWorkout';

const parse = (k: string): Target =>
  ({ kind: k.slice(0, k.indexOf(':')) as Target['kind'], name: k.slice(k.indexOf(':') + 1) });

export default function BuildWorkout() {
  const t = useTheme();
  const router = useRouter();
  // Rows here open the exercise detail, so Back must skip its own details.
  // See src/lib/backTo.ts.
  const goBack = useBackFromHub('(client)');
  const cat = useExerciseCatalogue();
  const pull = usePullToRefresh(useCallback(() => { cat.reload(); }, [cat]));

  const [chosen, setChosen] = useState<string[]>([]);
  const [kit, setKit] = useState<'any' | 'none'>('any');
  /** The targets the built workout was built FROM, or null before the member
   *  has asked for one. Held separately from `chosen` on purpose: changing a
   *  chip must not silently rewrite the workout already on screen underneath
   *  it, which is a page that changes while it is being read. */
  /** One session for everything picked, or a day each. Only asked once there
   *  are two targets; with one, the two answers are the same workout. */
  const [split, setSplit] = useState<'together' | 'split'>('together');
  /** The weekday the workout is for, as an index into the member's own week,
   *  or null for "today" — which is the default, because somebody standing in
   *  the gym is building the session they are about to do. Held as null rather
   *  than as today's index so a screen left open over midnight still means
   *  today; `useToday` below is what makes that re-render. */
  const [startDay, setStartDay] = useState<number | null>(null);
  const [built, setBuilt] = useState<
    { targets: string[]; noKit: boolean; together: boolean; startDay: number } | null>(null);
  /** One movement swapped for another, by the generated row's own key. Cleared
   *  whenever a new workout is built, because a key from the last build names a
   *  row that is no longer on screen. */
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const cd = useClientData();

  const plan = useMemo(() => {
    if (!built || !built.targets.length) return null;
    // The disclosure only orders the pool when it was actually READ. Under a
    // failed or half read `cd.injuries` is `[]`, which would order nothing and
    // read as a workout built around the member's injuries; the banner in
    // `result()` says the check could not run instead.
    const flags = isWhole(cd.profileStatus)
      ? (name: string, group: string) => checkInjury(name, group, cd.injuries, cd.profileStatus).state === 'flagged'
      : undefined;
    return targetedProgram(cat.rows, built.targets.map(parse), {
      noKit: built.noKit, together: built.together, startDay: built.startDay, flags,
    });
  }, [built, cat.rows, cd.injuries, cd.profileStatus]);

  /** The reader's own language for a movement, and the English identity to
   *  navigate by. The generator works in English names because those are the
   *  catalogue's identity; only the LINE is translated. */
  const byName = useMemo(() => {
    const m = new Map<string, CatalogueRow>();
    for (const r of cat.rows) m.set(r.name, r);
    return m;
  }, [cat.rows]);

  /** A day each is only a choice with something to split; one target is one
   *  session whichever way the control is set. */
  const splitting = split === 'split' && chosen.length > 1;
  /** Today, in the member's own week order. `useToday()` and not a bare clock
   *  read: this screen can sit open past midnight, and `check:frozen-day` is
   *  the gate that says so. */
  const todayDate = localDate(useToday());
  const today = todayDate ? weekIndexOf(todayDate) : 0;
  const day = startDay ?? today;

  const G = layout.gutter;
  const ready = isWhole(cat.status) && !cat.signedOut && cat.rows.length > 0;

  /* ── the picker ──────────────────────────────────────────────────────── */
  const picker = () => (
    <>
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
        Tap the body or pick a muscle group, or a single muscle inside it, and this builds a session
        out of the movements the catalogue actually holds for it. Pick more than one and you choose
        whether they share one session or take a day each.
      </Text>

      <Section>
        <SectionHead title="What Do You Want To Train?"
          note={chosen.length ? `${chosen.length} Picked` : undefined} />

        {/* The body and the chips are one control; the menu, its order and
            why no label appears twice are in src/lib/musclePicker.ts. */}
        <MusclePicker chosen={chosen} onChange={setChosen} />
      </Section>

      <Rule />

      <Section>
        <SectionHead title="Equipment"
          note="What You Have to Train with Today" />
        <Segmented
          options={[
            { key: 'any', label: 'Anything' },
            { key: 'none', label: NO_KIT },
          ] as const}
          value={kit}
          onChange={setKit}
        />
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          {kit === 'none'
            ? 'Only movements the catalogue records as needing nothing at all: no bar, no bands, no bench. Some muscles have none, and you will be told which.'
            : 'Every movement in the catalogue, whatever it is performed on.'}
        </Text>
      </Section>

      {/* ── one session or a day each, and which day ──────────────────────
          A day each was the only answer this screen had, and it is the wrong
          one for the member who trains chest and back on a Tuesday. The split
          only appears once there are two targets to split; the day always
          does, because a one-target workout still lands on a day. */}
      {chosen.length > 1 ? (
        <>
          <Rule />
          <Section>
            <SectionHead title="How To Split It" note="One Session or a Day Each" />
            <Segmented
              options={[
                { key: 'together', label: 'One Session' },
                { key: 'split', label: 'A Day Each' },
              ] as const}
              value={split}
              onChange={setSplit}
            />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {split === 'together'
                ? 'Everything you picked in one session, taken in turns from each so no muscle is left to the end.'
                : 'A day for each thing you picked, spread across the week from the day you start on.'}
            </Text>
          </Section>
        </>
      ) : null}

      <Rule />

      <Section>
        <SectionHead title={splitting ? 'Start On' : 'Train On'}
          note={splitting ? 'The First Day of the Week You Train' : 'The Day This Session Is For'} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {/* Today first, then the week itself. Today is the day most of these
              sessions are for and the member should not have to work out which
              weekday that is; the week still reads Sunday to Saturday behind
              it, and today's own weekday carries the tick too — the two chips
              are one day. */}
          {[{ label: 'Today', at: today }, ...WEEK_DAY_NAMES.map((n, i) => ({ label: n, at: i }))].map(({ label, at }, k) => {
            const name = WEEK_DAY_NAMES[at];
            const i = at;
            return (
            <Pressable
              key={`${label}-${k}`}
              onPress={() => setStartDay(i)}
              accessibilityRole="radio"
              accessibilityState={{ selected: day === i }}
              accessibilityLabel={`${splitting ? 'Start on' : 'Train on'} ${name}${i === today ? ', today' : ''}`}
              hitSlop={hitSlopFor(MIN_TARGET)}
            >
              {day === i ? (
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <TonedChip label={label} icon="check" />
                </View>
              ) : (
                <View style={{
                  minHeight: grown(26), paddingHorizontal: 11, paddingVertical: 3,
                  borderRadius: grown(26) / 2, backgroundColor: t.surface2,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ ...ty.micro, ...font('700'), letterSpacing: 0, color: t.ink2 }}>{label}</Text>
                </View>
              )}
            </Pressable>
            );
          })}
        </View>
      </Section>

      <Section>
        <Cta
          wide
          label="Build My Workout"
          disabled={!ready || chosen.length === 0}
          a11yLabel={chosen.length === 0
            ? 'Build my workout. Pick at least one muscle or muscle group first'
            : `Build a workout for ${chosen.map((k) => parse(k).name).join(', ')}`}
          onPress={() => {
            setSwaps({});
            setBuilt({ targets: chosen, noKit: kit === 'none', together: !splitting, startDay: day });
          }}
        />
      </Section>
    </>
  );

  /* ── what a built workout IS, and therefore what deleting one means ──────
     Nothing on this screen is saved and nothing is assigned. `built` is state
     in this component — the targets the member asked for and the equipment
     answer — and `plan` is recomputed from it. There is no row in any table,
     nothing on a coach's dashboard and nothing on this phone's disk; the
     session exists while the screen is open.

     So "delete" is honest here as a discard and would be dishonest as
     anything more: nothing is being removed from a record, because the record
     was never written. What it does destroy is real all the same — the built
     session and every replacement made in it — so it is confirmed first and
     the confirm says what goes. */
  const discard = () => {
    Alert.alert(
      'Delete This Workout?',
      'The session below goes, along with any movements you replaced in it. It was never saved to your log or sent to your coach, so there is nothing else to remove. Your picks stay on screen and you can build it again.',
      [
        { text: 'Keep It', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { setSwaps({}); setBuilt(null); } },
      ],
    );
  };

  /* ── the workout it built ────────────────────────────────────────────── */
  const result = () => {
    if (!plan) return null;
    const { program, coverage } = plan;
    const note = targetedCoverageNote(coverage);
    /* Whether the disclosure these rows are checked against actually arrived.
       `cd.injuries` is `[]` under a failed read exactly as it is for a member
       who has disclosed nothing, and `injuryFlag` returns null for both — so
       without this the screen draws a checked, clear session for the member it
       knows least about. Same two arms the Train screen draws, in the same
       order, and 'partial' counts as unread there and here. */
    const injLoading = cd.profileStatus === 'loading';
    const injRead = isWhole(cd.profileStatus);
    return (
      <>
        <Rule />
        <Section>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Built From The Catalogue</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>{program.title}</Text>
          {program.focus.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
              {program.focus.map((f) => <TonedChip key={f} label={f} tone={groupTone(f)} />)}
            </View>
          ) : null}
          {built?.noKit ? (
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
              Every movement here needs no equipment at all: no bar, no bands, no bench.
            </Text>
          ) : null}

          {/* The targets it could not serve, named, with the reason. Never
              rolled up into "some targets could not be covered", and never
              quietly replaced with a muscle nobody asked for. */}
          {note ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{note}</Flag> : null}

          {/* Above the movements, because it is a fact about every one of
              them. Three answers and not two: a read still in flight, a read
              that failed, and a read that landed — and only the third one
              lets a missing caution below mean anything at all. */}
          {injLoading ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.md }}>
              Reading what you have disclosed. Nothing below has been checked against your injuries yet.
            </Flag>
          ) : !injRead ? (
            <View style={{ marginTop: sp.md }}>
              <Notice tone={t.crit} kicker="Injury" title="Your Injuries Could Not Be Read"
                note="So no movement below has been checked against them, and none carries a caution. This is a connection problem, not a clean sheet. If something is hurt, take it easy on it or leave it out, and pull down to try again." />
            </View>
          ) : null}

          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            Movements from the exercise catalogue · sets and reps are a starting point, not a
            prescription from a coach
          </Text>
        </Section>

        {program.days.length === 0 ? null : program.days.map((d, di) => (
          <View key={`${d.day}-${di}`}>
            <Rule />
            <Section>
              <SectionHead
                title={d.focus}
                // The day it is for, spelled out. `ProgramDay.day` is the
                // abbreviation the week is written in; the member picked a
                // whole name and should read one back.
                note={[
                  WEEK_DAY_NAMES[WEEK_DAYS.indexOf(d.day)] ?? d.day,
                  d.exercises.length === 1 ? '1 movement' : `${d.exercises.length} movements`,
                  `${d.exercises.reduce((n, e) => n + e.sets, 0)} Sets`,
                ].join(' · ')}
              />
              {d.exercises.map((e, ei) => {
                // The movement this row currently holds: the generated one, or
                // the one the member replaced it with. English either way — it
                // is the identity the exercise screen resolves.
                const name = swaps[e.key] || e.name;
                const row = byName.get(name);
                const label = row?.display.text ?? name;
                // The catalogue's group for the movement ACTUALLY on the row.
                // A replacement can sit under a different group from the one it
                // replaced, and the injury check has to be asked about the
                // movement in front of the member.
                const group = (row?.group || '').trim() || e.group;
                // Everything the day currently holds, so a replacement cannot
                // put the same movement on the day twice.
                const used = d.exercises.map((x) => swaps[x.key] || x.name);
                const alt = nextAlternative(e.alternatives, used, group, cd.injuries, cd.profileStatus, name);
                const chk = checkInjury(name, group, cd.injuries, cd.profileStatus);
                // The line names exactly the movement Replace will put in, and
                // nothing else. It used to name the first two free movements at
                // the top of the pool while Replace walked on from the current
                // one, so after a swap the screen named one movement and the
                // button delivered another. A hint that disagrees with its own
                // button is worse than no hint.
                const alts = alt ? (byName.get(alt)?.display.text ?? alt) : '';
                return (
                  <View key={e.key} style={{ borderTopWidth: ei === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Pressable
                    // The ENGLISH name is the identity and is what the exercise
                    // screen resolves; `display` is only ever what the line
                    // says. A push carrying a translated name finds nothing.
                    onPress={() => router.push({ pathname: '/(client)/exercise', params: { name, from: 'clientBuildWorkout' } })}
                    accessibilityRole="button"
                    // The label REPLACES every line beneath it, so the sets,
                    // the reps, the group and the alternatives are all in it.
                    // See scripts/check-a11y.mjs.
                    accessibilityLabel={[
                      label,
                      `${e.sets} sets of ${e.reps}`,
                      group,
                      chk.state === 'flagged' ? chk.reason : null,
                      alts ? `Or instead: ${alts}` : null,
                      'Opens how to do it',
                    ].filter(Boolean).join('. ')}
                    hitSlop={hitSlopFor(MIN_TARGET)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: sp.md,
                      paddingVertical: sp.md, minHeight: MIN_TARGET,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                        <Text style={{ ...ty.body, ...font('500'), color: t.ink, flex: 1 }}>{label}</Text>
                        {/* The same mark the Train screen puts on a flagged
                            movement, in the same colour. One visual language
                            for one fact. */}
                        {chk.state === 'flagged' ? <Icon name="heart" size={13} color={t.s3} /> : null}
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>
                        {e.sets} × {e.reps} · {group}
                      </Text>
                      {/* Real sibling movements from the same pool. Absent,
                          rather than padded, when the pool had none left. */}
                      {alts ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Or instead: {alts}</Text>
                      ) : null}
                    </View>
                    <Text style={{ ...ty.label, color: t.ink3 }}>{FORWARD_CHAR}</Text>
                  </Pressable>

                  {/* ── the caution, and what it does and does not claim ──
                      Drawn only when the disclosure was READ and something in
                      it is loaded by this movement. It says the movement loads
                      an area the member reported; it never says a movement is
                      safe, approved or fine, and an unflagged row says nothing
                      at all rather than saying it is clear. `injuryFlag`'s own
                      sentence, unsoftened. The banner above covers the two
                      cases where there is no check to report. */}
                  {chk.state === 'flagged' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.md }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
                      <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
                        {chk.reason}. Ease off, keep it pain-free{alt ? ', or replace it' : ''}.
                      </Text>
                    </View>
                  ) : null}

                  {/* Replace, out of THIS target's own pool — the movements
                      `targetedProgram` attached, which are real catalogue rows
                      for the same muscle and were never already prescribed. A
                      pool the day has exhausted gets the sentence rather than a
                      button that would do nothing. */}
                  <View style={{ marginBottom: sp.md, alignSelf: 'flex-start' }}>
                    {alt ? (
                      <Ghost label="Replace" icon="swap"
                        a11yLabel={`Replace ${label} with ${byName.get(alt)?.display.text ?? alt}`}
                        onPress={() => setSwaps((prev) => ({ ...prev, [e.key]: alt }))} />
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3 }}>
                        No other {d.focus.toLowerCase()} movement left in the catalogue to swap this for.
                      </Text>
                    )}
                  </View>
                  </View>
                );
              })}
            </Section>
          </View>
        ))}

        {/* ── getting rid of it ───────────────────────────────────────────
            Last, under the whole session, because it is about the whole
            session and not about any one movement. */}
        <Rule />
        <Section>
          <Ghost label="Delete This Workout" icon="minus" onPress={discard}
            a11yLabel="Delete this workout. Asks first" />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            This session was built on your phone and has not been saved anywhere. Deleting it clears
            it from this screen and nothing else.
          </Text>
        </Section>
      </>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="Build a Workout" subtitle="Pick what you want to train" onBack={goBack} />

        {/* Four statuses, four sentences. An empty catalogue read while signed
            out is a permissions answer and not the claim that the catalogue is
            empty; a failed read is neither. */}
        {cat.status === 'loading' ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Icon name="dumbbell" size={26} color={t.ink3} />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
              Reading the exercise catalogue…
            </Text>
          </View>
        ) : cat.status === 'error' ? (
          <Notice tone={t.warn} kicker="Exercise Catalogue" title="The exercise catalogue could not be read"
            note="This is our end, not yours. The movements are still there. Nothing can be built until it is read, so nothing has been. Pull down to try again once you have signal." />
        ) : cat.signedOut ? (
          <Notice tone={t.warn} kicker="Exercise Catalogue" title="Sign in to build a workout"
            note="The movement catalogue is only available once you are signed in, so this screen was not allowed to look it up. Nothing has been removed." />
        ) : cat.rows.length === 0 ? (
          <Notice tone={t.warn} kicker="Exercise Catalogue" title="The catalogue came back empty"
            note="The read worked and returned no movements, so there is nothing to build a workout from. Pull down to try again." />
        ) : (
          <>
            {/* A workout built out of part of the catalogue is built out of
                part of the catalogue, and the member has to know that before
                they read a target that says it has "only 3 movements". */}
            {cat.status === 'partial' ? <PartialRead what="movements" shown={cat.rows.length} onPress={cat.reload} /> : null}
            {picker()}
            {result()}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
