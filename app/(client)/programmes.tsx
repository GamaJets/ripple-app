// Client · Programmes — the fifteen ready-made plans, and what is actually in
// each one.
//
// ── Why this screen exists ────────────────────────────────────────────────
//
// `public.workout_templates` has been live and populated since
// supabase/parts/2600 and was read by NOTHING. Fifteen programmes, trilingual,
// 126 movements resolved against the catalogue by hand, and no route into any
// of it. A member on no coach's book had the exercise library — six hundred
// movements with no order to do them in — and nothing that said "start here on
// Monday".
//
// ── What this screen will not tell you ────────────────────────────────────
//
// How long a session takes, and what it burns. Neither is in the data and
// neither is derivable from it: the tempo is not recorded, half the rep counts
// are ranges or timed holds, and "AMRAP" has no length at all. A "45 min"
// under each card would be the single most useful line on the page and it
// would be invented, so it is not here. `frequency_per_week` IS recorded and is
// the only cadence figure printed. src/lib/workoutTemplates.ts argues this at
// the point it would be computed.
//
// ── These are not a coach's programmes and must not read as one ───────────
//
// A member on a coach's book gets their programme on the Train tab, written for
// them, around their injuries. These fifteen are written for nobody. The
// heading and the standing line under it say so, and the screen never uses the
// words a coached programme uses ("your programme", "assigned") about any of
// them.
//
// ── Four statuses, four sentences ─────────────────────────────────────────
//
// Loading, failed, signed-out-so-we-were-not-allowed-to-look, and genuinely
// empty are four different things and this screen says four different things.
// The signed-out case is not theoretical: `wt_read` is `to authenticated`, so a
// session that has not been restored is handed zero rows and no error, and
// "there are no programmes" would be a false statement about fifteen that
// exist. See src/ui/workoutTemplates.ts.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useBackFromHub } from '../../src/ui/backTo';
import { Rule, Section, SectionHead, Notice, PartialRead, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useProgrammeLibrary } from '../../src/ui/workoutTemplates';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { isWhole } from '../../src/ui/loadStatus';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { BACK_ICON, FORWARD_CHAR } from '../../src/ui/direction';
import {
  filterTemplates, isFiltering, goalsPresent, difficultiesPresent,
  goalLabel, difficultyLabel, tagLabel, frequencyLabel, restLabel, setsLabel,
  shapeLine, unreadableNote, exerciseSpoken,
  localisedText, templateFallbackNote, daysFallBack,
  FREQUENCY_BANDS, NO_FILTER,
  type TemplateFilter, type FrequencyBandKey, type WorkoutTemplate,
} from '../../src/lib/workoutTemplates';

/* ── one filter chip ────────────────────────────────────────────────────────
 *
 * Module level, not a const inside the screen. A component declared inside a
 * render is a NEW component type on every render, so React unmounts the old
 * tree and mounts a fresh one — and the horizontal ScrollView these sit in is
 * remounted with them, which resets its scroll offset. The gesture that does it
 * is tapping a chip: a member who scrolled the Goal row along to reach
 * "Mobility" would be snapped back to the start the moment they tapped it, on
 * every tap, with the chip they chose off screen.
 *
 * Selection is carried in `accessibilityState` as well as in the fill, because
 * the fill is colour and colour is never the only channel in this kit.
 */
function Chip({ label, on, onPress, spoken }: {
  label: string; on: boolean; onPress: () => void; spoken: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ selected: on }}
      style={{
        paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill,
        minHeight: MIN_TARGET, justifyContent: 'center',
        backgroundColor: on ? t.brand : t.surface2,
      }}
    >
      <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

/** One row of chips, with its own heading. Nothing is drawn when the data
 *  offered no values — an empty filter row is a control that does nothing. */
function ChipRow({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: sp.md }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.xs }}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingVertical: 2 }}>
        {children}
      </ScrollView>
    </View>
  );
}

