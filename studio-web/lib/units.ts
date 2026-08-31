// What unit the person at this desk reads weights in — and whether anybody
// asked them.
//
// ── the gap this closes ───────────────────────────────────────────────────
//
// `scripts/check-currency.mjs` carried this console in its KNOWN ratchet:
//
//     studio-web/app/coach/roster/page.tsx:unit — count 1
//     'The console has no unit preference at all to read — it renders the
//      stored metric value, so the honest short-term label is "kg (stored)"
//      and the real fix is a console-side preference.'
//
// That was true when it was written and is not true now. `profiles.weight_unit`
// exists, is nullable, and its schema comment says what it is for in as many
// words: "kg or lb, the unit this ACCOUNT reads weights in, whatever its role.
// Null means never chosen." It is on the row `loadMe()` already reads, so the
// preference costs this console nothing to learn.
//
// ── whose unit, and why it is the reader's ────────────────────────────────
//
// Every weight this console prints is a CLIENT's weight, shown to a COACH. Two
// answers were available and they are not interchangeable:
//
//   · the client's own `clients.weight_unit` — what that person sees in their
//     app;
//   · the coach's `profiles.weight_unit` — what the person actually reading
//     this screen thinks in.
//
// The second. A coach scanning a roster of twenty clients is comparing them
// against each other and against a number in their own head, and a column where
// row four is in pounds because that client is American is not a column — it is
// twenty separate figures that happen to be stacked. check-currency.mjs already
// settled this for the phone, in the entry for app/(trainer)/dashboard.tsx:
// "The coach reads in THEIR unit and the client's delta is stored in kg, so
// this one needs the coach's, not the client's."
//
// ── what a null does, and why it is not what money() does ─────────────────
//
// It falls back to the browser's region and SAYS SO. This is the trade-off
// src/lib/unitPreference.ts sets out at length and comes down on, and the
// reasoning carries over unchanged: a weight has a true value in every unit at
// once and converting it is exact, so withholding it would blank a column that
// is perfectly legible rather than prevent a wrong number. An AMOUNT is not
// like that — "6,300.00" with no currency is a different amount in whatever
// money the reader is thinking in and there is nothing to fall back to — which
// is why `amount()` in lib/currency.ts withholds and this does not.
//
// The guess is never written back. `profiles.weight_unit` stays null until
// somebody taps a unit in the phone app, so a coach who signs in from a
// borrowed laptop in another country has not silently had their account
// answered for them.
import { resolveUnits, regionFromLocale, type ResolvedUnits } from '@lib/unitPreference';
import { weightLabel, weightDeltaIn, plain, type WeightUnit } from '@lib/units';
import type { Me } from '@/lib/supabase';

export type { WeightUnit };

/**
 * The browser's region — 'US' from 'en-US' — or null when it will not say.
 *
 * Wrapped and guarded for the same reason `deviceRegion()` is in the phone's
 * copy: this runs inside a React render on a page Next also prerenders on the
 * server, where `navigator` does not exist. A throw here would take out the
 * screen to avoid a guess going one way instead of the other.
 */
export function browserRegion(): string | null {
  try {
    if (typeof navigator === 'undefined') return null;
    return regionFromLocale(navigator.language);
  } catch {
    return null;
  }
}

/**
 * The unit to render in, and where it came from, for the signed-in account.
 *
 * `me` may be null while the profile is still loading; the units are resolved
 * from the region alone in that case and reported as 'device', which is exactly
 * what they are. No screen has to branch on the loading state to stay honest.
 */
export function unitsFor(me: Pick<Me, 'weightUnit'> | null | undefined): ResolvedUnits {
  // Length is not read: nothing on this console prints a height or a tape
  // measurement. Passing null resolves it from the region and marks it
  // 'device', which is true and unused.
  return resolveUnits(me?.weightUnit ?? null, null, browserRegion());
}

/**
 * A stored kilogram figure, written in the reader's unit with the unit named.
 *
 * Straight through to `weightLabel` in src/lib/units.ts — the same function
 * thirty phone screens use — so the console cannot round or spell a weight
 * differently from the app the same coach had open five minutes ago. Null in,
 * null out: a weight nobody logged is a dash, never "0 kg".
 */
export function weightText(kg: number | null | undefined, unit: WeightUnit): string | null {
  return weightLabel(kg, unit);
}

/**
 * A CHANGE in weight, in the reader's unit, signed.
 *
 * Converted as a span rather than by converting each end and subtracting —
 * `weightDeltaIn` exists because rounding both ends first makes a steady 0.4 kg
 * flicker between 0 and 1 lb. The unit is deliberately NOT repeated here: this
 * is rendered immediately beside the figure above, which names it, and a column
 * reading "84.2 kg −2.1 kg since first scan" says kilograms twice about one
 * measurement.
 */
export function deltaText(deltaKg: number | null | undefined, unit: WeightUnit): string | null {
  const d = weightDeltaIn(deltaKg, unit);
  if (d == null) return null;
  return `${d > 0 ? '+' : ''}${plain(d)}`;
}

/**
 * The sentence that admits the unit was guessed, or null when it was chosen.
 *
 * Shown ONCE per screen, in the section's own subtitle, rather than beside
 * every figure — src/lib/unitPreference.ts makes the case against the latter
 * and it holds here: a line of apology above every row is a nag, it trains
 * people to stop reading it, and it does not get the question answered.
 *
 * The wording differs from the phone's `deviceUnitNote` on purpose. That one
 * ends "Tap to choose", and it is rendered on the screen where the choice can
 * be made. This console has no Settings and does not write the column, so
 * telling somebody to tap something that is not here would be worse than saying
 * nothing. It names where the answer lives instead.
 */
export function unitSourceNote(u: ResolvedUnits): string | null {
  if (u.weightSource === 'chosen') return null;
  const word = u.weightUnit === 'kg' ? 'kilograms' : 'pounds';
  return `Weights are shown in ${word}, read from this browser's region — nobody has set a unit on this account. Choose one in the Repple app and this follows it.`;
}
