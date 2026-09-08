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
// ── which halves of src/lib/units.ts this console may take ────────────────
//
// The ROUNDING, not the SPELLING.
//
// `weightIn` and `weightDeltaIn` are arithmetic and nothing else — a conversion
// and a rounding to the grain the record holds — so they come straight across,
// and that is what keeps a figure here identical to the same figure in the app
// the same coach had open five minutes ago. That is the whole point of reaching
// into the shared module at all.
//
// `weightLabel` and `plain` do NOT come across, and they used to. Both spell
// through `new Intl.NumberFormat(appLocale())`, and `appLocale()` is the
// module-level latch in src/lib/locale.ts that resolves on the SERVER during
// render and again in the BROWSER during hydration — two machines, two
// locales, one silent hydration error. lib/num.ts exists to keep this console
// out of that latch, and scripts/check-deltas.mjs already writes the rule down
// in its own header: "a console site takes the SIGN from the helper and spells
// the figure with the console's own formatter". This file took the sign from
// `deltaSign` and then spelled with `plain`, which is half the rule.
//
// It had not produced a mismatch, and the reason was luck of the call site
// rather than anything in here: /coach/roster fills its rows in an effect, so
// there is no weight in the prerendered HTML to disagree with. `numPlain` in
// lib/num.ts is the console's own spelling of `plain` — same rounding in front
// of it, same refusal to group, the reader's own separator on both passes.
import { resolveUnits, regionFromLocale, type ResolvedUnits } from '@lib/unitPreference';
import { weightIn, weightDeltaIn, type WeightUnit } from '@lib/units';
import { deltaSign } from '@lib/deltaLabel';
import { numPlain } from '@/lib/num';
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
 * `weightIn` in src/lib/units.ts does the conversion and the rounding — the
 * same arithmetic thirty phone screens use — so the console cannot round a
 * weight differently from the app the same coach had open five minutes ago.
 * This is `weightLabel` with its spelling swapped for the console's, and
 * nothing else: see the note at the top of this file for why the spelling
 * cannot come across too. Null in, null out: a weight nobody logged is a dash,
 * never "0 kg".
 */
export function weightText(kg: number | null | undefined, unit: WeightUnit): string | null {
  const v = weightIn(kg, unit);
  // `weightIn` has already rounded — whole pounds, one decimal of a kilogram —
  // so three places here can only ever spell what it decided, never add one.
  // That is `plain`'s own default and `weightLabel` passed it too.
  return v == null ? null : `${numPlain(v)} ${unit}`;
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
  // The sign comes from `deltaSign` rather than from `d > 0` here, and the two
  // are not the same expression. The hand-rolled one wrote a bare `plain(d)`
  // for anything not above zero, and `plain` spells a negative with an ASCII
  // HYPHEN — so this column read "-2.1" while every movement on the phone read
  // "−2.1" (U+2212), which is what `MINUS` in src/lib/deltaLabel.ts is exported
  // to keep single. It also means a change that rounds to nothing now carries
  // no sign at all instead of a "+", which is the defect that module was
  // written for: there is no such thing as negative — or positive — nothing.
  //
  // `deltaSign` and not `deltaLabel`: the sign half is pure arithmetic and safe
  // here, while `deltaLabel` and `deltaMagnitude` reach `plain` -> `appLocale()`,
  // the module-level latch lib/num.ts refuses for hydration reasons. That is
  // the rule scripts/check-deltas.mjs states, and the magnitude now keeps its
  // half of it: `numPlain`, not `plain`. See the note at the top of this file.
  //
  // `dp` mirrors `weightDeltaIn`, which has ALREADY rounded — whole pounds, one
  // decimal place of a kilogram — so the sign is decided on exactly the figure
  // that is about to be printed rather than on an unrounded one behind it, and
  // the spelling can print no place the rounding did not judge.
  const dp = unit === 'lb' ? 0 : 1;
  return `${deltaSign(d, dp)}${numPlain(Math.abs(d), dp)}`;
}

/**
 * The sentence that admits the unit was guessed, or null when it was chosen.
 *
 * Shown ONCE per screen, in the section's own subtitle, rather than beside
 * every figure — src/lib/unitPreference.ts makes the case against the latter
 * and it holds here: a line of apology above every row is a nag, it trains
 * people to stop reading it, and it does not get the question answered.
 *
 * The wording differs from the phone's `deviceUnitNote` on purpose — that one
 * ends "Tap to choose" — but only in the verb.
 *
 * It used to end "Choose one in the Repple app and this follows it", and the
 * paragraph above it read: "This console has no Settings and does not write the
 * column, so telling somebody to tap something that is not here would be worse
 * than saying nothing." That sentence was written before /settings existed, and
 * it stopped being true twice over: this console writes five settings to the
 * database from that screen, and `profiles.weight_unit` is on the row `loadMe()`
 * already reads. The only reader of a weight here is a COACH on
 * /coach/roster — signed in, on a screen that can write their own profile row —
 * and telling them the answer lives in an app they may not have installed is a
 * dead end with a working control two lines below it.
 *
 * So the note says the unit was guessed and stops. The screen that renders it
 * puts the choice beside it, because that is the screen the reader is on.
 */
export function unitSourceNote(u: ResolvedUnits): string | null {
  if (u.weightSource === 'chosen') return null;
  const word = u.weightUnit === 'kg' ? 'kilograms' : 'pounds';
  return `Weights are shown in ${word}, read from this browser's region — nobody has set a unit on this account.`;
}
