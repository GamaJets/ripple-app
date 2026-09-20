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
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useBackFromHub } from '../../src/ui/backTo';
import {
  Cta, Flag, Notice, PageHead, PartialRead, Rule, Section, SectionHead, Segmented, TonedChip,
} from '../../src/ui/kit';
import { groupTone } from '../../src/ui/groupTone';
import { MUSCLE_GROUPS } from '../../src/ui/MuscleGroupPicker';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { grown, hairline, layout, sp, type as ty, font } from '../../src/theme/scale';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { FORWARD_CHAR } from '../../src/ui/direction';
import { NO_KIT } from '../../src/lib/equipmentFacet';
import {
  targetedProgram, targetedCoverageNote, targetsUnder, type Target,
} from '../../src/lib/targetedWorkout';

/** A target as a key, so the chosen set can live in a `Set<string>`. */
const keyOf = (x: Target) => `${x.kind}:${x.name}`;
const parse = (k: string): Target =>
  ({ kind: k.slice(0, k.indexOf(':')) as Target['kind'], name: k.slice(k.indexOf(':') + 1) });

/**
 * One target chip.
 *
 * The lit chip is the kit's `TonedChip` in the target's own hue — the same
 * colour that muscle group wears on the Train hero, in Muscle Focus and in the
 * runner — and the unlit one is the same geometry on `surface2`. Copied in
 * behaviour from src/ui/MuscleGroupPicker.tsx, which argues the case for the
 * shape; this one is a CHECKBOX rather than a radio, because more than one
 * target is the ordinary use of this screen.
 *
 * `kind` is spoken and not only drawn. "Arms" the group and "Triceps" the
 * muscle sit on the same row and produce different workouts, so a screen
 * reader has to be told which of the two a chip is.
 */
