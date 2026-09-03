'use client';

// What a modal dialog owes a keyboard, and what four of them in this console
// were not paying.
//
// ── What was wrong ────────────────────────────────────────────────────────
//
// Four dialogs — the class register on /classes, the check-in register and the
// edit-class form on /timetable, and the edit-shift form on /staff — were all
// the same shape: a `position: fixed` scrim `<div role="dialog">` with
// `onClick={onClose}` on it, and the panel inside stopping propagation. That
// is a complete dialog for a mouse and almost nothing for anything else.
//
//   · NO ESCAPE. A grep for 'Escape' across the whole console returned one
//     hit, in the /door combobox. The only way out of any of these four was to
//     tab forward through every control in the panel to reach the Done button.
//   · NOTHING FOCUSED IT. Focus stayed on the row button that opened the
//     dialog, which is now BEHIND a 55%-black scrim — so the first Tab walked
//     into the page underneath: the rail, the sign-out link, the theme switch.
//     A keyboard user could not see where they were, because where they were
//     was covered up.
//   · NOTHING BROUGHT FOCUS BACK. Closing left focus on `<body>`, so the next
//     Tab started from the top of the document rather than from the row the
//     person had been working on. On a register that is one row per member.
//   · NO `aria-modal`. A screen reader browsing by heading read straight
//     through the dialog and out into the page behind it, with no signal that
//     the thing in front was meant to be exclusive.
//
// The scrim click stays, because it is a real convenience and costs nothing.
// It is simply not the only way out any more.
//
// ── Why a hook and not a <Dialog> component ───────────────────────────────
//
// The same argument `Banner.tsx` makes in reverse. Banner replaced nineteen
// identical `<div>`s because they were identical. These four panels are NOT
// identical — different widths, different scroll behaviour, one with a form
// and one with a table — and wrapping them would mean a component with four
// escape hatches. What they share is exactly the behaviour above, so that is
// what is shared. Each dialog keeps its own markup and calls this.
//
// ── The contract ──────────────────────────────────────────────────────────
//
// Spread `dialogPanel(ref)` onto the PANEL — the inner box, not the scrim —
// and leave the scrim's own `onClick` where it is. The panel gets `tabIndex`
// -1 so it can be focused without joining the tab order, and `aria-modal`.
import { useEffect, useRef, type RefObject } from 'react';

/** Everything focusable inside the panel, in document order. `disabled` and
 *  `tabindex="-1"` are excluded because neither is a tab stop; a details
 *  summary and a contenteditable are included because both are. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', 'summary',
  '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Escape, an initial focus, a focus trap, and focus put back where it came
 * from.
 *
 * `onClose` is read through a ref rather than depended on, so a caller passing
 * an inline arrow — which every one of these four does — does not tear the
 * listener down and rebuild it on every render. Rebuilding it would also
 * re-run the initial focus, which would drag the cursor out of a half-typed
 * field on every keystroke.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const panel = useRef<T | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // Captured BEFORE anything is focused, because in one frame's time it is
    // this dialog. `document.activeElement` is null in a detached document,
    // which is why this is typed and guarded rather than asserted.
    const opener = document.activeElement as HTMLElement | null;

    // The panel itself, not the first control. Focusing the first control
    // skips the heading, and on the register that heading is the class name
    // and its time — the whole of the context for the rows below it. The
    // panel is `tabIndex={-1}`, so the next Tab still lands on the first
    // control.
    el.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stopped, so a dialog inside another closable thing closes one layer
        // rather than all of them.
        e.stopPropagation();
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const stops = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        // A control scrolled out of an `overflow: auto` panel is still a tab
        // stop; one inside a `display: none` branch is not. `offsetParent` is
        // the cheap test that tells those apart without a layout read per key.
        .filter((n) => n.offsetParent !== null || n === document.activeElement);
      // A panel with nothing focusable in it keeps focus on itself rather than
      // letting Tab escape into the page the scrim is covering.
      if (!stops.length) { e.preventDefault(); return; }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const here = document.activeElement;
      if (e.shiftKey && (here === first || here === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    };

    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      // Back to the control that opened this, and only if it is still in the
      // document — a row that the dialog's own write removed is not somewhere
      // to send a cursor. `isConnected` is the check for that.
      if (opener && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  return panel;
}

/**
 * The attributes the panel needs, so a call site cannot take the behaviour and
 * forget the semantics.
 *
 * `role="dialog"` moves here from the SCRIM, where all four had it. On the
 * scrim it named the wrong element: the scrim is a full-viewport sheet of
 * translucent black whose only job is to be clicked, and `aria-modal` on it
 * would have claimed the whole viewport as the dialog. The dialog is the panel.
 *
 * `aria-modal` is the half a keyboard cannot demonstrate and a screen reader
 * depends on: without it the page behind stays in the reading order, and
 * somebody browsing by heading walks out of the register and into the rail
 * with nothing telling them they have left.
 */
export function dialogPanel<T extends HTMLElement>(ref: RefObject<T | null>, label: string) {
  return { ref, role: 'dialog', 'aria-label': label, tabIndex: -1, 'aria-modal': true as const };
}
