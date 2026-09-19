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
import { Cta } from '../kit';
import { sp, radius, type as ty, value } from '../../theme/scale';
import { RATING_MAX, ratingLabel, type CoachCheckIn } from '../../lib/coachCheckins';
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
  return (
    <View accessible accessibilityLabel={spoken(label, v)} style={{ marginTop: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.sm }}>
        {STEPS.map((n) => {
          const on = v === n;
          return (
            <View key={n} style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
              <Text style={{ ...value(18), color: on ? t.brandInk : t.ink3 }}>{n}</Text>
            </View>
          );
        })}
      </View>
      {v == null ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Not answered.</Text> : null}
    </View>
  );
}

/**
 * The board's slider, drawn and not draggable: a track filled to n/5 with the
 * knob at the end of the fill, and the figure stated beside the label so the
 * track never has to be measured by eye. Empty and unfilled when unanswered.
 */
function Track({ label, v }: { label: string; v: number | null }) {
  const t = useTheme();
  const share = v == null ? 0 : v / RATING_MAX;
  return (
    <View accessible accessibilityLabel={spoken(label, v)} style={{ marginTop: sp.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, marginBottom: sp.md }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>{label}</Text>
        <Text style={{ ...ty.caption, color: t.ink3 }}>{ratingLabel(v) ?? 'Not answered'}</Text>
      </View>
      <View style={{ height: 20, justifyContent: 'center' }}>
        <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: t.surface2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${share * 100}%`, backgroundColor: t.brand }} />
        </View>
        {v != null ? (
          // The knob sits at the end of the fill. `start` rather than `left`
          // so a mirrored layout carries the knob with the fill.
          <View style={{ position: 'absolute', start: `${share * 100}%`, marginStart: -10, width: 20, height: 20, borderRadius: radius.pill, backgroundColor: t.ink }} />
        ) : null}
      </View>
    </View>
  );
}

export function CheckInReview({ checkIn, who, weightUnit, onReply }: {
  checkIn: CoachCheckIn;
  /** A first name the caller has already established. */
  who: string;
  weightUnit: WeightUnit;
  /** The coach's answer — opens the thread. Absent when there is no client id
   *  to open one for. */
  onReply?: () => void;
}) {
  const t = useTheme();
  const weight = weightLabel(checkIn.weightKg, weightUnit);
  return (
    <View>
      <Faces label="Mood" v={checkIn.mood} />
      <Track label="Energy Level" v={checkIn.energy} />
      <Track label="Sleep Quality" v={checkIn.sleep} />
      {/* Not on the board's page, kept because it is on the form. Stated on
          the scale it is on — the roster shows the same column as a
          percentage, and the day the two were confused a 4 became 4%. */}
      <Track label="Adherence" v={checkIn.adherence} />
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

      {onReply ? (
        <View style={{ marginTop: sp.lg }}>
          <Cta label={`Reply to ${who}`} wide onPress={onReply} />
        </View>
      ) : null}
    </View>
  );
}
