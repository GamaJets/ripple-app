// One exercise, explained.
//
// Reported by a trainer: "when an instructor has not provided a video for the
// exercise there should be an automation of the exercise being demo'd." Until
// now a movement with no coach clip was a dead end — the library said "No clips
// yet" and that was the whole of it, for every exercise, because the video
// table has never held a single row.
//
// ── What wins, in order ────────────────────────────────────────────────────
//
//   1. the client's OWN coach's clip — a member should see the person who
//      actually trains them demonstrating the lift;
//   2. the platform Academy clip;
//   3. the bought animation for this movement;
//   4. the catalogue's reference frames, cross-faded;
//   5. a sentence saying there is nothing, and offering to ask their coach.
//
// Rules 1 and 2 come from videoForExercise(), which already refuses to fall
// back to a stranger's clip. Rule 3 is what this screen adds. Rule 4 is the one
// that must never be dressed up as rule 3: a placeholder silhouette shown where
// we have no picture is a lie a client acts on under load.
import { useEffect, useMemo, useState, useCallback } from 'react';
// expo-image is required through src/ui/nativeModules.ts, never imported. Its
// entry point resolves to `requireNativeModule('ExpoImage')`, which THROWS on a
// binary that predates the dependency — and expo-image landed on 30 Aug, three
// days after the version last moved to 1.1.0, so every binary built 27-29 Aug
// takes today's bundle and has no ExpoImage in it. A bare import would take
// this whole screen down while it loaded. React Native's own <Image> is the
// fallback and is in every binary ever built.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from 'react-native';
import { GuardedImage } from '../../src/ui/GuardedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBackTo } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
// The demonstration renderers moved to src/ui/ExerciseDemo when the owner app
// gained an exercise screen of its own: one implementation, imported twice, so
// two members of the same gym looking at the same lift on two apps cannot end
// up seeing two different pieces of artwork.
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { videoForExercise } from '../../src/lib/exerciseId';
import { catalogueValue as cap } from '../../src/lib/format';
import { frameUrls, FRAMES_ARE_UNHOSTED, demoCaption, demoIsShippable, DEMO_BUCKET, evalAnimationUrl } from '../../src/lib/exerciseMedia';
import { supabase } from '../../src/lib/supabase';
import { useClientData } from '../../src/ui/clientData';
import { RepdbInlineCredit } from '../../src/ui/Attribution';
import { useExerciseMedia } from '../../src/ui/useExerciseMedia';
// The two things this screen could not do, and they are the two things somebody
// standing in front of the machine actually wants. `ExerciseHistoryPanel` was
// mounted on app/(client)/history.tsx and on the coach's client-training screen
// and nowhere else, so "what did I do on this last time" was three screens away
// from the movement; and the set row was a local component on Train, so this
// screen — the one reached from the library, from a demo, from a search — could
// not log anything at all.
import { ExerciseTrail } from '../../src/ui/ExerciseHistory';
import { LogSetRow } from '../../src/ui/LogSetRow';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useScrollPad } from '../../src/ui/keyboardPad';
import { pickFormClip, sendFormClip, fetchFormClip, deleteFormClip, type FormClip } from '../../src/ui/formClips';
import { MEMBER_CONSENT_NOTE, clipRefusal, clipRefusalLine } from '../../src/lib/formCheck';
import { useSettings } from '../../src/ui/settings';
import { exerciseIndex } from '../../src/lib/exerciseHistory';
import { exerciseSlug } from '../../src/lib/exerciseId';
// What this member's own coach says about this movement, every time, to
// everybody they train. Separate from the note on a particular programme day,
// which is about this member on that day and arrives with the programme.
import { fetchCoachCue, cueFor, type CueRead } from '../../src/lib/coachCues';
import { reportError } from '../../src/lib/reportError';
import { USE_SUPABASE } from '../../src/lib/config';
import { unsentNote } from '../../src/lib/offlineQueue';
import { tapLight } from '../../src/ui/haptics';
import { BACK_ICON } from '../../src/ui/direction';


