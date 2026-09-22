// A view choice that outlives the screen: which range a chart shows, which
// segment of a list is open. Review rule 8 ("keep filters local and
// persistent") — somebody who reads Progress at 3M reads it at 3M every time,
// and reopening the screen at the default made them re-pick it every visit.
//
// ── Why the handset, and why sign-out leaves it ────────────────────────────
//
// These are how a screen is LOOKED AT, not anybody's answers, work or record,
// so none of the three branches in src/lib/signOutState.ts applies: a stranger
// inheriting "1Y" on a shared handset learns nothing and loses nothing, and
// the chips that set it sit on the card they change. So the keys carry no
// account and are on neither list there — stickyChoice.test.ts asserts it, so
// a key that starts holding something personal has to move on purpose.
//
// The React half is src/ui/useStickyChoice.ts; this is the part a test can run.

/** Every sticky key lives under this, so the family can be found and swept. */
export const STICKY_CHOICE_PREFIX = 'repple.filter:';

export const stickyChoiceKey = (key: string): string => `${STICKY_CHOICE_PREFIX}${key}`;

/**
 * What was stored, if it is still one of today's choices; otherwise null.
 *
 * A range a newer build dropped, a value an older build spelled differently,
 * or a corrupted read must fall back to the screen's default, never render a
 * chip row with nothing selected.
 */
export function parseStickyChoice<K extends string>(raw: string | null | undefined, allowed: readonly K[]): K | null {
  if (typeof raw !== 'string') return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as K) : null;
}
