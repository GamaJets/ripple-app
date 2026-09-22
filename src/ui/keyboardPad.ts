// Room to type in, that is not there when nobody is typing.
//
// ── the report ────────────────────────────────────────────────────────────
//
// "When scrolling the pages go blank at the bottom after there is no more
// wording on the pages." Eleven screens ended in 200 to 260 points of empty
// space — a third of a phone — that a reader scrolled into and found nothing
// in. The rest of the app ends at 40, in 141 places.
//
// ── why it was there, which was a real fix for a real fault ───────────────
//
// The keyboard used to sit on top of the field being typed into. The screens
// that carry the large number are the ones whose LAST element is an input: the
// water goal in habits, the password fields in account, the final exercise's
// sets in log-session. Their comments all say the same thing — 40 was enough
// while nothing was ever hidden, and is not now.
//
// But it was fixed twice. `automaticallyAdjustKeyboardInsets` on the same
// ScrollView already asks iOS to add the keyboard's height to the scroll
// insets, which is what lets the focused field rise above it; the static
// padding does that job a second time and then keeps doing it after the
// keyboard has gone. One of the two fixes is conditional and one is permanent,
// and the permanent one is what the reader was scrolling into.
//
// ── so: the headroom, only while it is wanted ─────────────────────────────
//
// Both fixes stay, and neither is guessed at. If the inset alone is enough,
// this extra room is harmless because it is only present while the keyboard
// is. If it is not enough — and the fault it was added for was real, reported
// from a device, and is not one to reintroduce on a reading of the docs — the
// room is there at exactly the moment it is needed.
//
// The dead space is gone either way, which is the part that was reported.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Where a scroll ends when nobody is typing. What the other 141 places use. */
export const SCROLL_PAD = 40;

/**
 * Extra room above the keyboard, for a screen whose LAST element is an input.
 *
 * Not a keyboard height and not trying to be one — iOS supplies that through
 * the inset. This is the room for the field and the button under it to come
 * up together, which is what the account screen's comment asks for by name.
 */
export const TYPING_HEADROOM = 220;

/**
 * Is the keyboard up?
 *
 * `Will` rather than `Did` on iOS so the padding changes on the same frame the
 * keyboard animates, instead of a beat behind it. Android only emits `Did`.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

/**
 * The bottom padding a scroll should carry right now.
 *
 * `SCROLL_PAD` at rest — the same ending every other screen has — and the
 * headroom added on top of it only while the keyboard is up.
 */
export function useScrollPad(headroom: number = TYPING_HEADROOM): number {
  return useKeyboardOpen() ? SCROLL_PAD + headroom : SCROLL_PAD;
}