export default function Programmes() {
  const t = useTheme();
  const router = useRouter();
  // Rows here open the exercise detail, so Back must skip its own details —
  // otherwise Back from this screen walks FORWARD into the movement the member
  // just finished reading. See src/lib/backTo.ts.
  const goBack = useBackFromHub('(client)');
  const lib = useProgrammeLibrary();
  const { templates, status, signedOut, unreadableRows, locale, movements } = lib;
  // The movement names come back as the English identity — that is what the
  // exercise screen must be opened with. This is the reader's own language for
  // the LINE, and it leaves the navigation untouched.
  const { nameOf } = useMovementName();

  const [filter, setFilter] = useState<TemplateFilter>(NO_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);

  // Both reads. The names read cannot be re-armed by re-reading the programmes
  // — the ids do not change — so it carries its own reload and the pull asks
  // for both. A member whose name read failed on a train has no other way back.
  const pull = usePullToRefresh(useCallback(() => {
    lib.reload();
    movements.reload();
  }, [lib, movements]));

  const shown = useMemo(() => filterTemplates(templates, filter), [templates, filter]);
  const open = useMemo(() => templates.find((x) => x.id === openId) ?? null, [templates, openId]);

  // ── which chips are offered ──────────────────────────────────────────────
  //
  // Built from the rows rather than from the five constants, so a chip is never
  // offered that filters to nothing — a member who taps "Mobility" and meets an
  // empty list has been told the mobility routine was removed.
  //
  // `isWhole`, not `!== 'error'`. Under 'partial' the goals in the page are the
  // goals that fit in one read and not the goals in the catalogue, so a chip
  // row built from them would be silently short; under 'loading' there are no
  // rows at all and the row would flash into existence. Both cases show no
  // chips, which is honest, and the list below is unfiltered.
  const canFilter = isWhole(status) && templates.length > 0;
  const goals = useMemo(() => (canFilter ? goalsPresent(templates) : []), [canFilter, templates]);
  const levels = useMemo(() => (canFilter ? difficultiesPresent(templates) : []), [canFilter, templates]);
  const bands = useMemo(
    () => (canFilter ? FREQUENCY_BANDS.filter((b) => templates.some((x) => {
      const n = x.frequencyPerWeek;
      return n != null && n >= b.min && (b.max == null || n <= b.max);
    })) : []),
    [canFilter, templates],
  );

  const G = layout.gutter;

  /* ── the summary line under a programme's name ──────────────────────────
   *
   * Goal, level, cadence and shape, in that order, with anything the row does
   * not carry simply absent. Never padded with "unknown": a member reading
   * fifteen rows does not need fifteen admissions, and the two facts that ARE
   * there read better without them.
   */
  const metaLine = (x: WorkoutTemplate): string =>
    [goalLabel(x.goal), difficultyLabel(x.difficulty), frequencyLabel(x.frequencyPerWeek), shapeLine(x)]
      .filter(Boolean).join(' · ');

  /* ── the detail of one programme ─────────────────────────────────────── */
  const detail = (x: WorkoutTemplate) => {
    const name = localisedText(x.name, locale);
    const description = localisedText(x.description, locale);
    const note = templateFallbackNote(name, description, daysFallBack(x.days, locale));
    const shortfall = unreadableNote(x);
    return (
      <>
        <Section>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Ready-made programme</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>{name?.text ?? x.id}</Text>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{metaLine(x)}</Text>
          {description ? (
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{description.text}</Text>
          ) : null}

          {/* An English string sitting silently among German ones reads as a
              translation somebody made. See src/lib/catalogueLocale.ts. */}
          {note ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{note}</Flag> : null}

          {/* Not about the network. These entries came back and had nothing in
              them we could name, so the days below are shorter than the
              programme is — which a member following it has to know. */}
          {shortfall ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{shortfall}</Flag> : null}

          {x.tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
              {x.tags.map((tag) => (
                <View key={tag} style={{ paddingHorizontal: sp.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{tagLabel(tag)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Whose programmes these are, said on the page they are read from
              rather than two screens away on a credits card. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            Programme by RepDB · repdb.co
          </Text>
        </Section>

        {/* The movement names are a second read and it can fail on its own.
            When it does the days are still real and still worth following — the
            sets, the reps and the rests all come off the programme row — so the
            list is shown and the gap is named rather than the screen refusing. */}
        {movements.status === 'error' ? (
          <Notice tone={t.warn} kicker="Movement names" title="The names of these movements could not be read"
            note="The programme itself is below and is complete. What is missing is only the catalogue name for each line, so the rows are listed by their catalogue id. Pull down to try again." />
        ) : null}
        {movements.status === 'ready' && movements.missing.length ? (
          <Flag tone={t.warn}>
            Some movements in these programmes are not in the exercise catalogue on this device, so they are
            listed by their catalogue id and have no page to open.
          </Flag>
        ) : null}

        {x.days.length === 0 ? (
          <Section>
            <Text style={{ ...ty.label, color: t.ink3 }}>
              This programme lists no days. That is a gap in the programme itself and not something that
              failed to load — there is nothing here to follow yet.
            </Text>
          </Section>
        ) : x.days.map((d, di) => {
          const dayName = localisedText(d.name, locale);
          return (
            <View key={`${x.id}-day-${di}`}>
              <Rule />
              <Section>
                <SectionHead
                  title={dayName?.text ?? `Day ${di + 1}`}
                  note={d.exercises.length ? `${d.exercises.length === 1 ? '1 exercise' : `${d.exercises.length} exercises`}` : undefined}
                />
                {d.exercises.length === 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    This day lists no movements.
                  </Text>
                ) : d.exercises.map((e, ei) => {
                  // The English catalogue name is the identity and is what the
                  // exercise screen is opened with; `nameOf` is the reader's
                  // language and is only ever what the LINE says. A push that
                  // carried the translated name would resolve to nothing.
                  const english = movements.byId.get(e.exerciseId) ?? null;
                  const label = english ? nameOf(english).text : e.exerciseId;
                  const load = setsLabel(e.sets, e.reps);
                  const rest = restLabel(e.restSeconds);
                  const cue = localisedText(e.notes, locale);
                  // Openable by id as well as by name: exerciseSlug() of a
                  // catalogue id is the id itself, so the detail screen resolves
                  // it and shows the real name. A row is only dead when there is
                  // nothing at all to send.
                  const target = english ?? e.exerciseId;
                  return (
                    <Pressable
                      key={`${x.id}-${di}-${ei}-${e.exerciseId}`}
                      onPress={() => router.push({ pathname: '/(client)/exercise', params: { name: target, from: 'clientProgrammes' } })}
                      accessibilityRole="button"
                      // A label REPLACES the lines beneath it, so the sets, the
                      // reps and the rest have to be IN it or a screen-reader
                      // user is told only the movement's name. See
                      // scripts/check-a11y.mjs.
                      accessibilityLabel={[
                        exerciseSpoken(label, e.sets, e.reps, e.restSeconds),
                        cue?.text,
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
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{label}</Text>
                        {load || rest ? (
                          <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>
                            {[load, rest].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                        {cue ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{cue.text}</Text>
                        ) : null}
                      </View>
                      <Text style={{ ...ty.label, color: t.ink3 }}>{FORWARD_CHAR}</Text>
                    </Pressable>
                  );
                })}
              </Section>
            </View>
          );
        })}
      </>
    );
  };

  /* ── the list of fifteen ─────────────────────────────────────────────── */
  const list = () => (
    <>
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
        Complete plans anyone can follow. They are not written for you and nobody is coaching you through
        them — your coach's programme, if you have one, is on your Train tab.
      </Text>

      {goals.length > 1 ? (
        <ChipRow title="Goal">
          <Chip label="All" on={filter.goal === null} spoken="Show programmes for every goal"
            onPress={() => setFilter((f) => ({ ...f, goal: null }))} />
          {goals.map((g) => (
            <Chip key={g} label={goalLabel(g)} on={filter.goal === g} spoken={`Show ${goalLabel(g)} programmes only`}
              onPress={() => setFilter((f) => ({ ...f, goal: f.goal === g ? null : g }))} />
          ))}
        </ChipRow>
      ) : null}

      {levels.length > 1 ? (
        <ChipRow title="Level">
          <Chip label="All" on={filter.difficulty === null} spoken="Show programmes at every level"
            onPress={() => setFilter((f) => ({ ...f, difficulty: null }))} />
          {levels.map((d) => (
            <Chip key={d} label={difficultyLabel(d)} on={filter.difficulty === d} spoken={`Show ${difficultyLabel(d)} programmes only`}
              onPress={() => setFilter((f) => ({ ...f, difficulty: f.difficulty === d ? null : d }))} />
          ))}
        </ChipRow>
      ) : null}

      {bands.length > 1 ? (
        <ChipRow title="How Often">
          <Chip label="Any" on={filter.frequency === null} spoken="Show programmes at any number of days a week"
            onPress={() => setFilter((f) => ({ ...f, frequency: null }))} />
          {bands.map((b) => (
            <Chip key={b.key} label={b.label} on={filter.frequency === b.key} spoken={`Show programmes of ${b.label.toLowerCase()} a week`}
              onPress={() => setFilter((f) => ({ ...f, frequency: f.frequency === b.key ? null : (b.key as FrequencyBandKey) }))} />
          ))}
        </ChipRow>
      ) : null}

      <Rule />

      <Section>
        {/* A count over a list that came back short is not the size of the
            catalogue, and a count over a signed-out read is a measurement of a
            permissions refusal. `isWhole`, both times. */}
        <SectionHead
          title="Programmes"
          note={isWhole(status) && !signedOut && templates.length
            ? (isFiltering(filter) ? `${shown.length} of ${templates.length}` : String(templates.length))
            : undefined}
        />

        {/* Four different things, said four different ways. */}
        {status === 'loading' ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Icon name="grid" size={26} color={t.ink3} />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
              Reading the programme library…
            </Text>
          </View>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="Programmes" title="The programme library could not be read"
            note="This is our end, not yours — the programmes are still there. Pull down to try again once you have signal." />
        ) : signedOut ? (
          <Notice tone={t.warn} kicker="Programmes" title="Sign in to see the programmes"
            note="These are only available once you are signed in, so this screen was not allowed to look them up. Nothing has been removed." />
        ) : (
          <>
            {status === 'partial' ? <PartialRead what="programmes" shown={templates.length} onPress={lib.reload} /> : null}

            {/* Rows that came back and could not be turned into a programme.
                Zero on every read of the live table, and said out loud rather
                than left as a list that is quietly one short. */}
            {unreadableRows > 0 ? (
              <Flag tone={t.warn}>
                {unreadableRows === 1
                  ? 'One programme came back in a shape this app could not read and is not listed below.'
                  : `${unreadableRows} programmes came back in a shape this app could not read and are not listed below.`}
              </Flag>
            ) : null}

            {templates.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                There are no ready-made programmes yet. They appear here as they are added.
              </Text>
            ) : shown.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
                <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center' }}>
                  No programme matches what you picked.
                </Text>
                <View style={{ marginTop: sp.md }}>
                  <Ghost label="Clear Filters" onPress={() => setFilter(NO_FILTER)} />
                </View>
              </View>
            ) : shown.map((x, i) => {
              const name = localisedText(x.name, locale);
              const description = localisedText(x.description, locale);
              return (
                <Pressable
                  key={x.id}
                  onPress={() => setOpenId(x.id)}
                  accessibilityRole="button"
                  accessibilityLabel={[name?.text ?? x.id, metaLine(x), description?.text].filter(Boolean).join('. ')}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: sp.md,
                    paddingVertical: sp.lg, minHeight: MIN_TARGET,
                    borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                  }}
                >
                  <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="grid" size={18} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{name?.text ?? x.id}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{metaLine(x)}</Text>
                    {description ? (
                      <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }} numberOfLines={2}>{description.text}</Text>
                    ) : null}
                  </View>
                  <Text style={{ ...ty.label, color: t.ink3 }}>{FORWARD_CHAR}</Text>
                </Pressable>
              );
            })}
          </>
        )}
      </Section>
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* Back LEADS the row and is announced. While a programme is open it
            closes the programme rather than leaving the screen — the member's
            way back to the list is the control they already used to get here,
            and a Back that jumped two levels would drop the filters they set. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost
            icon={BACK_ICON}
            a11yLabel={open ? 'Back to the list of programmes' : 'Back'}
            onPress={() => { if (open) setOpenId(null); else goBack(); }}
          />
          {!open ? (
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Ready-made, for anyone</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Programmes</Text>
            </View>
          ) : null}
        </View>

        {open ? detail(open) : list()}
      </ScrollView>
    </SafeAreaView>
  );
}
