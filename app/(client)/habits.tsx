// Client · Daily Habits & Water (Phase 7). Check off habits and log water; the
// water goal auto-completes the water habit. Reachable from the profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, handler and accessibility role is preserved — the three
// bordered blocks became one hero figure and two hairline-separated sections.
//
// ── TF-31 ───────────────────────────────────────────────────────────────────
//
// The checklist is derived now (src/lib/checklist.ts), so it varies in length
// and can legitimately be empty. Two things on this screen assumed it could not
// be:
//
//   · `Math.round((doneCount / habits.length) * 100)` divided by zero and put
//     the result straight into the one big number on the screen: "NaN%", over
//     an arc drawn from NaN. donePercent returns null instead and the Hero
//     shows a dash, which is what `fig` is for.
//   · "0 of 0 habits done" over an empty list read as a day with nothing asked
//     of you. Under `status === 'error'` that is exactly the lie the provider's
//     header is about, so the empty state and the notice below say which of the
//     two it is before the client draws a conclusion about their own day.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useHabits } from '../../src/ui/habits';
import { unsentNote } from '../../src/lib/offlineQueue';
import { donePercent } from '../../src/lib/checklist';
import { useClientData } from '../../src/ui/clientData';

// The same bounds clients_step_goal_check, clients_sleep_goal_hours_check
// (supabase/parts/60) and clients_water_goal_glasses_check (part 70) enforce.
// Checked here as well, and not as belt and braces: the profile write is one
// UPDATE carrying every field on it, so a value the constraint refuses takes
// the client's name, goal, diet and allergens down with it — silently, in a
// debounced effect nobody is watching. That is exactly how the 'solo' coaching
// mode ate whole profile saves.
const STEP_MIN = 500, STEP_MAX = 100000;
const SLEEP_MIN = 3, SLEEP_MAX = 14;
const WATER_MIN = 1, WATER_MAX = 30;

