// Which unit a member reads in — and whether they ever actually said so.
//
// ── The defect this exists to end ─────────────────────────────────────────
//
// `clients.weight_unit` and `clients.length_unit` are nullable ON PURPOSE, and
// supabase/parts/61-unit-preference.sql says why in as many words: NULL means
// the member has never chosen, not kilograms. The store was honest. The reader
// was not — `src/ui/settings.tsx` resolved that NULL to `DEFAULTS.weightUnit =
// 'kg'` before `useSettings()` handed anything to a screen, so no screen in the
// app could tell "chose kilograms" from "never asked". Every one of them saw
// 'kg' and stated it with the confidence of a real answer.
//
// A member in Dallas who has never opened Settings was therefore shown, and
// told, kilograms on thirty screens, with nothing anywhere on any of them
// admitting that nobody had asked. This is the same shape as the currency bug
// `money()` was fixed for: a guess that renders cleanly looks considered, so
// nobody goes and fixes the setting.
//
// ── The trade-off, and the side this file comes down on ───────────────────
//
// Two honest answers were available once "never chosen" became expressible:
//
//   (a) render the unit as unknown — withhold the figure, the way money()
//       withholds an amount whose currency nobody set;
//   (b) fall back to the device's own region, and SAY on screen that this is
//       where the unit came from.
//
// (a) is what money() does, and it is right THERE because a bare "6,300.00" is
// not a smaller version of the truth — it is a different amount in whatever
// money the reader is thinking in, and there is no correct number to fall back
// to. Units are not that. The record is genuinely kilograms and centimetres; a
// weight has a true value in every unit at once, and converting it is exact.
// Withholding would blank the weight on the dashboard, the goal, the scans, the
// records and two dozen more — an app that shows a member nothing until they
// visit Settings, which is a worse product AND a worse prompt to go and choose.
//
// So: (b). The phone's region is not a coin toss, it is the single best
// available evidence about which unit this person reads in, and it is right for
// almost everybody it is applied to. What made the old behaviour a defect was
// never that 'kg' was a guess — it was that the guess was indistinguishable
// from a choice. This file keeps the two apart: `resolveUnits` returns the unit
// to render AND where it came from, screens that are about the preference
// itself say so, and the member is asked once at the point where the answer
// actually changes what gets STORED (the onboarding Your Stats step).
//
// The guess is never written to the account. `clients.weight_unit` stays NULL
// until a person taps a unit, so this fallback can be improved — or a member
// can cross a border — without having quietly overwritten anybody's real answer
// with a locale reading from a handset they were holding once.
import type { WeightUnit, LengthUnit } from './units';

/** Where the unit on screen came from.
 *   · 'chosen' — a person tapped it. It is theirs and it is right.
 *   · 'device' — nobody has chosen; this is read off the phone's region and is
 *                a guess the reader is entitled to be told about. */
export type UnitSource = 'chosen' | 'device';

export interface ResolvedUnits {
  /** The unit to render in. Always a real unit — see the header for why this
   *  is not nullable even though the preference behind it is. */
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  /** What the member actually chose, or null because nobody has asked them.
   *  This is the honest value: it is what Settings tints a pill from, what
   *  decides whether onboarding asks, and what is allowed to be written back. */
  weightChosen: WeightUnit | null;
  lengthChosen: LengthUnit | null;
  weightSource: UnitSource;
  lengthSource: UnitSource;
}

/**
 * The region subtag of a BCP-47 locale — 'US' from 'en-US', 'AE' from
 * 'ar-Arab-AE' — or null when there is no region in it at all.
 *
 * Parsed rather than handed to `Intl.Locale`, which Hermes does not reliably
 * carry: a missing constructor here would throw inside a provider on launch,
 * and the failure mode of this whole file is meant to be a worse guess, never a
 * blank app. The subtag is the second-or-later part that is two letters (a
 * country) or three digits (a UN M.49 area); a four-letter part is a script
 * ('Arab') and a longer one is a variant, and both are skipped.
 */
export function regionFromLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const parts = String(locale).replace(/_/g, '-').split('-');
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
    if (/^\d{3}$/.test(p)) return p;
  }
  return null;
}

