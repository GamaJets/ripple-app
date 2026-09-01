// AI Coach — a chat that knows the client's stats, goal, program & targets.
// Powered by the coach-chat edge function; graceful canned reply until deployed.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero and no cards — a chat screen's content is the
// conversation, so the bubbles carry the ink and the chrome recedes to a
// hairline. Every provider, conditional and route is unchanged.
import { useState, useRef, useEffect } from 'react';
import { num } from '../../src/lib/format';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { injurySummary } from '../../src/lib/injuries';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { buildProgram } from '../../src/lib/programs';
import { askCoach, coachAvailable, type ChatMsg } from '../../src/lib/coach';
import { useWellness } from '../../src/ui/wellness';
import { useHabits } from '../../src/ui/habits';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useFoodLog } from '../../src/ui/foodLog';
import { readinessScore, readinessMadeOf, readinessSleep } from '../../src/lib/readiness';
import { useDeviceSleep } from '../../src/ui/deviceSleep';
import { suggestProgression } from '../../src/lib/progression';
import { currentStreak } from '../../src/lib/streaks';
import { isWhole } from '../../src/ui/loadStatus';
import { liftLabel } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';

const SUGGESTIONS = ['What should I eat post-workout?', "I'm sore today — should I still train?", 'Am I on track for my goal?', 'Give me a quick high-protein snack'];