export default function Habits() {
  const t = useTheme();
  const router = useRouter();
  const h = useHabits();
  // null when there is nothing on the list. Not 0 — nought per cent is a claim
  // that the client did none of the things asked of them today.
  const pct = donePercent(h.doneCount, h.habits.length);
  const unknown = h.status === 'error';
  const c = useClientData();
  const [stepDraft, setStepDraft] = useState('');
  const [sleepDraft, setSleepDraft] = useState('');
  const [waterDraft, setWaterDraft] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Small wins, every day</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Daily Habits</Text>
          </View>
        </View>

        {/* ── the hero: today, in one number ──────────────────────────────── */}
        <Hero
          label="Today's Progress"
          figure={fig(pct)}
          unit={pct == null ? undefined : '%'}
          arc={pct == null ? undefined : pct / 100}
          arcLabel="of today's habits done"
          note={pct == null
            ? (unknown ? 'We could not load today’s list' : 'Nothing on today’s list yet')
            : `${h.doneCount} of ${h.habits.length} done`}
        />

        <Rule />

        {/* ── water ──────────────────────────────────────────────────────── */}
        <Section>
          {/* With no goal there is no "/ 8" to write and no eight empty glasses
              to draw: `Array.from({ length: null })` is a zero-length array, so
              the row silently vanished rather than saying anything. The count
              they have drunk is still true and still theirs, so it leads, and
              the row draws exactly the glasses they logged. */}
          <SectionHead title="Water" note={h.waterGoal != null ? `${h.water} / ${h.waterGoal} glasses` : `${h.water} ${h.water === 1 ? 'glass' : 'glasses'}`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: h.waterGoal == null ? sp.md : sp.lg }}>
            {Array.from({ length: h.waterGoal ?? h.water }).map((_, i) => (
              <View key={i} style={{ width: 24, height: 32, borderRadius: radius.sm, borderWidth: hairline, borderColor: i < h.water ? t.brand : t.ring, backgroundColor: i < h.water ? t.brand : 'transparent', opacity: i < h.water ? 0.9 : 1 }} />
            ))}
          </View>
          {h.waterGoal == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              No daily goal yet — set one under Your daily targets below and these glasses count towards it.
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
            <Pressable accessibilityLabel="Remove a glass of water" accessibilityRole="button" onPress={h.removeWater}
              style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="minus" size={16} color={t.ink2} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Cta label="Add a Glass" wide onPress={h.addWater} />
            </View>
          </View>
          {/* Which copy of the count these glasses are drawn from.
              Before part 109 the count lived in this device's storage and
              nowhere else, so it could not be wrong about the server — there
              was no server copy to be wrong about. Now there is, and the count
              still has to work with no signal (this is a gym), so the honest
              state is "counted here, unconfirmed" rather than either a reset to
              zero or a number presented as though it had been checked. */}
          {h.waterStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
              Counted on this phone. We couldn’t check it against your account just now, so if you have logged water on another device today this may not be the whole picture.
            </Text>
          ) : null}
        </Section>

        <Rule />

        {/* ── checklist ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Checklist" note={h.habits.length ? `${h.doneCount} done` : undefined} />

          {/* The list is built from this person's own plan and targets, which is
              the question TF-31 asked outright. Saying so costs one line and
              stops the next tester having to ask. */}
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            Built from your plan, your targets and anything your coach adds.
          </Text>

          {/* Ticks the server has not taken. The client did the thing and the
              tick is safe on this phone — what has not happened is the row in
              `habit_logs`, which is what src/lib/adherence.ts counts to tell
              their coach how often they keep a habit. Saying "saved" without
              saying "not sent" would let somebody read a green screen as a
              figure their coach can see. */}
          {unsentNote(h.unsent, 'tick') ? (
            <Notice tone={t.warn} kicker="Checklist" title="Not sent yet"
              note={`${unsentNote(h.unsent, 'tick')} Until then your coach's records for today are short of them.`} />
          ) : null}

          {/* A refused read leaves rows off the list. Naming that is the whole
              point of `status` — an unticked (or absent) habit under 'error'
              means unknown, and the coach's dashboard reads the same rows. */}
          {unknown ? (
            <Notice tone={t.warn} kicker="Checklist" title="Some of today’s list is missing"
              note="We couldn’t read your targets or your ticks just now, so anything below may be short a line — and an empty circle here doesn’t mean you skipped it." />
          ) : null}

          {/* A target the app does not have is not a row. Where the client can
              go and supply it, the list says so instead of quietly shrinking. */}
          {h.gaps.map((g) => (
            <View key={g.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
              <View style={{ width: 24, height: 24, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring, borderStyle: 'dashed' }} />
              <Text style={{ flex: 1, ...ty.label, color: t.ink3 }}>{g.note}</Text>
            </View>
          ))}

          {h.habits.length === 0 && !unknown && h.gaps.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>
              Nothing on today’s list. Rest days and un-set targets both look like this — set a goal or ask your coach for one.
            </Text>
          ) : null}

          {h.habits.map((hb, hi) => (
            <View key={hb.id}>
              {hi > 0 || h.gaps.length ? <Rule /> : null}
              <Pressable
                onPress={() => h.toggleHabit(hb.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hb.done }}
                accessibilityLabel={hb.label}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
              >
                <View style={{ width: 24, height: 24, borderRadius: radius.pill, borderWidth: hb.done ? 0 : hairline, borderColor: t.ring, backgroundColor: hb.done ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {hb.done ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                </View>
                <Text style={{ ...ty.body, color: t.ink2 }}>{hb.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: hb.done ? t.ink : t.ink2 }}>{hb.label}</Text>
                  {/* Only the coach-set rows are attributed. "From your targets"
                      under a line that already reads "Hit 152 g protein" is
                      noise; "your coach asked for this" is not. */}
                  {hb.source === 'coach' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Set by your coach</Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── your daily targets ──────────────────────────────────────────
            The three numbers the checklist used to invent. "10,000 steps",
            "Sleep 7h+" and "8 glasses" were compiled into the app, identical
            for everybody, and no screen could change them — this is that
            screen. Leaving one blank is a real answer: the list simply carries
            no row for it. Water was the last to arrive because it was the one
            that never looked broken — it had a row, a hero arc and a readiness
            score built on it, all from a literal. */}
        <Section>
          <SectionHead title="Your Daily Targets" note="Optional" />
          <Text style={{ ...ty.body, color: t.ink3, marginBottom: sp.md }}>
            Set any of these and it joins your list. Leave one blank and nothing is assumed.
          </Text>

          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
            Steps a day{c.stepGoal != null ? ` · now ${c.stepGoal}` : ' · not set'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            <TextInput
              value={stepDraft} onChangeText={setStepDraft} keyboardType="number-pad"
              placeholder={c.stepGoal != null ? String(c.stepGoal) : 'e.g. 8000'} placeholderTextColor={t.ink3}
              accessibilityLabel="Daily step goal"
              style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            <Cta label="Save" onPress={() => {
              const n = Math.round(parseFloat(stepDraft));
              if (!Number.isFinite(n) || n < STEP_MIN || n > STEP_MAX) {
                Alert.alert('Check that number', `A step goal needs to be between ${STEP_MIN} and ${STEP_MAX}.`);
                return;
              }
              c.setStepGoal(n); setStepDraft('');
            }} />
            {c.stepGoal != null ? (
              <Pressable onPress={() => { c.setStepGoal(null); setStepDraft(''); }} accessibilityRole="button" accessibilityLabel="Clear step goal"
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>
            Sleep a night{c.sleepGoalHours != null ? ` · now ${c.sleepGoalHours}h` : ' · not set'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            <TextInput
              value={sleepDraft} onChangeText={setSleepDraft} keyboardType="decimal-pad"
              placeholder={c.sleepGoalHours != null ? String(c.sleepGoalHours) : 'e.g. 7.5'} placeholderTextColor={t.ink3}
              accessibilityLabel="Nightly sleep goal in hours"
              style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            <Cta label="Save" onPress={() => {
              // One decimal, matching numeric(3,1) on the column. Postgres would
              // round it anyway; doing it here means the number the client sees
              // afterwards is the number that was stored.
              const n = Math.round(parseFloat(sleepDraft) * 10) / 10;
              if (!Number.isFinite(n) || n < SLEEP_MIN || n > SLEEP_MAX) {
                Alert.alert('Check that number', `A sleep goal needs to be between ${SLEEP_MIN} and ${SLEEP_MAX} hours. If you meant minutes, use hours here — 450 minutes is 7.5.`);
                return;
              }
              c.setSleepGoalHours(n); setSleepDraft('');
            }} />
            {c.sleepGoalHours != null ? (
              <Pressable onPress={() => { c.setSleepGoalHours(null); setSleepDraft(''); }} accessibilityRole="button" accessibilityLabel="Clear sleep goal"
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>
            Water a day{c.waterGoalGlasses != null ? ` · now ${c.waterGoalGlasses} glasses` : ' · not set'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            <TextInput
              value={waterDraft} onChangeText={setWaterDraft} keyboardType="number-pad"
              placeholder={c.waterGoalGlasses != null ? String(c.waterGoalGlasses) : 'e.g. 8'} placeholderTextColor={t.ink3}
              accessibilityLabel="Daily water goal in glasses"
              style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            <Cta label="Save" onPress={() => {
              const n = Math.round(parseFloat(waterDraft));
              if (!Number.isFinite(n) || n < WATER_MIN || n > WATER_MAX) {
                Alert.alert('Check that number', `A water goal needs to be between ${WATER_MIN} and ${WATER_MAX} glasses. If you meant millilitres, use glasses here — a glass is about 250 ml.`);
                return;
              }
              c.setWaterGoalGlasses(n); setWaterDraft('');
            }} />
            {c.waterGoalGlasses != null ? (
              <Pressable onPress={() => { c.setWaterGoalGlasses(null); setWaterDraft(''); }} accessibilityRole="button" accessibilityLabel="Clear water goal"
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          {c.saveFailed ? (
            <Text style={{ ...ty.micro, color: t.warn, marginTop: sp.md }}>
              Your last profile change could not be saved, so this may not have stored either.
            </Text>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
