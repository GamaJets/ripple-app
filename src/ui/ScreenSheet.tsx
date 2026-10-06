// A <Modal> that belongs to the screen that opened it, and leaves with it.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// A React Native <Modal> is drawn by the NATIVE layer, above everything React
// is drawing, and it keeps being drawn for as long as the component rendering
// it is mounted. A tab navigator keeps its screens mounted when you leave
// them. So a sheet opened on one screen is still on top of the app after the
// app has navigated somewhere else.
//
// Seen on the coach app, 5 Oct 2026: Calendar had "Add Session · Mon 5 Oct"
// open, a deep link took it to Build Program, and the sheet stayed — over the
// builder, scrim and all, with "Add Open Slot" live under the coach's thumb.
// The screen behind it had changed; the sheet had not.
//
// A tab TAP cannot reach this, which is why it survived every hand test: the
// sheet covers the tab bar. It is reached by a route change that does not come
// from a tap on this screen, and a push notification is exactly that — the
// ordinary case of a coach with a half-filled sheet tapping a notification.
//
// ── why this is a wrapper and not a hook on every screen ──────────────────
//
// The first fix was a hook each screen called with its own setters. That works
// and it does not scale: 120 sheets across 61 files, each with its own state,
// is 61 chances to miss one and no way to see that you did. Every one of those
// sheets already passes an `onRequestClose` that closes it correctly — it has
// to, or the Android back button would not work — so the close that was needed
// was already written at every site. This calls it.
//
// `check:sheet` is the gate that keeps it that way: a raw <Modal> in app/** or
// src/ui/** fails unless it carries `modal-ok: <reason>`.
//
// ── closed, not merely hidden ─────────────────────────────────────────────
//
// Hiding would keep the state, so coming back re-opens a half-filled form
// built around a moment that has passed — "Add Session · Mon 5 Oct" is about
// the day it was opened for. The visibility is gated on focus as well, because
// the state close takes a render to arrive and the native layer would show the
// sheet for that frame.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, type ModalProps } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Drop-in for `<Modal>` on any screen inside the navigator.
 *
 * NOT for a gate that must outlive navigation — see src/ui/waiver.tsx, which
 * blocks the whole app until a release of liability is signed, passes a
 * deliberate no-op `onRequestClose`, and is rendered OUTSIDE the tabs. That one
 * keeps its raw <Modal> and says so with a `modal-ok:` marker.
 */
export function ScreenSheet(
  { visible, onRequestClose, children, ...rest }:
    // Narrowed from ModalProps, which types the handler as taking a native
    // event: every call site in this app passes a zero-argument closure, and
    // this component has no event to hand one when it closes on blur.
    Omit<ModalProps, 'onRequestClose'> & { onRequestClose?: () => void },
) {
  // `useIsFocused` is not re-exported by expo-router, so focus is tracked off
  // the effect that is: it runs on focus and its cleanup runs on blur.
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // Held in a ref so an inline arrow — which is how every call site writes it —
  // does not re-run the effect on every render and close the sheet the moment
  // anything re-rendered.
  const close = useRef(onRequestClose);
  close.current = onRequestClose;

  useEffect(() => {
    if (!focused && visible) close.current?.();
  }, [focused, visible]);

  return (
    <Modal {...rest} visible={!!visible && focused} onRequestClose={onRequestClose}>
      {children}
    </Modal>
  );
}