export default function Coach() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const coachProgram = useAssignedPrograms().getProgram(cd.id);
  const _adj = useCoachNutrition().get(cd.id);
  // null until there is a body to scale to. This used to run on the 70 kg /
  // 20% placeholder from clientData and present the result as the client's
  // own daily targets.
  const macros = (cd.weightKg != null && cd.bodyFatPct != null)
    ? applyCoachAdjust(macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet }), cd.coachingMode === 'solo' ? undefined : (_adj || undefined))
    : null;
  const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
  const { sleep } = useWellness();
  const { water, waterGoal, waterStatus } = useHabits();
  // Every line of `context` below is handed to a language model as fact about
  // this person, and the model writes it back to them in the second person. So
  // an unread read here does not produce a blank screen, it produces a
  // confident sentence: "you haven't eaten anything today, let's get some food
  // in" to somebody who has eaten three meals, or "your streak is at 0" to
  // somebody on forty days. `readinessScore` already refuses to invent from a
  // null sleep or a null hydration for exactly this reason — the training-load
  // input has no null channel, so the gate has to be here.
  const { log, status: logStatus } = useWorkoutLog();
  const { consumed, status: foodStatus } = useFoodLog();
  const logWhole = isWhole(logStatus);
  const foodWhole = isWhole(foodStatus);
  // What the member reads a load in, so the model does not speak kilograms to
  // somebody who has never used one. Every other screen was converted for
  // TF-37; this one still said "kg" through the model's mouth.
  const wu = useSettings().weightUnit;
  // Device sleep first, exactly as the home screen does it. This read the
  // hand-typed wellness log alone, so a client with a watch syncing every night
  // had a coach that was told 'readiness: not enough data' and never heard about
  // their sleep at all — while the same client's Recovery screen listed the week.
  const _devSleep = useDeviceSleep();
  const _sleepFor = readinessSleep(_devSleep.nights, sleep, 3);
  // null, not 7 - the coach was being told a readiness score derived from a
  // sleep figure nobody recorded, and repeating it back as fact.
  const _avgSleep = _sleepFor.avgHours;
  const _since2d = Date.now() - 2 * 86400000;
  const _load2d = new Set(log.filter((e) => Date.parse(e.t) >= _since2d).map((e) => e.t.slice(0, 10))).size;
  // `: 0` was the bug the home screen already had fixed: a client with no water
  // goal set was reported to the coach as zero percent hydrated, which scores as
  // badly as a client who drank nothing all day. Unknown travels as null.
  //
  // The `logWhole` gate this screen used to hold by hand is now inside
  // `readinessScore`, which takes `number | null` for the load and withholds the
  // score rather than scoring an unread log as maximally rested. The gate is
  // kept here as the null it passes, so the two screens cannot drift apart
  // again — and `logWhole` is still read below, for the streak and the last
  // exercise, which have no such channel.
  //
  // `waterStatus` closes the same hole on the hydration side: `water` is 0 while
  // the count is unread, and 0 over a goal the client did set is not "they drank
  // nothing", it is "we do not know".
  const _readiness = readinessScore({
    avgSleepHours: _avgSleep,
    hydrationPct: waterGoal && isWhole(waterStatus) ? water / waterGoal : null,
    workoutsLast2Days: logWhole ? _load2d : null,
  });
  const _streak = currentStreak(log);
  const _lastEx = logWhole && log.length ? log[0].exercise : '';
  const _prog = logWhole ? suggestProgression(log, wu)[0] : undefined;
  // How this client is coached, in a sentence the model can act on.
  //
  // It was never sent, so the AI coach gave identical answers to someone whose
  // trainer is standing next to them on Tuesday and to someone training alone
  // with nobody to ask — "get a spotter", "ask your coach to check your setup"
  // and "book a session" were all offered regardless of whether any of it was
  // available. The three coached answers differ in exactly one way that matters
  // to advice: who is in the room, and when.
  const coaching =
    cd.coachingMode === 'solo' ? 'training alone — no coach to refer them to'
    : cd.coachingMode === 'inperson' ? 'coached in person — their coach is in the room for their booked sessions'
    : cd.coachingMode === 'hybrid' ? 'coached in person for booked sessions and remotely in between — some weeks they train alone'
    : 'coached remotely — their coach writes the plan but is never in the room';

  const context = {
    coaching,
    name: cd.name, goal: cd.goal, diet: cd.diet, weightKg: cd.weightKg != null ? Math.round(cd.weightKg * 10) / 10 : 'not recorded',
    bodyFatPct: cd.bodyFatPct, muscleKg: cd.muscleKg, mealsPerDay: cd.mealsPerDay,
    kcal: macros?.kcal ?? 'not set', protein: macros?.protein ?? 'not set', carbs: macros?.carbs ?? 'not set', fat: macros?.fat ?? 'not set',
    programTitle: program.title, programFocus: program.focus.join(', '),
    // What the score is made of travels with it. A model handed a bare 83
    // will talk about hydration whether or not hydration was in the scale,
    // because the number looks like it covers everything.
    readiness: _readiness
      ? `${_readiness.score}/100 (${_readiness.label}), ${readinessMadeOf(_readiness).toLowerCase()}`
      : logWhole ? 'not enough data' : 'their training log could not be read, so readiness is unknown — do not treat it as rested',
    // Said plainly, with where it came from. A coach that knows the watch
    // measured 5.2 hours can talk about the night; one handed only a score
    // can only repeat the score back.
    sleep: _sleepFor.avgHours == null
      ? 'no nights recorded'
      : `${Math.round(_sleepFor.avgHours * 10) / 10}h average over ${_sleepFor.nights.length} night${_sleepFor.nights.length === 1 ? '' : 's'}`
        + `, ${_sleepFor.fromDevice ? `${_sleepFor.fromDevice} measured by a device` : 'none measured by a device'}`
        + `${_sleepFor.fromTyped ? `, ${_sleepFor.fromTyped} logged by hand` : ''}`,
    // "0 kcal eaten" is the answer a failed food read produces, and it is the
    // one thing on this screen a model will act on hardest.
    eatenToday: !foodWhole
      ? 'today’s food log could not be read — do not say they have eaten nothing, and do not tell them to eat on the strength of it'
      : macros ? `${num(consumed.kcal)}/${num(macros.kcal)} kcal, protein ${consumed.protein}/${macros.protein}g` : `${num(consumed.kcal)} kcal eaten, no target set`,
    streak: logWhole ? _streak : 'unknown — their training log could not be read whole',
    lastTrained: _lastEx || undefined,
    // The load in the member's own unit, through the same `liftLabel` the
    // Targets screen renders it with, rather than a hardcoded "kg" inside a
    // template string. `nextWeight` is kilograms by design — the increment
    // ladder is plate-pair metric — so the conversion belongs here, at the
    // edge, exactly as it does on every screen that prints it.
    nextLift: _prog ? `${_prog.exercise}: ${liftLabel(_prog.nextWeight, wu)} x ${_prog.nextReps} (${_prog.action})` : undefined,
    injuries: injurySummary(cd.injuries) || 'none disclosed',
    focusAreas: cd.focusAreas.length ? cd.focusAreas.join(', ') : 'none set',
  };

  // "I know your plan, targets, and latest numbers" is a promise, and it was
  // made before any of the reads behind it had come back — and kept being made
  // when they failed. The model is told the same thing in `context`, so the two
  // now agree: what it has, it has; what it could not read, it says it could
  // not read rather than treating as a zero.
  const knowsAll = logWhole && foodWhole && isWhole(cd.status);
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    { role: 'assistant', content: `Hi ${cd.name.split(' ')[0]} I'm your Repple coach. ${knowsAll ? 'I know your plan, targets, and latest numbers' : 'I have your plan and whatever of your numbers loaded'} — ask me anything about training or nutrition.` },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const params = useLocalSearchParams<{ ask?: string }>();
  const seeded = useRef(false);
  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history: ChatMsg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(history); setInput(''); setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    const reply = await askCoach(history.filter((m) => m.role === 'user' || m.role === 'assistant'), context);
    setBusy(false);
    setMsgs((m) => [...m, { role: 'assistant', content: reply ?? (coachAvailable() ? "I hit a snag reaching the coach service — try again in a moment." : "The AI coach turns on once your team deploys the coach-chat function and enables AI features. Until then, here's a tip: hit your protein target first — it protects muscle and keeps you full.") }]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
  };

  useEffect(() => {
    if (!seeded.current && params.ask === 'injury') {
      seeded.current = true;
      send('I have an injury logged that limits some exercises. Build me a safe workout plan for today that trains around it, and tell me what to avoid.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ask]);

  const G = layout.gutter;
  const { ref: barRef, lift } = useKeyboardLift();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* Measured rather than avoided — the `keyboardVerticalOffset={8}` that
          used to sit here was a constant standing in for the navigator header,
          and it was the wrong constant. See `src/ui/keyboardLift.ts`. */}
      <View style={{ flex: 1, paddingBottom: lift }}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
            <Icon name="back" size={20} color={t.ink2} />
          </Pressable>
          <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={t.brandInk} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.head, color: t.ink }}>AI Coach</Text>
            <Text style={{ ...ty.caption, color: t.ink3 }}>{knowsAll ? 'Knows your plan & numbers' : 'Working from what loaded'}</Text>
          </View>
        </View>
        <Rule />

        {/* ── the conversation ───────────────────────────────────────────── */}
        <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} keyboardShouldPersistTaps="handled">
          {msgs.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: sp.md }}>
              <View style={{ maxWidth: '82%', backgroundColor: m.role === 'user' ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                <Text style={{ ...ty.body, color: m.role === 'user' ? t.brandInk : t.ink }}>{m.content}</Text>
              </View>
            </View>
          ))}
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 2 }}>
              <ActivityIndicator color={t.brand} size="small" />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Coach is thinking…</Text>
            </View>
          ) : null}
          {msgs.length <= 1 ? (
            <View style={{ marginTop: sp.md, gap: sp.sm }}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => send(s)} accessibilityRole="button" accessibilityLabel={s}
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>

        {/* ── composer ───────────────────────────────────────────────────── */}
        <Rule />
        <View ref={barRef} style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'flex-end' }}>
          <TextInput value={input} onChangeText={setInput} placeholder="Ask your coach…" placeholderTextColor={t.ink3} multiline
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md, maxHeight: 120 }} />
          <Pressable onPress={() => send(input)} disabled={!input.trim() || busy}
            accessibilityRole="button" accessibilityLabel="Send message"
            style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: input.trim() && !busy ? t.brand : t.surface3, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...ty.head, color: t.brandInk }}>↑</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
