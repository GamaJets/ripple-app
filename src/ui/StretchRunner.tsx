// Following a stretch routine, one position at a time.
//
// The third runner in this app and deliberately the thinnest. `SessionRunner`
// walks a lifting programme and `TimedSessionRunner` puts a clock on a cardio
// or recovery session; this walks a fixed list of positions and counts each one
// down. Everything it decides about WHAT to do — the order, the hold, which
// stretches are done on both sides, how long the whole thing takes and what is
// written to the log — is in src/lib/stretchRoutine.ts, where it can be
// asserted. What is left here is the clock, the picture and the buttons.
//
// ── It borrows the rest timer's countdown rather than growing a second ─────
//
// `shouldTick` and `restClock` come from src/lib/restTimer.ts, and so does the
// shape around them: a wall-clock instant for the end rather than a count of
// ticks, a 500 ms interval that reads it, and the tick fired on the TRANSITION
// into a second because the interval sees every second twice. That module's
// header explains each of those; none of it is re-litigated here.
//
// Sound goes through `playSound`, which asks `restSoundConsent()` itself. There
// is one way to make a noise in this app and it asks — so this file does not
// read the preference, exactly as the rest timer's own comment says of itself.
//
// ── Where it deliberately DIFFERS from the rest timer ─────────────────────
//
// The rest timer keeps running when the phone goes in a pocket, and must: the
// rest is passing whether anybody is watching or not, and the whole point of
// storing a wall-clock end is that a backgrounded phone comes back to the right
// number. A stretch is the opposite. If the phone is face down on the sofa the
// stretch is NOT happening, so time passing would silently tick through two
// positions and write minutes into somebody's log that they spent making tea.
//
// So this pauses when the app leaves the foreground and does not schedule a
// notification to fire from a pocket. The elapsed clock pauses with it, which
// is what makes the figure that reaches the log a measurement rather than an
// upper bound.
//
// ── The 64 static stretches are not missing anything ──────────────────────
//
// Twelve of the 76 stretches in the pack are flows and ship an animation; the
// other 64 are static holds. A still and a hold duration IS the demonstration
// of a static stretch — there is no movement being withheld — so nothing on
// this screen says "no animation", offers to fetch one, or marks those 64 in
// any way. The only thing that changes between the two is the verb, and that
// comes from `stageVerb`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, AppState, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '../theme/tokens';
import { sp, layout, radius, type as ty, numeric, value } from '../theme/scale';
import { Section, SectionHead, Rule, Cta, Ghost, Notice } from './kit';
import { Icon } from './Icon';
import { tapLight, notifySuccess } from './haptics';
import { playSound, primeSounds, releaseSounds } from './sounds';
import { restClock, shouldTick } from '../lib/restTimer';
import { useExerciseDetail } from './exerciseDetail';
import { useExerciseMedia } from './useExerciseMedia';
import { DemoAnimation, FrameLoop } from './ExerciseDemo';
import {
  routineStages, routineMinutes, routineSummary, stageProgress, sideLabel,
  stageVerb, isLastStage, nextStageIndex, loggableMinutes,
  type StretchRoutine,
} from '../lib/stretchRoutine';

/**
 * The picture for the position on screen.
 *
 * Split out so the media hooks are keyed to ONE stretch and re-run when the
 * stage changes. Inlined into the runner they would have to be called with the
 * current stage's name from the middle of a component that also holds a timer,
 * and a hook whose argument changes under it is where the empty box comes from.
 *
 * Its own load status is not surfaced as an error. There is no retry worth
 * offering mid-routine — the person is standing in the position, the name and
 * the countdown are both on screen, and a red box under them would be telling
 * somebody something is broken about a stretch they are successfully doing.
 */
