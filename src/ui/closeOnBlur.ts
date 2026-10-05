// Shut this screen's sheets when the reader leaves it.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// A React Native `<Modal>` is drawn by the native layer above EVERYTHING, and
// it keeps being drawn for as long as the component rendering it is mounted.
// In a tab navigator the screens stay mounted when you leave them. So a sheet
// opened on one tab is still on screen after the app has navigated to another:
// on 5 Oct 2026 the coach app's Calendar had "Add Session · Mon 5 Oct" open, a
// deep link took it to Build Program, and the sheet stayed — floating over the
// builder, with a live "Add Open Slot" button that would have written a slot to
// a screen the coach had already left.
//
// A tab TAP cannot reach it (the sheet covers the tab bar), which is why this
// survived: the way in is a route change that does not come from a tap on this
// screen. A push notification is exactly that, and it is the ordinary case —
// a coach with a sheet half-filled taps a notification and lands somewhere else
// with the sheet still over it.
//
// ── why close rather than hide ────────────────────────────────────────────
//
// Gating `visible` on `useIsFocused()` would hide the sheet and keep its state,
// so coming back to the tab re-opens a half-filled form built around a moment
// that has passed — "Add Session · Mon 5 Oct" is about the day it was opened
// for, and the reader has been elsewhere since. Closing is the honest answer to
// "I left": the screen is where they left it and the sheet is not.
//
// The cleanup also runs on unmount, which costs nothing — setting state on an
// unmounting component is a no-op in React 18, and the sheet is going anyway.
import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Run `close` whenever this screen loses focus.
 *
 * `close` is held in a ref and the effect never re-subscribes, so a caller can
 * pass an inline arrow — the usual shape — without re-running the focus effect
 * on every render, which would close the sheet the moment anything re-rendered.
 */
export function useCloseOnBlur(close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useFocusEffect(
    useCallback(() => () => { latest.current(); }, []),
  );
}
