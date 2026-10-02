// The coach's read of one check-in, in the shapes the client filled it in with.
//
// Board page 12 is the client's form: a row of faces for how they feel, a
// slider for energy, a slider for sleep, a notes box, one green button. On the
// coach's side the same page is the REVIEW of what came back — the client's
// answers drawn in those same shapes, read-only, with the coach's reply where
// the client's submit was. A coach who has watched their client fill this in
// on a phone across the room recognises it at once; four figures in a sentence
// ("Energy 4/5 · Sleep 3/5 …") had to be decoded every Monday.
//
// Nothing here is a control. The faces and the tracks are drawings of a value
// somebody else set, and each block is one spoken sentence — "Energy Level,
// 4 out of 5" — rather than five focusable circles announcing themselves one
// by one. An unanswered rating is drawn as an empty track and SAID as
// unanswered, never as a zero: see (2) in src/lib/coachCheckins.ts.
//
// Everything printed comes from `CoachCheckIn`, which is already the parsed and
// bounded row. This file does no reading and no arithmetic beyond n / 5.
import { View, Text } from 'react-native';
import { useTheme } from '../components';
import { Cta, Meter, type Tone } from '../kit';
import { sp, radius, type as ty, value } from '../../theme/scale';
import { RATING_MAX, ratingLabel, type CoachCheckIn } from '../../lib/coachCheckins';
import { answerLine, type Answer, type Question } from '../../lib/checkinQuestions';
import { weightLabel, type WeightUnit } from '../../lib/units';

const STEPS = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

/** What a block says about a rating, for the ear. */
const spoken = (label: string, v: number | null): string =>
  v == null ? `${label}: not answered` : `${label}: ${v} out of ${RATING_MAX}`;

/**
 * The board's row of faces, as five circles with the client's answer lit.
 *
 * Numerals rather than faces: the client's own form (app/(client)/checkin.tsx)
 * rates 1–5 in numbered squares, and a face this app invented for "3" would be
 * this app's reading of their week, not theirs.
 */
function Faces({ label, v }: { label: string; v: number | null }) {
  const t = useTheme();
  // The lit answer takes the colour of what it says — red for the bottom two,
  // amber for the middle, the accent for the top two — as the hue's pale plate
  // ringed in its mark with the numeral in its ink, which is the pairing the
  // contrast gate measures. The numeral still says it without the colour.
  const lit = v == null ? null
    : v <= 2 ? { soft: t.data.redSoft, mark: t.data.red, ink: t.data.redInk }
    : v === 3 ? { soft: t.data.amberSoft, mark: t.data.amber, ink: t.data.amberInk }
    : { soft: t.brandSoft, mark: t.brand, ink: t.brandText };
  return (
    <View accessible accessibilityLabel={spoken(label, v)} style={{ marginTop: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.sm }}>
        {STEPS.map((n) => {
          const on = v === n;
          return (
            <View key={n} style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on && lit ? lit.soft : t.surface2, borderWidth: on ? 2 : 0, borderColor: on && lit ? lit.mark : undefined }}>
              <Text style={{ ...value(18), color: on && lit ? lit.ink : t.ink3 }}>{n}</Text>
            </View>
          );
        })}
      </View>
      {v == null ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Not answered.</Text> : null}
    </View>
  );
}

/**
 * A rating as the kit's Meter, in the colour that names it everywhere else:
 * filled to n/5 with the figure at the trailing edge, so the bar never has to
 * be measured by eye. It was a drawn slider with a knob — a control's shape on
 * something nobody here can move. Unanswered is no fill and the words "Not
 * answered" (the Meter draws nothing for a null), never a nought. The wrapper
 * keeps the sentence for the ear: "4 out of 5", not "4 slash 5".
 */
function Track({ label, v, tone }: { label: string; v: number | null; tone: Tone }) {
  return (
    <View accessible accessibilityLabel={spoken(label, v)}>
      <Meter label={label} tone={tone} val={v} target={RATING_MAX} note={ratingLabel(v) ?? 'Not answered'} />
    </View>
  );
}

export function CheckInReview({ checkIn, who, weightUnit, onReply, questions = [], answers = null }: {
  checkIn: CoachCheckIn;
  /** A first name the caller has already established. */
  who: string;
  weightUnit: WeightUnit;
  /** The coach's answer — opens the thread. Absent when there is no client id
   *  to open one for. */
  onReply?: () => void;
  /** The coach's own questions (part 3380), live and retired: a two-month-old
   *  answer still needs the question it was given to, so a retired one is
   *  drawn here whenever there is an answer against it. */
  questions?: readonly Question[];
  /** Answers by question id, or null when that read failed. Null and {} are
   *  kept apart on purpose: {} is "they answered none of them", null is "we do
   *  not know", and only one of those may be drawn as silence. */
  answers?: Record<string, Answer> | null;
}) {
  const t = useTheme();
  const weight = weightLabel(checkIn.weightKg, weightUnit);
  /* Live questions, plus any retired one this check-in actually answered —
     the second half is why `questions` carries both. A question stopped two
     months ago still has to label the answer it got. */
  const asked = questions.filter((q) => !q.retiredAt || (answers && answers[q.id]));
  return (
    <View>
      <Faces label="Mood" v={checkIn.mood} />
      <Track label="Energy Level" tone="orange" v={checkIn.energy} />
      <Track label="Sleep Quality" tone="purple" v={checkIn.sleep} />
      {/* Not on the board's page, kept because it is on the form. Stated on
          the scale it is on — the roster shows the same column as a
          percentage, and the day the two were confused a 4 became 4%. */}
      <Track label="Adherence" tone="brand" v={checkIn.adherence} />
      {weight ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, marginTop: sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Weight</Text>
          <Text style={{ ...ty.body, color: t.ink }}>{weight}</Text>
        </View>
      ) : null}

      {/* The note is the only thing on this screen that is somebody's own
          words rather than this app's summary of them, so it is drawn in the
          box they typed it into. */}
      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Notes</Text>
      <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 72 }}>
        {checkIn.note
          ? <Text style={{ ...ty.body, color: t.ink }}>{checkIn.note}</Text>
          : <Text style={{ ...ty.caption, color: t.ink3 }}>They sent the form without writing anything with it.</Text>}
      </View>

      {/* ── what this coach asked, and what came back ─────────────────────
          Drawn under the six and only when there is something to draw: a
          coach who asks no questions of their own sees no heading, and a
          question nobody answered says so rather than showing a blank, which
          reads as a value of nothing. */}
      {asked.length ? (
        <View style={{ marginTop: sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Your Own Questions</Text>
          {answers === null ? (
            <Text style={{ ...ty.caption, color: t.ink2 }}>
              The answers to your own questions could not be read. That is this screen, not their check-in.
            </Text>
          ) : asked.map((q) => {
            const line = answerLine(q, answers[q.id] ?? null);
            return (
              <View key={q.id} accessible accessibilityLabel={`${q.prompt}: ${line ?? 'not answered'}`}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, marginTop: sp.sm }}>
                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{q.prompt}</Text>
                <Text style={{ ...ty.body, color: line ? t.ink : t.ink3, flexShrink: 0 }}>
                  {line ?? 'Not answered'}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {onReply ? (
        <View style={{ marginTop: sp.lg }}>
          <Cta label={`Reply to ${who}`} wide onPress={onReply} />
        </View>
      ) : null}
    </View>
  );
}
