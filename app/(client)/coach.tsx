// AI Coach — a chat that knows the client's stats, goal, program & targets.
// Powered by the coach-chat edge function; graceful canned reply until deployed.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero and no cards — a chat screen's content is the
// conversation, so the bubbles carry the ink and the chrome recedes to a
// hairline. Every provider, conditional and route is unchanged.
//
// ── The conversation is kept now, and it is kept HERE ─────────────────────
//
// It used to live in one `useState` and nothing else: no table, no key, no
// provider. Tapping Back threw away everything the member had asked and
// everything they had been told, so an answer about training around a knee had
// to be asked for again at the rack.
//
// It is now in AsyncStorage under this account, through `useCoachChat` —
// on the phone rather than in the database, and src/lib/coachChat.ts holds
// the argument for that in full. The short of it: the replies here are written
// from this member's body, sleep, readiness and injuries and come back in the
// second person, so the thread is a second copy of exactly what
// src/lib/coachShare.ts gates — and `WHERE_IT_GOES`, which is on this screen
// above the two buttons, ends "and it is not sent to your gym."
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
import { num } from '../../src/lib/format';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Alert, AccessibilityInfo } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Notice, Flag, Cta, Ghost } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
// 44pt, from the one place that holds the number. See the send button below.
import { MIN_TARGET } from '../../src/lib/a11y';
import { useClientData } from '../../src/ui/clientData';
// `sharedInjuries`, NOT `injurySummary`. The difference is the note, and the
// note is seeded from the line off a physiotherapy report — see the header of
// src/lib/coachShare.ts.
import { sharedInjuries } from '../../src/lib/coachShare';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { buildProgram } from '../../src/lib/programs';
import { askCoachForMember, coachAvailable, type ChatMsg } from '../../src/lib/coach';
import { useCoachShare } from '../../src/ui/coachShare';
import { useCoachChat } from '../../src/ui/coachChat';
import { THREAD_KEPT_NOTE, WITHDRAWN_THREAD_NOTE } from '../../src/lib/coachChat';
import {
  ALWAYS_SENT, SENT_WITH_PERMISSION, NEVER_SENT, WHERE_IT_GOES,
  CONSENT_TITLE, CONSENT_BODY, WITHHELD_NOTE, NOT_MEDICAL_ADVICE,
} from '../../src/lib/coachShare';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useFoodLog } from '../../src/ui/foodLog';
import { readinessMadeOf } from '../../src/lib/readiness';
import { useReadiness } from '../../src/ui/readiness';
import { suggestProgression } from '../../src/lib/progression';
import { shownStreak } from '../../src/lib/streaks';
import { isWhole } from '../../src/ui/loadStatus';
import { liftLabel } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { BACK_ICON } from '../../src/ui/direction';

const SUGGESTIONS = ['What should I eat post-workout?', "I'm sore today — should I still train?", 'Am I on track for my goal?', 'Give me a quick high-protein snack'];

