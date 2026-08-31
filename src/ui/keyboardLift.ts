// ── Lifting a docked bar clear of the keyboard ───────────────────────────────
//
// The reported bug: typing a message to a coach, or to a client, put the
// keyboard over the field you were typing into. You could not read your own
// sentence.
//
// ── Why KeyboardAvoidingView did not do it ──────────────────────────────────
//
// Every chat screen here wrapped its thread and its compose bar in
// `<KeyboardAvoidingView behavior="padding">` — the documented thing to do —
// and it under-lifted by exactly the height of the navigator header.
//
// React Native's KeyboardAvoidingView computes the overlap as
//
//     max(frame.y + frame.height - keyboardFrame.screenY, 0)
//
// and those two terms are in DIFFERENT COORDINATE SPACES. `frame` comes from
// its own `onLayout`, whose `nativeEvent.layout` is relative to the PARENT
// view. `screenY` is absolute, measured from the top of the window. The
// subtraction is only correct when the parent's origin happens to be the top of
// the window — which is true in the example in the docs, and false on every
// screen in this app, because each one sits below a navigator header and above
// a tab bar. The shortfall is precisely the header height, so the bar rises
// most of the way and stops with the field still covered.
//
// Adding a `keyboardVerticalOffset` is the usual patch, and it is a constant
// standing in for a measurement: it has to be re-guessed for every screen, and
// it is wrong again on a device with a different status bar, in landscape, or
// when the header changes height for a long title.
//
// ── What this does instead ──────────────────────────────────────────────────
//
// It measures. `ref` goes on the bar that must stay visible; the hook asks the
// platform where that bar actually is IN WINDOW COORDINATES and compares it
// with the keyboard's top edge, which the event already reports in the same
// space. No coordinate spaces are mixed, so no offset needs guessing.
//
// The measurement is taken while a previous lift may already be applied, so the
// current lift is added back to recover the bar's resting position. That makes
// the calculation idempotent: feeding the result back in produces the same
// number rather than walking the bar up the screen a frame at a time.
//
// `keyboardWillChangeFrame` rather than `keyboardDidShow`, on iOS, for two
// reasons: it fires BEFORE the keyboard animates, so the bar travels with it
// instead of jumping after it has arrived; and it is the only event that
// reports the height CHANGING — switching to an emoji keyboard, a language with
// a candidate bar, or a hardware keyboard's accessory strip all change the
// height without a hide/show pair, and a `didShow`-only listener leaves the bar
// at the old height for the rest of the session.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';
import { liftFor } from '../lib/keyboardLift';

export interface KeyboardLift {
  /** Put this on the bar that must stay above the keyboard. */
  ref: React.RefObject<View | null>;
  /** Points to raise it by. Apply as `paddingBottom` on the container. */
  lift: number;
}

export function useKeyboardLift(): KeyboardLift {
  const ref = useRef<View | null>(null);
  const [lift, setLift] = useState(0);
  // Read inside the measure callback, which runs a frame later than the render
  // that produced `lift` — so state would be stale there and the ref is not.
  const applied = useRef(0);
  applied.current = lift;

  const settle = useCallback((next: number) => {
    // A sub-point difference is the measurement's own noise. Setting state on
    // it would re-render on every keystroke that nudges the bar by a rounding
    // error, and on a slow phone that is visible.
    setLift((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  }, []);

  useEffect(() => {
    const toKeyboardTop = (screenY: number | undefined) => {
      const node = ref.current;
      if (node == null || typeof screenY !== 'number' || !isFinite(screenY)) return;
      node.measureInWindow((_x, y, _w, h) => {
        const next = liftFor({ barY: y, barHeight: h, applied: applied.current, keyboardScreenY: screenY });
        if (next != null) settle(next);
      });
    };

    const subs = Platform.OS === 'ios'
      ? [
        // Covers show, hide and every resize in between: on hide the reported
        // top edge is the bottom of the window, which yields a lift of zero
        // without a second listener to say so.
        Keyboard.addListener('keyboardWillChangeFrame', (e) => toKeyboardTop(e?.endCoordinates?.screenY)),
      ]
      : [
        Keyboard.addListener('keyboardDidShow', (e) => toKeyboardTop(e?.endCoordinates?.screenY)),
        // Android reports no useful frame on hide, so the resting state is
        // stated rather than derived.
        Keyboard.addListener('keyboardDidHide', () => settle(0)),
      ];
    return () => { for (const s of subs) s.remove(); };
  }, [settle]);

  return { ref, lift };
}
