// AI Coach — a chat that knows the client's stats, goal, program & targets.
// Powered by the coach-chat edge function; graceful canned reply until deployed.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero and no cards — a chat screen's content is the
// conversation, so the bubbles carry the ink and the chrome recedes to a
// hairline. Every provider, conditional and route is unchanged.
import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule } from '../../src/ui/kit';
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
import { readinessScore, readinessSleep } from '../../src/lib/readiness';
import { useDeviceSleep } from '../../src/ui/deviceSleep';
import { suggestProgression } from '../../src/lib/progression';
import { currentStreak } from '../../src/lib/streaks';

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
  const { water, waterGoal } = useHabits();
  const { log } = useWorkoutLog();
  const { consumed } = useFoodLog();
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
  const _readiness = readinessScore({ avgSleepHours: _avgSleep, hydrationPct: waterGoal ? water / waterGoal : null, workoutsLast2Days: _load2d });
  const _streak = currentStreak(log);
  const _lastEx = log.length ? log[0].exercise : '';
  const _prog = suggestProgression(log)[0];
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
    readiness: _readiness ? `${_readiness.score}/100 (${_readiness.label})` : 'not enough data',
    // Said plainly, with where it came from. A coach that knows the watch
    // measured 5.2 hours can talk about the night; one handed only a score
    // can only repeat the score back.
    sleep: _sleepFor.avgHours == null
      ? 'no nights recorded'
      : `${Math.round(_sleepFor.avgHours * 10) / 10}h average over ${_sleepFor.nights.length} night${_sleepFor.nights.length === 1 ? '' : 's'}`
        + `, ${_sleepFor.fromDevice ? `${_sleepFor.fromDevice} measured by a device` : 'none measured by a device'}`
        + `${_sleepFor.fromTyped ? `, ${_sleepFor.fromTyped} logged by hand` : ''}`,
    eatenToday: macros ? `${consumed.kcal}/${macros.kcal} kcal, protein ${consumed.protein}/${macros.protein}g` : `${consumed.kcal} kcal eaten, no target set`,
    streak: _streak,
    lastTrained: _lastEx || undefined,
    nextLift: _prog ? `${_prog.exercise}: ${_prog.nextWeight}kg x ${_prog.nextReps} (${_prog.action})` : undefined,
    injuries: injurySummary(cd.injuries) || 'none disclosed',
    focusAreas: cd.focusAreas.length ? cd.focusAreas.join(', ') : 'none set',
  };

  const [msgs, setMsgs] = useState<ChatMsg[]>([
    { role: 'assistant', content: `Hi ${cd.name.split(' ')[0]} I'm your Repple coach. I know your plan, targets, and latest numbers — ask me anything about training or nutrition.` },
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>

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
            <Text style={{ ...ty.caption, color: t.ink3 }}>Knows your plan &amp; numbers</Text>
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
        <View style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'flex-end' }}>
          <TextInput value={input} onChangeText={setInput} placeholder="Ask your coach…" placeholderTextColor={t.ink3} multiline
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md, maxHeight: 120 }} />
          <Pressable onPress={() => send(input)} disabled={!input.trim() || busy}
            accessibilityRole="button" accessibilityLabel="Send message"
            style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: input.trim() && !busy ? t.brand : t.surface3, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...ty.head, color: t.brandInk }}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