function TargetChip({ label, kind, on, onPress }: {
  label: string; kind: Target['kind']; on: boolean; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={kind === 'group' ? `${label}, the whole muscle group` : `${label}, one muscle`}
      hitSlop={hitSlopFor(MIN_TARGET)}
    >
      {on ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TonedChip label={label} tone={groupTone(label)} icon="check" />
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
}

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
  const [built, setBuilt] = useState<{ targets: string[]; noKit: boolean } | null>(null);

  const toggle = (x: Target) => {
    const k = keyOf(x);
    setChosen((xs) => (xs.includes(k) ? xs.filter((y) => y !== k) : [...xs, k]));
  };

  const plan = useMemo(() => {
    if (!built || !built.targets.length) return null;
    return targetedProgram(cat.rows, built.targets.map(parse), { noKit: built.noKit });
  }, [built, cat.rows]);

  /** The reader's own language for a movement, and the English identity to
   *  navigate by. The generator works in English names because those are the
   *  catalogue's identity; only the LINE is translated. */
  const byName = useMemo(() => {
    const m = new Map<string, CatalogueRow>();
    for (const r of cat.rows) m.set(r.name, r);
    return m;
  }, [cat.rows]);

  const G = layout.gutter;
  const ready = isWhole(cat.status) && !cat.signedOut && cat.rows.length > 0;

  /* ── the picker ──────────────────────────────────────────────────────── */
  const picker = () => (
    <>
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
        Pick a muscle group, or a single muscle inside it, and this builds a session out of the
        movements the catalogue actually holds for it. Pick more than one and each becomes its own day.
      </Text>

      <Section>
        <SectionHead title="What Do You Want To Train?"
          note={chosen.length ? `${chosen.length} picked` : undefined} />

        {/* One row per group, the group chip first and the muscles under it
            beside it. This is the whole point of the screen: a member who
            wants triceps finds the word "Triceps" without having to know it is
            filed under Arms, and a member who wants the whole of Arms taps
            Arms. `MUSCLE_GROUPS` is the catalogue's own eleven, in the
            catalogue's own spelling and its own order. */}
        {MUSCLE_GROUPS.map((g, i) => {
          const muscles = targetsUnder(g);
          return (
            <View key={g} style={{
              paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, alignItems: 'center' }}>
                <TargetChip label={g} kind="group" on={chosen.includes(`group:${g}`)}
                  onPress={() => toggle({ kind: 'group', name: g })} />
                {muscles.map((m) => (
                  <TargetChip key={m.label} label={m.label} kind="muscle" on={chosen.includes(`muscle:${m.label}`)}
                    onPress={() => toggle({ kind: 'muscle', name: m.label })} />
                ))}
              </View>
            </View>
          );
        })}
      </Section>

      <Rule />

      <Section>
        <SectionHead title="Equipment"
          note="What you have to train with today" />
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
            ? 'Only movements the catalogue records as needing nothing at all — no bar, no bands, no bench. Some muscles have none, and you will be told which.'
            : 'Every movement in the catalogue, whatever it is performed on.'}
        </Text>
      </Section>

      <Section>
        <Cta
          wide
          label="Build My Workout"
          disabled={!ready || chosen.length === 0}
          a11yLabel={chosen.length === 0
            ? 'Build my workout. Pick at least one muscle or muscle group first'
            : `Build a workout for ${chosen.map((k) => parse(k).name).join(', ')}`}
          onPress={() => setBuilt({ targets: chosen, noKit: kit === 'none' })}
        />
      </Section>
    </>
  );

  /* ── the workout it built ────────────────────────────────────────────── */
  const result = () => {
    if (!plan) return null;
    const { program, coverage } = plan;
    const note = targetedCoverageNote(coverage);
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
              Every movement here needs no equipment at all — no bar, no bands, no bench.
            </Text>
          ) : null}

          {/* The targets it could not serve, named, with the reason. Never
              rolled up into "some targets could not be covered", and never
              quietly replaced with a muscle nobody asked for. */}
          {note ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{note}</Flag> : null}

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
                note={`${d.exercises.length === 1 ? '1 movement' : `${d.exercises.length} movements`} · ${d.exercises.reduce((n, e) => n + e.sets, 0)} sets`}
              />
              {d.exercises.map((e, ei) => {
                const row = byName.get(e.name);
                const label = row?.display.text ?? e.name;
                const alts = e.alternatives
                  .map((a) => byName.get(a)?.display.text ?? a)
                  .join(', ');
                return (
                  <Pressable
                    key={e.key}
                    // The ENGLISH name is the identity and is what the exercise
                    // screen resolves; `display` is only ever what the line
                    // says. A push carrying a translated name finds nothing.
                    onPress={() => router.push({ pathname: '/(client)/exercise', params: { name: e.name, from: 'clientBuildWorkout' } })}
                    accessibilityRole="button"
                    // The label REPLACES every line beneath it, so the sets,
                    // the reps, the group and the alternatives are all in it.
                    // See scripts/check-a11y.mjs.
                    accessibilityLabel={[
                      label,
                      `${e.sets} sets of ${e.reps}`,
                      e.group,
                      alts ? `Or instead: ${alts}` : null,
                      'Opens how to do it',
                    ].filter(Boolean).join('. ')}
                    hitSlop={hitSlopFor(MIN_TARGET)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: sp.md,
                      paddingVertical: sp.md, minHeight: MIN_TARGET,
                      borderTopWidth: ei === 0 ? 0 : hairline, borderTopColor: t.ring,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{label}</Text>
                      <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>
                        {e.sets} × {e.reps} · {e.group}
                      </Text>
                      {/* Real sibling movements from the same pool. Absent,
                          rather than padded, when the pool had none left. */}
                      {alts ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Or instead: {alts}</Text>
                      ) : null}
                    </View>
                    <Text style={{ ...ty.label, color: t.ink3 }}>{FORWARD_CHAR}</Text>
                  </Pressable>
                );
              })}
            </Section>
          </View>
        ))}
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
            note="This is our end, not yours — the movements are still there. Nothing can be built until it is read, so nothing has been. Pull down to try again once you have signal." />
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