function StagePicture({ t, name }: { t: Theme; name: string }) {
  const { detail } = useExerciseDetail(name);
  const media = useExerciseMedia(detail);
  const cue = detail?.instructions?.[0] ?? null;

  return (
    <View>
      {media.animUrl ? (
        <DemoAnimation uri={media.animUrl} label={name} stillUrls={media.frames} cacheKey={media.animCacheKey ?? undefined} />
      ) : media.frames.length ? (
        <FrameLoop urls={media.frames} label={name} />
      ) : (
        // No picture for this row. Marked rather than blank, and worded as a
        // gap in our artwork rather than as a fault: an empty rounded rectangle
        // and a broken one look identical, and only one of them is true.
        <View
          accessibilityRole="image"
          accessibilityLabel={`No illustration of ${name}`}
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', gap: sp.sm }}
        >
          <Icon name="dumbbell" size={26} color={t.ink3} />
          <Text style={{ ...ty.caption, color: t.ink3 }}>We have no picture of this one yet.</Text>
        </View>
      )}
      {cue ? (
        <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{cue}</Text>
      ) : null}
    </View>
  );
}

export function StretchRunner({ t, routine, onSave, onClose }: {
  t: Theme;
  routine: StretchRoutine;
  /**
   * Resolves whether the server took the session.
   *
   * The runner does NOT write to the log itself. `commitSession` in
   * app/(client)/workouts.tsx is the one write path for every non-strength
   * session and its own comment says why — "a second writer would only be a
   * second chance to get it subtly different". A stretch routine is a Mobility
   * session named "Stretching", written down exactly the path Train's Mobility
   * chip has always used, so it carries the same MET-derived calorie estimate
   * and lands in the same shape the calendar and the weekly report already
   * read.
   *
   * False leaves the finish screen up, with its Save button still on it. The
   * timed runner learned that the hard way: it used to close on the tap, so a
   * refused write shut the only screen holding the session.
   */
  onSave: (mins: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);

  const stages = useMemo(() => routineStages(routine), [routine]);
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(stages[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // ── the clocks ──────────────────────────────────────────────────────────
  //
  // Two of them, and they are genuinely different questions. `stageEndsAt`
  // answers "how much of this position is left", and resets at every stage.
  // The elapsed pair answers "how long has this person been stretching", and
  // must survive every stage change, skip and pause — it is the figure that
  // reaches the log.
  //
  // Both are wall-clock instants rather than counters, for the reason
  // restTimer.ts sets out: an interval is only a decision about how often to
  // look at the clock, never the clock itself.
  const stageEndsAt = useRef<number | null>(null);
  /** Milliseconds of ACTIVE stretching banked before the current run began. */
  const bankedMs = useRef(0);
  /** When the current active stretch of time started, or null while paused. */
  const segmentFrom = useRef<number | null>(null);
  /** Seconds left at the last reading, so a tick fires on the transition into a
   *  second rather than each of the two times that second is observed. */
  const prevLeft = useRef<number | null>(null);

  const elapsedNow = useCallback(
    () => Math.floor((bankedMs.current + (segmentFrom.current != null ? Date.now() - segmentFrom.current : 0)) / 1000),
    [],
  );

  const pause = useCallback(() => {
    if (segmentFrom.current != null) {
      bankedMs.current += Date.now() - segmentFrom.current;
      segmentFrom.current = null;
    }
    // Freeze the countdown where it is by dropping the end instant. `left` is
    // already state and simply stops being recomputed, so the number on screen
    // is the number it resumes from.
    stageEndsAt.current = null;
    prevLeft.current = null;
    setRunning(false);
    setElapsedSec(elapsedNow());
  }, [elapsedNow]);

  const resume = useCallback(() => {
    segmentFrom.current = Date.now();
    stageEndsAt.current = Date.now() + Math.max(0, left) * 1000;
    prevLeft.current = null;
    setRunning(true);
  }, [left]);

  /** Move to a stage and put a full hold back on its clock. Skipping forward
   *  and stepping back both land here, so a position re-entered is always
   *  offered its whole duration rather than whatever was left of it. */
  const goTo = useCallback((next: number, keepRunning: boolean) => {
    const stage = stages[next];
    if (!stage) return;
    setIdx(next);
    setLeft(stage.seconds);
    prevLeft.current = null;
    stageEndsAt.current = keepRunning ? Date.now() + stage.seconds * 1000 : null;
    if (keepRunning && segmentFrom.current == null) segmentFrom.current = Date.now();
    setRunning(keepRunning);
  }, [stages]);

  const finish = useCallback(() => {
    if (segmentFrom.current != null) {
      bankedMs.current += Date.now() - segmentFrom.current;
      segmentFrom.current = null;
    }
    stageEndsAt.current = null;
    setRunning(false);
    setElapsedSec(elapsedNow());
    setFinished(true);
    notifySuccess();
  }, [elapsedNow]);

  // Decode the two tones when the routine opens rather than when the first
  // countdown ends. Decoding a file at the instant a cue is due makes the cue
  // late, and a late cue is a wrong one. Released on the way out because each
  // player holds a native object and a decoded buffer.
  useEffect(() => {
    primeSounds();
    return () => { releaseSounds(); };
  }, []);

  // Away from the foreground is not stretching — see the header. Paused rather
  // than left running, so a routine abandoned mid-position does not go on
  // counting positions nobody is in.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') pause();
    });
    return () => { sub.remove(); };
  }, [pause]);

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      const end = stageEndsAt.current;
      setElapsedSec(elapsedNow());
      if (end == null) return;
      const rest = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (rest === 0) {
        stageEndsAt.current = null;
        prevLeft.current = null;
        setLeft(0);
        // The same chime that ends a rest, for the same reason: the phone is on
        // the floor beside somebody looking at the ceiling, and the countdown
        // is the one thing on this screen nobody is watching.
        tapLight();
        playSound('restOver');
        const next = nextStageIndex(stages, idx);
        if (next == null) finish();
        else goTo(next, true);
        return;
      }
      if (shouldTick(rest, prevLeft.current)) playSound('countdown');
      prevLeft.current = rest;
      setLeft(rest);
    }, 500);
    return () => clearInterval(tick);
  }, [running, idx, stages, elapsedNow, finish, goTo]);

  const discard = () => {
    Alert.alert(
      'Leave this routine?',
      `${restClock(elapsedSec)} so far. Nothing is written to your log.`,
      [{ text: 'Keep stretching', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: onClose }],
    );
  };

  /* ── the finish screen ─────────────────────────────────────────────────── */

  if (finished) {
    // The MEASURED clock, never the routine's estimate — see `loggableMinutes`.
    const mins = loggableMinutes(elapsedSec);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 10 }}>
          <View style={{ alignItems: 'center', marginTop: sp.xl }}><Icon name="check" size={40} color={t.brand} /></View>
          <Text style={{ ...ty.title, color: t.ink, textAlign: 'center', marginTop: sp.md }}>{routine.title}</Text>
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>{restClock(elapsedSec)} on the clock</Text>

          <Section>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              This is saved as a mobility session called Stretching — the same entry Train&apos;s Mobility chip makes, so it
              counts once and shows up on your calendar the way your other mobility sessions do.
            </Text>
          </Section>

          {mins > 0 ? (
            <Cta label={saving ? 'Saving…' : 'Save to Your Log'} wide onPress={() => {
              if (saving) return;
              setSaving(true);
              void onSave(mins).finally(() => setSaving(false));
            }} />
          ) : (
            <View>
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginBottom: sp.md }}>
                Under a minute of stretching — too short to log, and rounding it up to one would be a figure you did not spend.
              </Text>
              <Cta label="Close" wide onPress={onClose} />
            </View>
          )}
          <View style={{ marginTop: sp.md, alignItems: 'center' }}>
            {/* Confirmed, like the timed runner's. At this point the routine
                is finished and NOT saved, so this is the one tap on the screen
                that can lose it. */}
            {mins > 0 ? <Ghost label="Discard" onPress={() => Alert.alert(
              'Discard this stretch session?',
              `${restClock(elapsedSec)} on the clock. Nothing is written to your log.`,
              [{ text: 'Keep it', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onClose }],
            )} /> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── a routine with nothing in it ──────────────────────────────────────── */

  const stage = stages[idx];
  if (!stage) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: topPad + 10 }}>
          <Notice tone={t.s3} kicker="Stretch" title="This routine has nothing in it"
            note="That is a fault on our side rather than anything you did. Pick another routine and we will look at this one." />
          <View style={{ marginTop: layout.section }}>
            <Cta label="Close" wide onPress={onClose} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── the position on screen ────────────────────────────────────────────── */

  const side = sideLabel(stage.side);
  const last = isLastStage(stages, idx);
  const started = running || left < stage.seconds || idx > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>{routine.title}</Text>
          <Ghost label="Discard" onPress={discard} />
        </View>

        {/* What position this is, which side, and how far in — said plainly and
            first. The report on the guided lifting session was that a started
            workout never told you which workout it was. */}
        <Text style={{ ...ty.title, color: t.ink }}>{stage.step.name}</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>
          {side ? `${side} · ${stageProgress(stages, idx, routine)}` : stageProgress(stages, idx, routine)}
        </Text>

        <View style={{ marginTop: layout.section }}>
          <StagePicture t={t} name={stage.step.name} />
        </View>

        {/* The countdown. `restClock` builds it, so the digits somebody watches
            here and the digits between sets are drawn by one function. */}
        <View style={{ alignItems: 'center', marginTop: layout.section }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>{stageVerb(stage.step)}</Text>
          <Text style={{ ...value(56), color: running ? t.ink : t.ink3, marginTop: sp.xs }}>{restClock(left)}</Text>
          {!running ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
              {started ? 'Paused. The clock stops when the app is not on screen, so a routine you walk away from is not counted.' : 'Get into position, then start the clock.'}
            </Text>
          ) : null}
        </View>

        <View style={{ marginTop: layout.section }}>
          {running
            ? <Cta label={last ? 'Finish' : 'Next Stretch'} wide onPress={() => {
                tapLight();
                const next = nextStageIndex(stages, idx);
                if (next == null) finish(); else goTo(next, true);
              }} />
            : <Cta label={started ? 'Resume' : 'Start Routine'} wide onPress={() => { tapLight(); resume(); }} />}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.xl, marginTop: sp.lg }}>
          {idx > 0 ? <Ghost label="Back" onPress={() => { tapLight(); goTo(idx - 1, running); }} /> : null}
          {running ? <Ghost label="Pause" onPress={() => { tapLight(); pause(); }} /> : null}
          {!last ? <Ghost label="Skip" onPress={() => { tapLight(); const next = nextStageIndex(stages, idx); if (next != null) goTo(next, running); }} /> : null}
        </View>

        <Rule />

        {/* What is still to come. A routine you cannot see the end of is one
            people stop halfway through, and the list is short enough to show
            whole rather than as a count. */}
        <Section>
          <SectionHead title="The Rest of the Routine" note={routineSummary(routine)} />
          {routine.steps.map((s, n) => {
            const done = n < stage.stepIndex;
            const now = n === stage.stepIndex;
            return (
              <View key={`${s.id}-${n}`} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm }}>
                <View style={{ width: 18, alignItems: 'center' }}>
                  {done ? <Icon name="check" size={14} color={t.brand} /> : <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: now ? t.brand : t.ring }} />}
                </View>
                <Text style={{ ...ty.label, color: now ? t.ink : t.ink3, fontWeight: now ? '500' : '400', flex: 1 }}>{s.name}</Text>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                  {s.sides === 2 ? `${s.holdSec}s each side` : `${s.holdSec}s`}
                </Text>
              </View>
            );
          })}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            About {routineMinutes(routine)} minutes end to end, allowing for getting into each position. Stretch to mild
            tension and never into pain, and stop if anything sharpens.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