export default function ExerciseScreen() {
  const t = useTheme();
  const router = useRouter();
  const { name: raw, from } = useLocalSearchParams<{ name?: string; from?: string }>();
  const goBack = useBackTo(from);
  const name = (raw || '').trim();
  const { detail, display, status, signedOut, reload: reloadDetail } = useExerciseDetail(name);
  // `status`, not just `videos`. exerciseVideos.ts says so in as many words:
  // "`[]` with status 'error' is not the same claim as `[]` with status
  // 'ready', and the screens must not conflate them." This screen conflated
  // them — a failed video read left `clip` null, fell through to the last
  // branch below, and told a client "Nobody has filmed this movement" about a
  // clip their coach uploaded last week. The catalogue read already had its own
  // error branch; the video read had none.
  const { videos, status: videoStatus, reload: reloadVideos } = useExerciseVideos();
  const cd = useClientData();

  // The client's own coach first. cd.trainerId is who actually trains them, so
  // passing it is what stops a stranger's clip being offered as theirs.
  //
  // It was read through a cast to `any` until tonight, and `useClientData` had
  // no such field: every member got `null`, and rule 1 of the clip ordering —
  // the member's OWN coach's clip wins — could not fire at all, for months,
  // with nothing failing anywhere. The field is real now (src/ui/clientData.tsx)
  // and the cast is gone, which is what stops it vanishing again silently: a
  // rename is a type error now rather than a quiet null. The dependency is
  // `cd.trainerId` and not `cd` because that is the only part of the context
  // this memo reads, and the context object's identity changes whenever any
  // unrelated field of the profile does.
  const clip = useMemo(
    () => videoForExercise(name, videos, cd.trainerId),
    [name, videos, cd.trainerId],
  );
  // The bought animation, signed like a coach's own clip.
  //
  // Gated on the licence recorded against the row, not on anything this screen
  // knows: an evaluation asset from a CC BY-NC preview bundle renders while
  // somebody is deciding whether to buy the pack, and never in a build that
  // reaches a real person. __DEV__ is the only thing that distinguishes them,
  // and it is the one flag that cannot be wrong in a release binary.
  // One hook for all three apps. Media resolution lived in each screen and
  // that is the shape that already produced a client app and a coach app
  // disagreeing about the name of a muscle — worse here, because a picture
  // that fails to resolve is an empty box with no error to read.
  const { frames, animUrl, animCacheKey, equipmentUrl } = useExerciseMedia(detail);
  const caption = demoCaption(detail?.source, frames.length);

  // ── this member's own record of this movement ──────────────────────────
  const { log, status: logStatus, unsent: unsentSets, logWorkouts, reload: reloadLog } = useWorkoutLog();
  /* ── a clip of the set just logged ───────────────────────────────────────
     Offered HERE and not on Train, because this screen is already about one
     movement — which is exactly when somebody wonders whether they are doing
     it right. The set logged from this screen is its own `workouts` row with a
     single set, so the clip's (workout_id, set_index) is that row and 0.

     Held by timestamp and name rather than by id, because the id does not
     exist yet at the moment it is logged: `send` in src/ui/workoutLog.tsx
     adopts the server's id into the entry a moment after the write lands, and
     this looks it up when it is there. Until then the block says it is still
     saving rather than offering a button that would attach to nothing. */
  const pad = useScrollPad();
  const [clipFor, setClipFor] = useState<{ t: string; exercise: string } | null>(null);
  const [clipNote, setClipNote] = useState('');
  const [clipBusy, setClipBusy] = useState(false);
  const [clipSaid, setClipSaid] = useState<string | null>(null);
  /* The clip now on that set, once one is there. Held so the member can remove
     it — `MEMBER_CONSENT_NOTE` promises they can delete it at any time, and a
     promise with no control behind it is worse than not making it. */
  const [clipSent, setClipSent] = useState<FormClip | null>(null);
  const clipWorkoutId = clipFor
    ? (log.find((e) => e.t === clipFor.t && e.exercise === clipFor.exercise)?.id ?? null)
    : null;
  /* ── this member's coach's cue for this movement ─────────────────────────
   *
   * No coach id is sent, and that is the security property rather than a
   * convenience: the select policy in supabase/parts/3150 admits exactly the
   * rows whose `coach_id` is the trainer of the signed-in client, so there is
   * no argument this screen could carry that would widen it to a stranger's
   * cues. (`cd.trainerId` is read a hundred lines above for the clip. It used
   * to be cast through `any`, did not exist on `useClientData`, and was always
   * null; both are fixed. Nothing here depends on it either way.)
   *
   * ── This read must not be able to take the screen down ─────────────────
   *
   * supabase/parts/3150 is not applied to any database as this ships, and
   * PostgREST answers a select naming a table absent from its schema cache
   * with PGRST205 — measured against this project's own REST endpoint. So the
   * read is not attempted at all without a server, and where it is attempted
   * `fetchCoachCue` turns that code (and 42P01) into 'absent' and throws
   * everything else. 'absent' draws NOTHING: there is no cue to show and no
   * sentence is owed to a member about a feature their coach has not been
   * given yet. A read that genuinely failed is held as `cueFailed` and says so
   * rather than being rendered as a coach who wrote nothing — because "your
   * coach left no cue" is a claim about their coach.
   */
  const [cue, setCue] = useState<CueRead | null>(null);
  const [cueFailed, setCueFailed] = useState(false);
  const reloadCue = useCallback(async () => {
    if (!USE_SUPABASE || !name) { setCue(null); setCueFailed(false); return; }
    setCueFailed(false);
    try {
      setCue(await fetchCoachCue(supabase, name));
    } catch (e) {
      reportError('clientExercise.cue', e);
      // Null and not an empty read. An empty read would render as "your coach
      // has written nothing", which is a statement about their coach made from
      // a request that never came back.
      setCue(null); setCueFailed(true);
    }
  }, [name]);
  useEffect(() => { setCue(null); void reloadCue(); }, [reloadCue]);
  const coachCue = cue ? cueFor(cue, name) : null;

  // Four reads: the movement itself, the coach's clips for it, the coach's own
  // cue, and this member's own history of the lift underneath. The cue is in
  // here because the sentence shown when it fails tells them to pull down.
  const pull = usePullToRefresh(useCallback(() => {
    void reloadDetail(); void reloadVideos(); reloadLog(); void reloadCue();
  }, [reloadDetail, reloadVideos, reloadLog, reloadCue]));
  const wu = useSettings().weightUnit;
  // The member's weight over time, so a set of pull-ups is priced at the body
  // that did them rather than left out of every figure on the panel below. An
  // empty series is not an error — see src/lib/bodyweightSets.ts.
  const weightSeries = cd.weightSeries;
  const slug = exerciseSlug(name);
  // Built from the whole log rather than from a filtered one, because the index
  // is what knows whether a movement was logged with no sets against it at all
  // — the cardio case, which reads as "never done" if it is filtered out first.
  // The read is handed in with the log. `useWorkoutLog` asks for this member's
  // whole `workouts` table with no date bound, so the window is null and the
  // day count on the trail below is a fact about them; `logStatus` still
  // carries truncation on its own.
  const summary = useMemo(
    () => (slug
      ? exerciseIndex(log, weightSeries, { status: logStatus, windowDays: null }).find((e) => e.slug === slug) ?? null
      : null),
    [log, weightSeries, slug, logStatus],
  );
  const [saving, setSaving] = useState(false);


  const G = layout.gutter;
  const chips = [detail?.equipment, detail?.level, detail?.mechanic, detail?.force]
    .filter((x): x is string => !!x)
    .map(cap);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* `automaticallyAdjustKeyboardInsets` and a dismissable keyboard, because
          this scroller now holds a text field — the form-check question — and
          check:keyboard caught it sitting behind the keyboard.
          `useScrollPad` and NOT the bare constant: 220pt of permanent padding
          is what made pages "go blank at the bottom after there is no more
          wording", which was a real report. The hook gives the headroom only
          while a keyboard is actually up. */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 + pad }}
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, marginBottom: sp.lg }}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <Icon name={BACK_ICON} size={20} color={t.ink} />
          </Pressable>
          {/* The reader's own language where the catalogue has it, English
              where it does not — and `display.note` below says which, so an
              English name among German ones is never passed off as the German
              one. The identity is still `name`: that is what this screen was
              opened with and what a logged set is written under. */}
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }} numberOfLines={2}>{display?.name.text || detail?.name || name || 'Exercise'}</Text>
        </View>
        {display?.note ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: -sp.md, marginBottom: sp.lg }}>{display.note}</Text>
        ) : null}

        {/* ── what your coach says about this one ────────────────────────
            Drawn only when there IS a cue. Absence is silent on purpose:
            a member whose coach has written none, and a member whose gym has
            not had this switched on, are owed no sentence about a feature
            that is not theirs to use — and any sentence here would be a claim
            about their coach made from an empty answer. A read that FAILED is
            different and does say so, because the alternative is a member
            standing at the machine who is not shown the one thing their coach
            wanted them to remember and has no way to know. */}
        {coachCue ? (
          <View style={{ marginBottom: sp.lg, padding: sp.lg, borderRadius: radius.md, backgroundColor: t.surface2 }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.xs }}>From your coach</Text>
            <Text style={{ ...ty.body, color: t.ink }} accessibilityLabel={`From your coach: ${coachCue}`}>{coachCue}</Text>
          </View>
        ) : cueFailed ? (
          <View style={{ marginBottom: sp.lg }}>
            <Flag tone={t.ink3}>
              Your coach’s note for this movement could not be read just now. That is not a record that they have not
              written one — pull down to try again.
            </Flag>
          </View>
        ) : null}

        {/* ── the demonstration ─────────────────────────────────────────── */}
        {status === 'loading' ? (
          <View style={{ paddingVertical: sp.xl, alignItems: 'center' }}>
            <ActivityIndicator />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Looking this movement up…</Text>
          </View>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="Exercise" title="This could not be read"
            note="Nothing below is missing because it does not exist — we could not reach the catalogue. Try again once you have signal." />
        ) : clip ? (
          <ExerciseVideo video={clip} exerciseName={detail?.name || name} />
        ) : animUrl ? (
          <>
            <DemoAnimation uri={animUrl} label={detail?.name || name}
              // The stills, so the box is never empty while 1.6 MB of clip is on
              // its way, and so a clip that never arrives lands on the picture we
              // already had rather than on a hole.
              stillUrls={frames} cacheKey={animCacheKey ?? undefined} />
            {detail?.demoLicence !== 'commercial' ? (
              <View style={{ marginTop: sp.sm }}>
                <Flag tone={t.warn}>Evaluation asset — licensed for review only, never for release.</Flag>
              </View>
            ) : null}
          </>
        ) : frames.length ? (
          <>
            <FrameLoop urls={frames} label={detail?.name || name} />
            {caption ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text>
            ) : null}
            {/* Beside the artwork, not two screens away. The licence asks for
                one visible credit and the Credits card in settings is it; this
                costs a line and is worth more where somebody is looking. */}
            {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
          </>
        ) : equipmentUrl ? (
          // A handful of catalogue rows name a machine rather than a movement
          // — Cable Machine, Ski Erg, Smith Machine — so there is no
          // illustration of "performing" them and never will be. A picture of
          // the kit is the useful thing to show, kept visibly apart from a
          // demonstration: still, not cross-faded, and captioned as equipment.
          <>
            <GuardedImage
              source={{ uri: equipmentUrl }}
              contentFit="contain"
              cachePolicy="disk"
              accessibilityLabel={`${detail?.name || name}, equipment`}
              style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2 }}
            />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
              The equipment, not a demonstration — this is a machine rather than a movement.
            </Text>
            {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
          </>
        ) : (
          // No clip and no frames. Said plainly, with the one action that
          // actually changes it, rather than a grey silhouette implying a
          // demonstration we do not have.
          <Notice tone={t.ink3} kicker="Demonstration"
            // Sentence case. A <Notice title> is a sentence, not a label — it
            // renders at ty.head with no transform, and every other one in
            // app/(client) is written as prose, including the one on line 108
            // of this same file ("This could not be read"). With no clip and no
            // grant anywhere on the platform, this branch is the most-read
            // string in the product, and it was the only Title-Cased sentence
            // among them.
            title={videoStatus === 'loading' ? 'Looking for a clip…'
              : videoStatus === 'error' ? 'We couldn’t check for a clip'
              // 'partial' used to fall through to "No demonstration yet", which
              // is the same false claim the error arm below exists to refuse,
              // reached from a read that succeeded. The log half of this very
              // file already carries the third arm — see logStatus === 'partial'
              // further down — and the video half did not.
              : videoStatus === 'partial' ? 'We couldn’t check the whole library'
              : detail ? 'No demonstration yet' : signedOut ? 'Sign in to see this' : 'Not in our catalogue'}
            note={videoStatus === 'loading'
              ? 'Your coach’s video library is still being read.'
              : videoStatus === 'error'
              // "Nobody has filmed this" is a claim about the coach's library,
              // and a failed read of that library is not evidence for it.
              ? 'Your coach’s video library could not be read, so we cannot say whether there is a clip for this movement. There may well be one. The written guide below is unaffected.'
              : videoStatus === 'partial'
              // A truncated read is not evidence for it either: the clip may be
              // one row past where the read stopped.
              ? 'There are more clips in your coach’s library than we can read at once, and none of the ones we read were for this movement. That is not a statement that nobody has filmed it. The written guide below is unaffected.'
              : detail
              ? 'Nobody has filmed this movement and the catalogue has no reference frames for it. Your coach can add a clip from their app.'
              // Not "this movement is not in our catalogue" — that is a claim
              // about our data, and while signed out we have not been allowed
              // to look. The catalogue reads `to authenticated`, so a
              // signed-out session is handed zero rows with no error, which is
              // indistinguishable from an absent movement unless we say so.
              : signedOut
                ? 'The exercise library is only available once you are signed in, so this screen could not look this movement up. It is very likely in there.'
                : 'This movement is not in our catalogue, so there is no guide for it. If your coach wrote it into your program, ask them how they want it done.'} />
        )}

        {FRAMES_ARE_UNHOSTED && frames.length ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>Reference frames are served from the source dataset — not for release.</Flag>
          </View>
        ) : null}

        {/* ── what it is ────────────────────────────────────────────────── */}
        {detail ? (
          <>
            {/* The description leads, above the attribute chips. Somebody who
                does not know a movement needs to be told what it is before
                being told that it is compound and intermediate — and this was
                the one thing the original request asked for that the previous
                dataset had no field for at all. */}
            {display?.description ? (
              <>
                <Rule />
                <Section>
                  <Text style={{ ...ty.body, color: t.ink }}>{display.description.text}</Text>
                </Section>
              </>
            ) : null}
            <Rule />
            <Section>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {detail.group ? (
                  <View style={{ backgroundColor: t.brand, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{detail.group}</Text>
                  </View>
                ) : null}
                {chips.map((c) => (
                  <View key={c} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{c}</Text>
                  </View>
                ))}
              </View>
            </Section>

            {detail.primaryMuscles.length || detail.secondaryMuscles.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead title="Muscles Worked" />
                  {detail.primaryMuscles.length ? (
                    <Text style={{ ...ty.body, color: t.ink, marginBottom: 4 }}>
                      <Text style={{ fontWeight: '600' }}>Primary: </Text>{detail.primaryMuscles.map(cap).join(', ')}
                    </Text>
                  ) : null}
                  {detail.secondaryMuscles.length ? (
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      <Text style={{ fontWeight: '600' }}>Also: </Text>{detail.secondaryMuscles.map(cap).join(', ')}
                    </Text>
                  ) : null}
                </Section>
              </>
            ) : null}

            {detail.instructions.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead title="How to Do It" note={`${detail.instructions.length} step${detail.instructions.length === 1 ? '' : 's'}`} />
                  {detail.instructions.map((step, n) => (
                    <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                      <Text style={{ ...ty.label, fontWeight: '700', color: t.ink3, minWidth: 18 }}>{n + 1}</Text>
                      <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{step}</Text>
                    </View>
                  ))}
                </Section>
              </>
            ) : status === 'ready' && detail ? (
              <>
                <Rule />
                <Section>
                  {/* 41 of the original rows carry no instructions because nobody
                      has confirmed which catalogue movement they are. Saying so
                      is the point — an empty section would read as an app that
                      forgot to render, not as a gap we know about. */}
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    No written steps for this one yet.
                  </Text>
                </Section>
              </>
            ) : null}
          </>
        ) : null}

        {/* ── coaching cues ──────────────────────────────────────────────
            Kept apart from the numbered steps rather than appended to them. A
            client following the sequence needs it in order; a client who
            already knows the movement wants the cue, and a cue buried at step
            six is a cue they have stopped reading before they reach. */}
        {detail && detail.tips.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Tips" note={`${detail.tips.length}`} />
              {detail.tips.map((tip, n) => (
                <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.body, color: t.brand }}>·</Text>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{tip}</Text>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* What the movement is FOR, and how it is filed. Last, because it is
            the least useful thing to somebody standing in front of the bar. */}
        {detail && (detail.goals.length || detail.tags.length) ? (
          <>
            <Rule />
            <Section>
              {detail.goals.length ? (
                <>
                  <SectionHead title="Good For" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: detail.tags.length ? sp.lg : 0 }}>
                    {detail.goals.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                        <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{cap(g)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              {detail.tags.length ? (
                <>
                  <SectionHead title="Tags" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {detail.tags.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                        <Text style={{ ...ty.caption, color: t.ink3 }}>{cap(g)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        {/* ── log a set of it, here ─────────────────────────────────────
            The whole point of this screen being reachable from a machine. It
            writes through the same provider Train does, so a set logged here
            is the same row, on the same timestamp discipline, with the same
            three outcomes said out loud — a set the server refused is not in
            anybody's log and must never be reported as one. */}
        {name ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Log a Set" />
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Straight into today, without going back to Train. Leave the load box empty for a
                bodyweight set, or tick Timed for a hold.
              </Text>
              <LogSetRow
                t={t}
                unit={wu}
                onLog={async (set) => {
                  if (saving) return;
                  setSaving(true);
                  try {
                    const at = new Date().toISOString();
                    const out = await logWorkouts([{
                      t: at,
                      exercise: detail?.name || name,
                      sets: [[set.value, set.kg ?? 0]],
                      ...(set.bw ? { bw: [true] } : {}),
                      ...(set.timed ? { timed: [true] } : {}),
                    }]);
                    if (out === 'stored') {
                      tapLight();
                      // Offered only after the set is actually on the server.
                      // A clip attached to a set that is still queued would
                      // have no row to hang off.
                      setClipFor({ t: at, exercise: detail?.name || name });
                      setClipNote('');
                      setClipSaid(null);
                      // And the clip held from the PREVIOUS set, or the Delete
                      // control below would still be pointing at it. `clipSent`
                      // is a row, not a flag: `deleteFormClip(clipSent)` acts on
                      // whichever (workout_id, set_index) is in it, so leaving
                      // last set's row here put a "Delete It" button under the
                      // block that has just been opened for a NEW set — and
                      // pressing it deleted the earlier set's clip while the
                      // screen said "Deleted" about this one. A destructive
                      // control must never outlive the thing it was built for.
                      setClipSent(null);
                      return;
                    }
                    if (out === 'unsent') {
                      Alert.alert('Saved on this phone',
                        'No connection, so this set has not reached your training log yet — nothing is lost. It is saved here and goes up on its own next time you have signal.');
                      return;
                    }
                    Alert.alert('Not saved',
                      'Your training log rejected this set, so it has not been recorded and it is not waiting to send.');
                  } finally { setSaving(false); }
                }}
              />
              {/* ── send your coach a clip of that set ────────────────────
                  The consent sentence is shown BEFORE the camera opens, not
                  after the upload: consent that arrives once the file exists
                  is not consent. src/lib/formCheck.ts owns it, and the
                  storage policies in supabase/parts/2617 are what make it
                  true. */}
              {clipFor ? (
                <View style={{ marginTop: sp.lg, padding: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm }}>
                  {(() => {
                    const stop = clipRefusal({
                      hasCoach: !!cd.trainerId,
                      setExists: !!clipWorkoutId,
                    });
                    // A set still being saved is not a member without a coach,
                    // and the two must not share a sentence.
                    if (stop === 'no-set') {
                      return <Text style={{ ...ty.label, color: t.ink3 }}>Saving that set… the form check appears once it lands.</Text>;
                    }
                    if (stop) {
                      return <Text style={{ ...ty.label, color: t.ink3 }}>{clipRefusalLine(stop)}</Text>;
                    }
                    return (<>
                      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>Send your coach a form check</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{MEMBER_CONSENT_NOTE}</Text>
                      <TextInput
                        value={clipNote}
                        onChangeText={setClipNote}
                        placeholder="What do you want them to look at?"
                        placeholderTextColor={t.ink3}
                        accessibilityLabel="What to ask your coach about this set"
                        style={{ ...ty.body, color: t.ink, backgroundColor: t.surface, borderRadius: radius.sm, padding: sp.md, marginTop: sp.md }}
                      />
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                        {(['camera', 'library'] as const).map((src) => (
                          <Ghost
                            key={src}
                            // `clipBusy` was set on the way in and cleared on the
                            // way out and NOTHING read it, so the only thing a
                            // second press met was the silent `return` at the top
                            // of the handler. A clip is megabytes over gym wifi:
                            // for those seconds both buttons looked live and did
                            // nothing at all. `disabled` refuses the press, drops
                            // the fill and announces the state, and the line
                            // below says which of the two things is happening —
                            // relabelling both buttons "Sending…" would have said
                            // it twice and named neither.
                            disabled={clipBusy}
                            label={src === 'camera' ? 'Film It' : 'Choose a Clip'}
                            a11yLabel={src === 'camera' ? 'Film this set now' : 'Choose a clip already on this phone'}
                            onPress={async () => {
                              if (clipBusy || !clipWorkoutId) return;
                              setClipBusy(true); setClipSaid(null);
                              try {
                                const picked = await pickFormClip(src);
                                if (picked.error) { setClipSaid(picked.error); return; }
                                if (!picked.clip) return;
                                const out = await sendFormClip({
                                  memberId: cd.id === 'unknown' ? '' : cd.id,
                                  workoutId: clipWorkoutId,
                                  setIndex: 0,
                                  clip: picked.clip,
                                  note: clipNote,
                                  hasCoach: !!cd.trainerId,
                                });
                                setClipSaid(out.ok
                                  ? 'Sent. Your coach sees it against this set.'
                                  : out.error);
                                if (out.ok) {
                                  setClipNote('');
                                  // Read back rather than assumed: the row is
                                  // what the coach sees, so the control that
                                  // removes it is built from the row that
                                  // actually exists.
                                  setClipSent(await fetchFormClip(clipWorkoutId, 0));
                                }
                              } finally { setClipBusy(false); }
                            }}
                          />
                        ))}
                      </View>
                      {clipBusy ? (
                        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>Sending your clip…</Text>
                      ) : clipSaid ? (
                        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{clipSaid}</Text>
                      ) : null}
                      {clipSent ? (
                        <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                          <Ghost
                            label="Delete It"
                            a11yLabel="Delete the clip you sent your coach"
                            onPress={() => {
                              Alert.alert(
                                'Delete this clip?',
                                'It goes from your coach’s screen and from this app. Deleting it is final — there is no copy anywhere else.',
                                [
                                  { text: 'Keep it', style: 'cancel' },
                                  { text: 'Delete', style: 'destructive', onPress: async () => {
                                    const gone = await deleteFormClip(clipSent);
                                    // `deleteFormClip` counts the rows, so a
                                    // delete that matched nothing says so
                                    // rather than reporting success over a
                                    // video that is still there.
                                    setClipSaid(gone.ok ? 'Deleted. Your coach can no longer see it.' : gone.error);
                                    if (gone.ok) setClipSent(null);
                                  } },
                                ],
                              );
                            }}
                          />
                        </View>
                      ) : null}
                    </>);
                  })()}
                </View>
              ) : null}

              {/* Sets on this phone that the server has not taken. They are
                  not lost and they are not in the log a coach reads, and only
                  one of those two is obvious from looking at the screen. */}
              {unsentNote(unsentSets, 'set') ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{unsentNote(unsentSets, 'set')}</Text>
              ) : null}
            </Section>
          </>
        ) : null}

        {/* ── what you have done on it ──────────────────────────────────── */}
        <Rule />
        <Section>
          {logStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your training log&hellip;</Text>
          ) : logStatus === 'error' ? (
            <Flag tone={t.warn}>
              Your training log could not be read, so we cannot say what you have done on this. That
              is not the same as having done none of it.
            </Flag>
          ) : summary ? (
            <ExerciseTrail
              summary={summary}
              log={log}
              status={logStatus}
              /* Unwindowed, as above — so nothing here loses the sentences it
                 has today. */
              windowDays={null}
              unit={wu}
              voice={{ they: 'You', their: 'your', have: 'have' }}
              history={weightSeries}
            />
          ) : logStatus === 'partial' ? (
            // 'partial' had no arm and fell into "You have not logged this
            // movement yet" — said on the movement's own page to a lifter whose
            // squats all predate the row cap. A truncated read holds the newest
            // thousand sessions and nothing behind them, so an absence in it is
            // silence rather than a fact. Same arm records.tsx and
            // progression.tsx already carry, for the reason written on
            // src/lib/rowCap.ts: a confident empty state is strictly worse than
            // a failed read.
            <Flag tone={t.warn}>
              You have logged more sessions than this screen can read in one go, and none of the ones
              it read were this movement. That is not a statement that you have never done it.
            </Flag>
          ) : (
            <Text style={{ ...ty.body, color: t.ink2 }}>
              You have not logged this movement yet. The first set you log above starts the trail —
              every day you do it, the sets, the reps and the load as they were recorded.
            </Text>
          )}
        </Section>

        <Rule />
        <Section>
          <Ghost label="Exercise Library" icon="video" onPress={() => router.push('/(client)/library')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
