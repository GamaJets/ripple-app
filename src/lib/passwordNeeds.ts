// The password requirements, said out loud.
//
// ── Why the spoken form is not the drawn form ─────────────────────────────
//
// `PasswordRules` in src/ui/components.tsx draws one pill per rule from
// `passwordRules()`, each with a tick or a bullet beside it. Those labels are
// written for the EYE and one of them is written for the eye very deliberately:
//
//     { label: 'a symbol (! ? @ # $ … )', … }
//
// The parenthesis is a legend. Sighted, it is four example glyphs and an
// ellipsis, read in a tenth of a second and skipped by anybody who already
// knows what a symbol is. Spoken, VoiceOver says:
//
//     "a symbol, left paren, exclamation mark, question mark, commercial at,
//      number sign, dollar sign, horizontal ellipsis, right paren"
//
// — nine words of punctuation in the middle of a list of four requirements, at
// the moment somebody is trying to hold all four in their head. src/lib/
// passwordRules.ts already refuses to do this in the other direction: the whole
// purpose of `passwordErrorMessage` is to turn Supabase's character-class dump
// into a sentence, "without re-reading a character-class dump". This is the
// same decision applied to the rules BEFORE they are broken, rather than after.
//
// So a trailing parenthetical is a legend for the eye and is dropped for the
// ear. It is dropped by SHAPE rather than by matching that one label, because a
// rule added later with its own legend should not have to know this file exists.
//
// ── And why it is a module rather than a line in the component ────────────
//
// It was a line in the component — one expression inside an
// `accessibilityLabel`, which is the one attribute in this codebase that
// nothing renders and nobody proofreads. A sentence built where it cannot be
// tested is a sentence nobody has ever heard.

/**
 * A rule as the component holds it.
 *
 * Structural rather than importing `PasswordRule`, for the reason src/lib/
 * authedUid.ts gives about the same choice: it lets the test hand in plain
 * objects, including the shapes `passwordRules()` would never produce, which
 * are exactly the ones worth asserting about.
 */
export interface SpokenRule {
  readonly label: string;
  readonly met: boolean;
}

/**
 * One rule's label, with any trailing parenthetical legend removed.
 *
 * Only a TRAILING one, and only a whole one. A parenthesis in the middle of a
 * label is part of the sentence, not a legend appended to it, and an unclosed
 * bracket is not a legend at all — both are left exactly as written, because
 * guessing at a malformed label is how a requirement quietly loses a word.
 */
export function forTheEar(label: string): string {
  const said = String(label ?? '').trim();
  const trimmed = said.replace(/\s*\([^()]*\)$/, '').trim();
  // If stripping the legend leaves nothing, the parenthesis WAS the label.
  // Say the label rather than say nothing.
  return trimmed || said;
}

/**
 * A list, joined the way a person reads one: commas, and "and" before the last.
 *
 * "a number, a symbol" is a list a screen reader runs together with the next
 * clause. "a number and a symbol" ends.
 */
export function joinAnd(parts: readonly string[]): string {
  const said = parts.map((p) => String(p ?? '').trim()).filter(Boolean);
  if (said.length === 0) return '';
  if (said.length === 1) return said[0];
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
}

/** What a reader is told when every local rule is satisfied. Deliberately not
 *  "Password is valid": the breach check runs on Supabase's side and this
 *  module has no more idea than the screen does whether it will pass. */
export const NOTHING_FURTHER: string = 'Password needs nothing further';

/**
 * What a reader is told when there are no rules to report.
 *
 * An empty list is NOT a clearance. `passwordRules()` cannot return one today,
 * so reaching this means the component was handed something it did not expect —
 * and "Password needs nothing further" over an unknown set of requirements is
 * the one sentence that would send somebody to press a button that then refuses
 * them. A named unknown says so instead.
 */
export const NEEDS_UNKNOWN: string = 'Password requirements could not be listed';

/**
 * The whole spoken summary, from the rules as drawn.
 *
 * Unmet rules only: the pills already carry met-ness visually, and a reader who
 * is told what is still missing knows what to type next. Listing the met ones
 * as well doubles the length of the announcement to say nothing actionable.
 */
export function passwordNeedsSpoken(rules: readonly SpokenRule[] | null | undefined): string {
  if (!Array.isArray(rules) || rules.length === 0) return NEEDS_UNKNOWN;
  const missing = rules.filter((r) => !r?.met).map((r) => forTheEar(r?.label ?? ''));
  const joined = joinAnd(missing);
  return joined ? `Password needs ${joined}` : NOTHING_FURTHER;
}
