// How the movement is performed, in words, on the screen where it is being
// performed.
//
// The session runner could show a member a demonstration mid-set and could not
// show them a single written step, on any of 608 movements — while the
// catalogue has carried `instructions` and `tips` for nearly all of them since
// the RepDB import, read by exactly one screen (app/(client)/exercise.tsx),
// which a member can only reach by leaving the session. src/lib/movementSteps.ts
// carries the argument in full, and the decision — including which of the five
// different "there are no steps" this is — is made there, under test, rather
// than in a chain of ternaries inside a 5,800-line screen.
//
// ── two ways to mount this ────────────────────────────────────────────────
//
// `<SessionSteps name={…} />` is the one-liner: it looks the row up itself. It
// costs one extra `select … eq(id)` beside the one `SessionDemo` already makes
// for the same movement — a single row by primary key, made only when a member
// has actually opened the disclosure, not on Start.
//
// `<MovementSteps view={…} />` takes the decision already made, for a caller
// that has an `ExerciseDetail` in hand and does not want the second read. Pass
// it `movementSteps({ instructions, tips, status, signedOut, hasRow })`.
//
// ── the rendering, and what it is not ─────────────────────────────────────
//
// Steps numbered and in catalogue order; cues bulleted and kept apart from
// them, for the reason app/(client)/exercise.tsx wrote down — a cue buried at
// step six is a cue nobody reaches. No truncation, no "read more", no summary:
// a shortened instruction is different advice, and this is read by somebody
// under a loaded bar.
//
// No `lineHeight` anywhere, and the step number's column is `grown()` rather
// than a pinned 18: at the largest accessibility text size a two-digit step
// number clips out of a fixed gutter, and the steps are the one thing on this
// panel nobody can afford to half-read.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { useExerciseDetail } from './exerciseDetail';
import { movementSteps, stepsCountLabel, type StepsView } from '../lib/movementSteps';
import { sp, type as ty, grown } from '../theme/scale';

/** The steps and cues themselves, from a decision already made. */
export function MovementSteps({ view }: { view: StepsView }) {
  const t = useTheme();
  if (view.kind === 'none') {
    // Ink, not a status colour. Every one of these sentences is an admission
    // about what we could see, and none of them is a warning — `t.warn` as text
    // ink fails the contrast gate in any case.
    return (
      <View style={{ paddingVertical: sp.md }}>
        <Text style={{ ...ty.label, color: t.ink3 }}>{view.note}</Text>
      </View>
    );
  }
  const steps = view.kind === 'steps' ? view.steps : [];
  const tips = view.tips;
  return (
    <View style={{ paddingTop: sp.md }}>
      {steps.length ? (
        <>
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>
            How this is done · {stepsCountLabel(steps.length, 'step')}
          </Text>
          {steps.map((step, n) => (
            <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.sm }}>
              {/* The numeral is the order, so it has to stay legible and stay
                  in its own column at every text size. */}
              <Text style={{ ...ty.label, fontWeight: '700', color: t.ink3, minWidth: grown(18) }}>{n + 1}</Text>
              <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{step}</Text>
            </View>
          ))}
        </>
      ) : null}
      {tips.length ? (
        <View style={{ marginTop: steps.length ? sp.md : 0 }}>
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>
            Watch for · {stepsCountLabel(tips.length, 'cue')}
          </Text>
          {tips.map((tip, n) => (
            <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.xs }}>
              <Text style={{ ...ty.body, color: t.brand }}>·</Text>
              <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{tip}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The same panel, looking the movement up for itself.
 *
 * Keyed by the movement's stored NAME — the identity every logged set carries —
 * which `useExerciseDetail` slugs, so 'Bent-Over Row' and 'Bent-over Row' are
 * one movement and not two answers.
 *
 * Mount it only while the disclosure is open, the way `SessionDemo` is: a
 * five-movement session must not fire five catalogue reads the moment somebody
 * presses Start.
 */
// unused-ok: its one mount point is inside app/(client)/workouts.tsx, which this
// lane was explicitly forbidden to edit (three lanes are editing this worktree).
// The mount is one line, in the runner's demo disclosure — the block that reads
// `{demoOpen ? (<SessionDemo … />) : null}`:
//
//     {demoOpen ? (<>
//       <SessionDemo t={t} name={nameOf(ex)} videos={videos} videoStatus={videoStatus} preferTrainerId={preferTrainerId} />
//       <SessionSteps name={nameOf(ex)} />
//     </>) : null}
//
// `nameOf(ex)` and not `shownName(ex)`: the catalogue is keyed by the stored
// English identity, which is what `useExerciseDetail` slugs. Passing the
// translated name would look the movement up under a name the table does not
// hold and report every movement as absent from the catalogue.
//
// Inside `demoOpen` and not above it, so the read still only happens when a
// member opens the disclosure. Delete this comment when the mount lands.
export function SessionSteps({ name }: { name: string }) {
  const { detail, status, signedOut } = useExerciseDetail(name);
  return (
    <MovementSteps
      view={movementSteps({
        instructions: detail?.instructions,
        tips: detail?.tips,
        status,
        signedOut,
        // `detail` is null both while the read is in flight and when there is
        // genuinely no row; `status` is what tells those apart, and the rule
        // reads them together rather than guessing from one.
        hasRow: !!detail,
      })}
    />
  );
}