export default function Coach() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const assigned = useAssignedPrograms();
  const coachProgram = assigned.getProgram(cd.id);
  const coachNutrition = useCoachNutrition();
  const _adj = coachNutrition.get(cd.id);
  // null until there is a body to scale to. This used to run on the 70 kg /
  // 20% placeholder from clientData and present the result as the client's
  // own daily targets.
  const macros = (cd.weightKg != null && cd.bodyFatPct != null)
    ? applyCoachAdjust(macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet }), cd.coachingMode === 'solo' ? undefined : (_adj || undefined))
    : null;
  const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
  // Every line of `context` below is handed to a language model as fact about
  // this person, and the model writes it back to them in the second person. So
  // an unread read here does not produce a blank screen, it produces a
  // confident sentence: "you haven't eaten anything today, let's get some food
  // in" to somebody who has eaten three meals, or "your streak is at 0" to
  // somebody on forty days. `readinessScore` already refuses to invent from a
  // null sleep or a null hydration for exactly this reason — the training-load
  // input has no null channel, so the gate has to be here.
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const { consumed, status: foodStatus, reload: reloadFood } = useFoodLog();
  // What this coach is told about the member — the profile, the assigned
  // programme, the coach's own macro adjustment, the training log and today's
  // food — is read once at mount and shown verbatim under "What Gets Sent". A
  // workout logged in the last ten minutes was not in it, and there was no way
  // to bring it in short of killing the app.
  const pull = usePullToRefresh(useCallback(() => {
    cd.reload(); assigned.reload(); void coachNutrition.reload(); reloadLog(); reloadFood();
  }, [cd.reload, assigned, coachNutrition, reloadLog, reloadFood]));
  const logWhole = isWhole(logStatus);
  const foodWhole = isWhole(foodStatus);
  // What the member reads a load in, so the model does not speak kilograms to
  // somebody who has never used one. Every other screen was converted for
  // TF-37; this one still said "kg" through the model's mouth.
  const wu = useSettings().weightUnit;
  // Readiness and its inputs, from the one shared derivation the home screen
  // and Recovery also read (src/ui/readiness.ts).
  //
  // This screen used to assemble it by hand, and so did the home screen, and
  // the two drifted in both directions: this one gated the training log for
  // months while the home screen's hero rose whenever that log failed to load,
  // and the home screen read device nights while this one read the typed log
  // alone — so a client with a watch syncing every night had a coach that was
  // told "readiness: not enough data" and never heard about their sleep.
  //
  // Every line of `context` below is handed to a language model as fact about
  // this person and comes back to them in the second person, so a figure with
  // an unread source behind it is not a slightly-off number here, it is a
  // confident sentence. That is why `caveats` travels with the score.
  const { readiness: _readiness, sleep: _sleepFor, breakdown: _made } = useReadiness();
  // The figure the member's own screens show them. The AI coach speaks to
  // them in the second person, so a streak here that disagrees with the ring
  // on Home is the model telling them something about themselves that their
  // app has just denied.
  const _streak = shownStreak(log);
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

  // Everything below is a candidate for sending. What actually goes is decided
  // by the allowlist in src/lib/coachShare.ts and applied inside
  // `askCoachForMember` — a field added here and not added there is not
  // transmitted, which is deliberately the safe direction.
  //
  // `name` used to be the first field and it is gone. The model was told "Name:
  // Sarah Whitfield" and then handed her weight, her body fat, her sleep and
  // her injuries, which makes the payload a named medical record rather than a
  // set of figures. It was never needed: the greeting below is built on this
  // phone from `cd.name` and always was, so nothing the member sees changes.
  const context = {
    coaching,
    goal: cd.goal, diet: cd.diet, weightKg: cd.weightKg != null ? Math.round(cd.weightKg * 10) / 10 : 'not recorded',
    bodyFatPct: cd.bodyFatPct, muscleKg: cd.muscleKg, mealsPerDay: cd.mealsPerDay,
    kcal: macros?.kcal ?? 'not set', protein: macros?.protein ?? 'not set', carbs: macros?.carbs ?? 'not set', fat: macros?.fat ?? 'not set',
    programTitle: program.title, programFocus: program.focus.join(', '),
    // What the score is made of travels with it. A model handed a bare 83
    // will talk about hydration whether or not hydration was in the scale,
    // because the number looks like it covers everything.
    readiness: _readiness
      ? `${_readiness.score}/100 (${_readiness.label}), ${readinessMadeOf(_readiness).toLowerCase()}`
      : _made.absence ?? 'not enough data',
    // What the score could NOT see. A model handed 84 with a dead WHOOP behind
    // it will talk about how well rested they are, and every signal readiness
    // scores counts against the member — so a night we failed to read can only
    // have flattered the number it is about to congratulate them on.
    readinessGaps: _made.caveats.length
      ? `${_made.caveats.join(' ')} Do not present the score as the whole picture.`
      : undefined,
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
    // Area and severity. NOT `injurySummary`, which appends the note — and the
    // note is what `candidateNote` in src/lib/injuryExtract.ts seeds with the
    // matched line off an uploaded physiotherapy report. The member wrote that,
    // or accepted it, for their coach. It is not a thing to post to a model,
    // and there is no toggle that makes it one.
    injuries: sharedInjuries(cd.injuries) || 'none disclosed',
    focusAreas: cd.focusAreas.length ? cd.focusAreas.join(', ') : 'none set',
  };

  // "I know your plan, targets, and latest numbers" is a promise, and it was
  // made before any of the reads behind it had come back — and kept being made
  // when they failed. The model is told the same thing in `context`, so the two
  // now agree: what it has, it has; what it could not read, it says it could
  // not read rather than treating as a zero.
  //
  // It answers to the CONSENT as well, for the same reason. A coach that was
  // sent no body composition, no sleep and no injuries opening with "I know
  // your latest numbers" is the identical false promise arriving by the other
  // route — and it is the one the member themselves just chose, so it would
  // read as the app having ignored them.
  const knowsAll = logWhole && foodWhole && isWhole(cd.status);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Say that the question went.
  //
  // Everything this screen does between send and answer is visual — the input
  // empties, a spinner appears, a line of grey text says "Coach is thinking…" —
  // and a member using VoiceOver gets none of it. They press send and hear
  // nothing at all for several seconds, on a screen where the ordinary thing to
  // conclude is that the button did not work and to press it again.
  // `announceForAccessibility` is the only route on iOS: React Native's
  // `accessibilityLiveRegion` is Android-only, and it is set on the block below
  // for the platform that reads it. Guarded on `busy` so nothing is announced
  // when the screen simply mounts.
  useEffect(() => {
    if (busy) AccessibilityInfo.announceForAccessibility('Sent. Your coach is thinking.');
  }, [busy]);
  const scroller = useRef<ScrollView>(null);

  // The member's answer about their health details, read from the device once.
  // 'unknown' while that read is in flight and 'unasked' when it came back
  // empty; nothing is sent on either, and the composer is not offered on
  // either. See src/ui/coachShare.tsx.
  const { consent, answer } = useCoachShare();
  const answered = consent === 'yes' || consent === 'no';
  // Whether the "what leaves your phone" list is expanded. Collapsed after the
  // answer is given so the chat is the screen; one tap away forever, because a
  // disclosure somebody can only read once is a disclosure they cannot check.
  const [showsDetail, setShowsDetail] = useState(false);

  // The conversation, kept between visits. src/lib/coachChat.ts is the whole
  // argument for it living on this phone rather than in `coach_chats`: the
  // replies are written from this member's body, sleep and injuries and come
  // back in the second person, so a stored thread is a second copy of exactly
  // the material `src/lib/coachShare.ts` gates — and the sentence they consented
  // against ends "it is not sent to your gym."
  //
  // `ready` is the same gate everything else on this screen answers to. Nothing
  // is read while the consent is 'unknown', because restoring a health thread
  // during the window where nobody has read the answer is restoring it before
  // being allowed to.
  const thread = useCoachChat('client', { ready: answered, health: consent === 'yes' });
  const msgs = thread.msgs;

  // The greeting is derived rather than stored, and it is no longer a message.
  // It was the first element of `msgs` and had to be rewritten in place once the
  // consent read landed; now it is a line this phone draws above the
  // conversation, which is what it always was. Two things follow, both wanted:
  // it cannot be trimmed away by the thread cap, and it is not posted to the
  // model as "the replies so far" — it is our own copy, not a reply.
  const greeting = `Hi ${cd.name.split(' ')[0]} I'm your ${BRAND.label} coach. ${
    consent === 'no'
      ? 'I have your plan and your targets, and not your body, sleep or injuries, because you asked me not to'
      : knowsAll ? 'I know your plan, targets, and latest numbers'
        : 'I have your plan and whatever of your numbers loaded'
  } — ask me anything about training or nutrition.`;

  const params = useLocalSearchParams<{ ask?: string }>();
  const seeded = useRef(false);
  const send = async (text: string) => {
    const q = text.trim();
    // `thread.status` joins the guard: a question typed before the stored
    // conversation has come back would be answered against an empty history and
    // then have the restored one land underneath it.
    if (!q || busy || !answered || thread.status === 'loading') return;
    const history: ChatMsg[] = [...msgs, { role: 'user', content: q }];
    thread.set(history); setInput(''); setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    const res = await askCoachForMember(
      history.filter((m) => m.role === 'user' || m.role === 'assistant'),
      context,
      consent,
    );
    setBusy(false);
    // Three failures, three sentences. The old code had one null for all of
    // them and told everybody the service had hiccuped — including, once this
    // gate existed, somebody whose answer simply had not been read yet.
    const said = res.ok ? res.reply
      : res.reason === 'no-consent'
        ? 'I have not sent anything yet — your answer about your health details had not loaded when you asked. Try that again in a moment.'
        : res.reason === 'unavailable'
          ? "The AI coach turns on once your team deploys the coach-chat function and enables AI features. Until then, here's a tip: hit your protein target first — it protects muscle and keeps you full."
          : 'I hit a snag reaching the coach service — try again in a moment.';
    // `history` and not the current state: the only writer of this thread is
    // this function, and reading it back through a setter would race the
    // AsyncStorage write that `set` starts.
    thread.set([...history, { role: 'assistant', content: said }]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
  };

  useEffect(() => {
    // Waits for the answer. This deep link comes from the Injuries screen and
    // its whole question is about an injury, so firing it before the member has
    // said whether their injuries may be sent is the exact thing the gate
    // exists to prevent — and it would have fired on mount, before the screen
    // had even drawn the question.
    //
    // It waits for the stored thread too, for the same reason `send` does: a
    // question fired against an empty history and then buried under a restored
    // conversation is a question that appears to have been answered twice.
    if (!seeded.current && params.ask === 'injury' && answered && thread.status !== 'loading') {
      seeded.current = true;
      send('I have an injury logged that limits some exercises. Build me a safe workout plan for today that trains around it, and tell me what to avoid.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ask, answered, thread.status]);

  const G = layout.gutter;
  const { ref: barRef, lift } = useKeyboardLift();

  /* ── the list of exactly what goes, and what does not ─────────────────────
     Rendered from the arrays in src/lib/coachShare.ts rather than typed here,
     so it cannot drift from the allowlist that decides what is actually sent.
     A list somebody has read and agreed to, that no longer describes the code,
     is worse than no list — they have been told something false and have now
     consented to it. */
  const Bullets = ({ head, items, tone }: { head: string; items: string[]; tone: string }) => (
    <View style={{ marginTop: sp.md }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{head}</Text>
      {items.map((s) => (
        <View key={s} style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xs }}>
          <Text style={{ ...ty.label, color: tone }}>•</Text>
          <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{s}</Text>
        </View>
      ))}
    </View>
  );

  const Disclosure = () => (
    <View>
      <Bullets head="Always sent when you ask something" items={ALWAYS_SENT} tone={t.ink3} />
      <Bullets head="Only sent if you say yes" items={SENT_WITH_PERMISSION} tone={t.brand} />
      <Bullets head="Never sent" items={NEVER_SENT} tone={t.ink3} />
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{WHERE_IT_GOES}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* Measured rather than avoided — the `keyboardVerticalOffset={8}` that
          used to sit here was a constant standing in for the navigator header,
          and it was the wrong constant. See `src/ui/keyboardLift.ts`. */}
      <View style={{ flex: 1, paddingBottom: lift }}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
            <Icon name={BACK_ICON} size={20} color={t.ink2} />
          </Pressable>
          <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={t.brandInk} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.head, color: t.ink }}>AI Coach</Text>
            {/* The subtitle is a claim about what the model has, so it has to
                answer to the consent as well as to the reads. "Knows your plan
                & numbers" above a coach that was never sent a single one of
                those numbers is the same false promise the `knowsAll` gate was
                added to remove, arriving by the other route. */}
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {consent === 'no' ? 'Working without your numbers'
                : knowsAll ? 'Knows your plan & numbers'
                  : 'Working from what loaded'}
            </Text>
          </View>
        </View>

        {/* ── which copy of the plan the coach above is speaking from ──────
            Directly under the subtitle, because the subtitle is the claim it
            qualifies: "Knows your plan & numbers", and the greeting under it
            says "I know your plan". `program` on this screen is
            `coachProgram ?? buildProgram(…)`, `coachProgram` is `getProgram`,
            and `getProgram` serves this device's copy for up to THIRTY DAYS
            when no read has landed (src/lib/programCache.ts). So the model is
            handed `programTitle` and `programFocus` off a block the coach may
            have replaced, answers every question in the second person against
            it, and "What Gets Sent" lists it as fact.

            Placed HERE rather than over the thread on purpose: this screen has
            a second thing saved on this phone — the stored conversation — and
            the sentence would read as being about that if it sat above the
            messages. Beside the plan claim it can only be about the plan.
            Non-null for exactly as long as the copy is what is being served;
            `mayServeCached` decides that, so it needs no gate of its own. */}
        {assigned.cachedNote ? (
          <Flag tone={t.warn} style={{ marginHorizontal: G, marginBottom: sp.md }}>{assigned.cachedNote}</Flag>
        ) : null}
        <Rule />

        {/* ── the conversation ───────────────────────────────────────────── */}
        <ScrollView ref={scroller} refreshControl={pull} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} keyboardShouldPersistTaps="handled">

          {/* ── the question, before anything is sent ─────────────────────
              This screen used to post the member's weight, body fat, muscle
              mass, sleep, readiness and injuries to a language model the first
              time they tapped a suggestion, with nothing on screen saying so.
              Now nothing leaves the phone until this has an answer — including
              the injury deep link from the Injuries screen, which used to fire
              on mount. */}
          {consent === 'unknown' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <ActivityIndicator color={t.brand} size="small" />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Checking what you asked us to share…</Text>
            </View>
          ) : consent === 'unasked' ? (
            <View>
              <Notice tone={t.brand} kicker="Your data" title={CONSENT_TITLE} note={CONSENT_BODY}>
                <Disclosure />
              </Notice>
              {/* The same disclaimer the Injuries screen and the Injury
                  Document screen carry, in the same words, finally on the
                  screen that actually transmits the injuries. */}
              <Notice tone={t.s3} kicker="Guidance only" title="Not medical advice" note={NOT_MEDICAL_ADVICE} />
              <View style={{ marginTop: sp.lg, gap: sp.sm }}>
                <Cta label="Yes, Use My Numbers" onPress={() => answer('yes')} wide />
                {/* A Cta and not a Ghost. Both answers are real answers and
                    the coach works either way, so rendering the decline as a
                    whisper next to a solid Yes would be pressure dressed as
                    hierarchy. `t.surface2` is the neutral button fill three
                    other screens already use for the second of a pair. */}
                <Cta label="No, Keep Them Private" onPress={() => answer('no')} tone={t.surface2} wide />
              </View>
              {/* Said before they choose, not after. Somebody deciding needs to
                  know the cost of the safer answer, and the cost here is not
                  "less personalised" — it is a coach that cannot see an
                  injury. */}
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{WITHHELD_NOTE}</Flag>
            </View>
          ) : null}

          {/* The greeting, drawn rather than stored — see where it is built.
              It is shown as soon as the question has an answer, because it is
              about the consent and the reads and knows nothing about the
              conversation underneath it. */}
          {answered ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginBottom: sp.md }}>
              <View style={{ maxWidth: '82%', backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                <Text style={{ ...ty.body, color: t.ink }}>{greeting}</Text>
              </View>
            </View>
          ) : null}

          {/* The stored conversation is still being read. Said rather than
              drawn as an empty thread: an empty thread under a row of opening
              suggestions is this screen claiming the member has never asked it
              anything, which is the fabricated-empty-answer bug in the one
              place where the member can see it is wrong. */}
          {answered && thread.status === 'loading' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
              <ActivityIndicator color={t.brand} size="small" />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Fetching your last conversation from this phone…</Text>
            </View>
          ) : null}

          {answered && thread.status === 'partial' ? (
            <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
              An earlier conversation is saved on this phone and could not be read this time. It has been left alone rather than written over, so anything you ask now is not being kept — try again after the next restart.
            </Flag>
          ) : null}

          {answered && thread.withdrawn ? (
            <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{WITHDRAWN_THREAD_NOTE}</Flag>
          ) : null}

          {answered ? msgs.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: sp.md }}>
              <View style={{ maxWidth: '82%', backgroundColor: m.role === 'user' ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                <Text style={{ ...ty.body, color: m.role === 'user' ? t.brandInk : t.ink }}>{m.content}</Text>
              </View>
            </View>
          )) : null}
          {/* The wait, said out loud as well as drawn.
              A spinner and a line of grey text say "your question went" to
              somebody looking at the screen and nothing at all to somebody
              using a screen reader: they press send, hear silence, and the only
              evidence either way is an answer that arrives some seconds later.
              `accessibilityLiveRegion` is TalkBack's half of this and does
              nothing on iOS, where React Native has no equivalent prop — so the
              effect above announces it, and this marks it for the platform that
              can watch the tree itself. 'polite' because it interrupts nothing;
              it simply has to be said. */}
          <View accessibilityLiveRegion="polite">
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 2 }}>
                <ActivityIndicator color={t.brand} size="small" />
                <Text style={{ ...ty.caption, color: t.ink3 }}>Coach is thinking…</Text>
              </View>
            ) : null}
          </View>
          {/* Offered only when there is genuinely nothing to carry on from, and
              only once the phone has been read: a restored conversation with
              "What should I eat post-workout?" underneath it is the screen
              having forgotten the thread it is displaying. */}
          {answered && thread.status !== 'loading' && msgs.length === 0 ? (
            <View style={{ marginTop: sp.md, gap: sp.sm }}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => send(s)} accessibilityRole="button" accessibilityLabel={s}
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* ── the answer, still visible and still changeable ─────────────
              An answer given once and then buried is how a consent stops being
              one. This row states which of the two is in force, in the same
              breath as the way to change it, and the full list is one tap away
              for as long as the screen exists. */}
          {answered ? (
            <View style={{ marginTop: sp.xl, borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                {consent === 'yes'
                  ? 'Your coach can use your body, sleep and injuries. Your name and the words of any injury note never leave your phone.'
                  : 'Your coach is working without your body, sleep or injuries. Your name never leaves your phone either.'}
              </Text>
              {/* Where the conversation itself is, said on the screen that
                  keeps it. A member cannot decide to clear a record they have
                  not been told exists, and this one is health information they
                  typed — see the header of src/lib/coachChat.ts. It answers
                  to whether it is ACTUALLY being kept: nobody signed in, or a
                  stored thread we could not read, and nothing is. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {thread.kept
                  ? THREAD_KEPT_NOTE
                  : 'This conversation is not being kept — it goes when you leave the screen, and it is not stored on our servers either.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                <Ghost label={showsDetail ? 'Hide the Detail' : 'What Gets Sent'} onPress={() => setShowsDetail((v) => !v)} />
                <Ghost label={consent === 'yes' ? 'Turn It Off' : 'Turn It On'}
                  onPress={() => answer(consent === 'yes' ? 'no' : 'yes')} />
                {/* This used to go straight through, with no question, and the
                    note above it argued the case: "It is the member's own
                    conversation on the member's own phone, it is one tap to
                    start another, and a question in a box is what this app
                    reserves for a thing that cannot be undone by doing it
                    again."

                    The last clause is exactly the test, and clearing this chat
                    FAILS it. Tapping the button again does not bring the
                    conversation back. What is destroyed is not a list of
                    messages — it is what src/lib/coachChat.ts calls health
                    information the member typed: an injury described in their
                    own words, a question about a medication, the reason they
                    could not train last week, and every answer given about
                    them. It is the longest thing anybody types into this app
                    and it sits one tap from "What Gets Sent", which is a button
                    people press to read something.

                    So it gets the Alert that app/(client)/injuries.tsx states
                    as the house rule for every destructive action, and the
                    question names what goes and says plainly that it cannot be
                    got back. */}
                {msgs.length ? (
                  <Ghost label="Clear This Chat" onPress={() => Alert.alert(
                    'Clear this conversation?',
                    `All ${msgs.length} ${msgs.length === 1 ? 'message' : 'messages'} go, including everything you have told your coach about your training, your injuries and how you have been feeling. This cannot be undone and there is no copy anywhere else — ${BRAND.label} does not keep one on our servers.`,
                    [
                      { text: 'Keep It', style: 'cancel' },
                      { text: 'Clear It', style: 'destructive', onPress: () => thread.clear() },
                    ],
                  )} />
                ) : null}
              </View>
              {showsDetail ? (
                <View style={{ marginTop: sp.sm }}>
                  <Disclosure />
                  {consent === 'no' ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.md }}>{WITHHELD_NOTE}</Flag>
                  ) : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{NOT_MEDICAL_ADVICE}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* ── composer ─────────────────────────────────────────────────────
            Not rendered until the question above has an answer. A composer a
            member can type into is a promise that pressing send will do
            something, and until they have answered the only honest thing
            pressing send could do is refuse. */}
        {answered ? (
          <View>
            <Rule />
            <View ref={barRef} style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'flex-end' }}>
              <TextInput value={input} onChangeText={setInput} placeholder="Ask your coach…" placeholderTextColor={t.ink3} multiline
                accessibilityLabel="Ask your coach"
                style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md, maxHeight: 120 }} />
              {/* The arrow, and the three things wrong with it.
                  · It was `t.brandInk` in both states, so when the button went
                    to `t.surface3` to look disabled the glyph came out at
                    roughly 1.4:1 against it — under the 3:1 that
                    src/lib/a11y.ts requires of a MARK, which is what an arrow
                    with no text beside it is. The disabled pair is the kit's
                    own: `t.surface2` behind `t.ink3`, exactly as <Cta> does it,
                    so this button and every primary button in the app grey out
                    the same way and `check:contrast` measures one pair.
                  · Nothing told a screen reader it was off. `accessibilityState`
                    is what turns "Send message, button" into "Send message,
                    dimmed" — without it somebody double-taps an inert control
                    and is given no reason.
                  · "Send message" is the same three words whether the composer
                    is empty, ready, or waiting on an answer. The label now says
                    which, because that is the only feedback available to
                    somebody who cannot see the spinner above. */}
              {(() => {
                const ready = !!input.trim() && !busy;
                return (
                  <Pressable onPress={() => send(input)} disabled={!ready}
                    accessibilityRole="button"
                    accessibilityLabel={busy ? 'Sending your message' : ready ? 'Send message' : 'Send message, nothing typed yet'}
                    accessibilityState={{ disabled: !ready, busy }}
                    style={{ width: MIN_TARGET, height: MIN_TARGET, borderRadius: radius.pill, backgroundColor: ready ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...ty.head, color: ready ? t.brandInk : t.ink3 }}>↑</Text>
                  </Pressable>
                );
              })()}
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