/**
 * The three countries that weigh people in pounds. Not a style preference: a
 * person in the United States asked their weight answers in pounds and would
 * have to do arithmetic to answer in anything else. Liberia and Myanmar are the
 * other two that never adopted the metric system.
 *
 * The United Kingdom is deliberately NOT here, and it is the entry somebody
 * will want to add. British body weight is stones and pounds — "twelve stone
 * four" — and this app does not offer stones, so "lb" would show a British
 * member 172 lb, a figure they do not use either. British gyms load kilogram
 * plates and British scales read kilograms alongside stones, so kg is the
 * closer of the two wrong-for-nobody answers. It is a guess either way and it
 * is labelled as one on screen.
 */
// unit-ok: this is the region→unit translation itself, not a fallback. A table
// that maps a known country to the unit its people use is the honest version of
// the guess, the same way src/lib/billing.ts maps a known currency code to its
// symbol rather than inventing one.
const POUND_REGIONS = new Set(['US', 'LR', 'MM']);

/**
 * The four that measure a HEIGHT in feet and inches. The United Kingdom is
 * here and is absent from the list above, and that split is the whole reason
 * these are two lists rather than one "imperial?" boolean: a British member
 * gives their height as "five foot ten" and their weight in stones, so the
 * closest honest pair for them is inches and kilograms. Collapsing the two
 * would force one of those to be wrong.
 */
// unit-ok: as above — a known region translated to the unit it uses, not a
// default standing in for an answer nobody gave.
const INCH_REGIONS = new Set(['US', 'LR', 'MM', 'GB']);

/**
 * The units a phone set to this region most likely wants to read in.
 *
 * An unknown or absent region gets metric. That is still a guess and is still
 * reported as `'device'` by `resolveUnits` — the point of this module is that
 * a guess is never dressed up as an answer, not that the guess is always
 * derivable. Metric is the right side to be wrong on: it is what every country
 * this product is sold into uses except the United States, and the United
 * States is precisely the case a region CAN be read for.
 */
export function unitsForRegion(region: string | null | undefined): { weight: WeightUnit; length: LengthUnit } {
  const r = region ? String(region).toUpperCase() : null;
  return {
    // unit-ok: the two ends of the region translation above. Neither is a
    // fallback for a missing preference — `resolveUnits` marks whatever comes
    // out of here as 'device', which is what stops it being read as a choice.
    weight: r && POUND_REGIONS.has(r) ? 'lb' : 'kg',
    length: r && INCH_REGIONS.has(r) ? 'in' : 'cm',
  };
}

/**
 * The unit to render in, and where it came from.
 *
 * A chosen unit always wins, and the two are resolved independently: somebody
 * who has set pounds and never touched the height row keeps pounds AND gets
 * their height guessed from the phone, rather than having one answer taken as
 * consent to the other.
 */
export function resolveUnits(
  weightChosen: WeightUnit | null | undefined,
  lengthChosen: LengthUnit | null | undefined,
  region: string | null | undefined,
): ResolvedUnits {
  const device = unitsForRegion(region);
  return {
    weightUnit: weightChosen ?? device.weight,
    lengthUnit: lengthChosen ?? device.length,
    weightChosen: weightChosen ?? null,
    lengthChosen: lengthChosen ?? null,
    weightSource: weightChosen ? 'chosen' : 'device',
    lengthSource: lengthChosen ? 'chosen' : 'device',
  };
}

/**
 * The sentence a screen shows under a unit control nobody has set — naming the
 * unit being used AND the fact that the app picked it.
 *
 * Returns null for a chosen unit, so the screens that call this cannot lecture
 * somebody about a guess that is not happening. Deliberately NOT rendered on
 * every screen that prints a weight: a line of apology above thirty screens is
 * a nag, it trains people to stop reading, and it does not get the question
 * answered. It belongs where the answer can be given — see the Units section of
 * app/(client)/settings.tsx and the Your Stats step of onboarding.
 */
export function deviceUnitNote(unit: WeightUnit | LengthUnit, source: UnitSource): string | null {
  if (source === 'chosen') return null;
  const word = unit === 'kg' ? 'kilograms' : unit === 'lb' ? 'pounds'
    : unit === 'cm' ? 'centimetres' : 'feet and inches';
  return `Not set yet — showing ${word}, from your phone's region. Tap to choose.`;
}

/**
 * This handset's region, or null when the platform will not say.
 *
 * The only impure function in the file, and it is kept out of everything above
 * so the rules can be tested against a region rather than against whichever
 * machine the tests happen to run on. Wrapped because `Intl` is a Hermes build
 * flag rather than a guarantee: on a build without it this throws, and a throw
 * here would take out the settings provider — and with it the app — at launch,
 * to avoid a guess going one way instead of the other.
 */
export function deviceRegion(): string | null {
  try {
    return regionFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}
