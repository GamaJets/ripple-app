// The rest between two sets, for the paths that are not the guided runner.
//
// ── Why this exists, given that a rest timer already does ────────────────
//
// Passed on by the owner from a member: "then to be able to have a rest timer
// between sets as well." The app HAS one — src/lib/restTimer.ts, counted down
// by the session runner in app/(client)/workouts.tsx, with the sound
// preference in app/(client)/settings.tsx — so the request reads as a request
// for something that shipped.
//
// It is not. The runner is one of two ways to do a set. The other is the Train
// screen's own plan rows: tick a planned set off, tap the one-tap log beside
// the suggestion, or type reps and load into the row under the movement. All
// three call the same `logSet`, none of them opens the runner, and none of
// them had a rest timer. A member working through their plan on the plan
// screen — which is what somebody does when they are not in a hurry to be put
// in full-screen night mode — got no countdown at all.
//
// So this is the EXISTING timer's arithmetic on the path that was missing it.
// `restSecondsFor`, `restAfter` and `restClock` are the runner's own; the one
// thing not carried across is the chime and its haptic, which belong to a
// screen somebody has put in their pocket. Here they are looking at it.
//
// ── Why it owns its own clock ───────────────────────────────────────────
//
// Mounted when a set is logged and re-mounted on the next one, keyed by the
// count of sets. That is the whole of its state: the caller keeps none, adds
// no interval to a screen that already runs several, and cannot get "which row
// is resting" wrong, because the row that is resting is the one this is
// rendered inside.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from './components';
import { Ghost } from './kit';
import { restClock } from '../lib/restTimer';
import { sp, type as ty, font, numeric } from '../theme/scale';

export function RestAfterSet({ seconds, note }: {
  /** How long this rest is, already resolved by `restAfter(method, restSecondsFor(ex))`
   *  so a drop set's zero arrives as zero and draws nothing. */
  seconds: number;
  /** Where the number came from — the coach, the set method, or the app
   *  default. The runner says this under its own countdown and a member who
   *  is about to wait ninety seconds is owed the reason for the ninety. */
  note: string;
}) {
  const t = useTheme();
  const endsAt = useRef(Date.now() + Math.max(0, seconds) * 1000);
  const [left, setLeft] = useState(Math.max(0, seconds));
  useEffect(() => {
    if (seconds <= 0) return;
    // Four times a second against a wall-clock end, not a decrementing
    // counter: a timer that counts its own ticks drifts, and this one is
    // backgrounded every time the member puts the phone down, which is the
    // entire point of a rest.
    const id = setInterval(() => {
      const l = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [seconds]);
  if (seconds <= 0 || left <= 0) return null;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md,
    }}>
      <Text accessibilityLabel={`Resting, ${restClock(left)} left`}
        style={{ ...ty.head, ...numeric, ...font('600'), color: t.ink }}>{restClock(left)}</Text>
      <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>rest · {note}</Text>
      <Ghost label="Skip" a11yLabel="Skip the rest of this break" onPress={() => setLeft(0)} />
    </View>
  );
}
