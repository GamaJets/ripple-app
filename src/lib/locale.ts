// ── Which locale this app writes dates, times and numbers in ─────────────────
//
// ── The defect this exists to end ─────────────────────────────────────────
//
// The app wrote every figure and every date twice over. Twenty-three call
// sites named `'en-GB'` outright; another forty passed `undefined`, which is
// the reader's own device. Both spellings sat inside the same screens, so the
// same member could read "14 Aug" above a chart and "Aug 14" under it, and
// `num()` — the helper every four-digit figure in the app goes through — was
// pinned to en-GB, which means a member in Berlin or Paris read their 2,860
// kcal day as "2.860" and "2 860". In German that first one is not a large
// number with a separator, it is 2.86. The figure was not slightly foreign,
// it was wrong by a factor of a thousand, on a screen whose whole job is to
// tell somebody how much they have eaten.
//
// `src/lib/format.ts` had already written down where the fix belongs: "When
// this app finally takes the reader's own locale it takes it in one place, and
// this is the place." This is that place, and format.ts now asks it.
//
// ── This product has no default locale ────────────────────────────────────
//
// Repple is white-label. A gym in Dubai, one in London and one in Tokyo run
// the same binary, so there is no house locale to fall back to and no region
// to assume. The only honest sources are the platform and an explicit human
// choice, and there is no in-app locale picker: offering one would mean
// storing a guess the first time somebody opened the screen. So the locale is
// the DEVICE's, read through the same guarded shape `unitPreference.ts` uses
// for the device's region, and the fallback exists only for a runtime that
// will not say.
//
// ── Why the fallback is 'en-GB' and why that is not a default ─────────────
//
// A fallback is reached only when `Intl` is absent or unreadable — a Hermes
// build without ICU. Something must be written in that case, and en-GB is what
// every screen in this app was already written in, so the fallback preserves
// the app as shipped rather than moving it somewhere new on the machines least
// able to tell us. `localeSource()` reports which of the two happened, so a
// screen can say so instead of implying the reader was asked.
//
// Nothing in here imports react-native: the resolution rules are arithmetic on
// a string and are tested as such, and the one impure function is kept at the
// bottom, away from them.

/** Where the locale on screen came from.
 *   · 'device' — read off the handset. Right for almost everybody.
 *   · 'fallback' — the platform would not say. See the header. */
export type LocaleSource = 'device' | 'fallback';

/**
 * What to write in when the platform cannot be asked. NOT a default locale —
 * see the header. Every screen in the app was already written in this, so
 * reaching it changes nothing about what a reader sees.
 */
export const FALLBACK_LOCALE = 'en-GB';

export interface ResolvedLocale {
  /** The BCP-47 tag to hand to Intl. Always a usable tag. */
  locale: string;
  source: LocaleSource;
}

/**
 * Is this a BCP-47 tag we are willing to hand to `Intl`?
 *
 * Deliberately a shape test rather than a lookup. An unknown-but-well-formed
 * tag ('en-XZ') is not an error to Intl — it falls back to the closest match
 * it has — but a malformed one ('C', 'en_US.UTF-8', a POSIX locale leaking out
 * of a simulator) throws a RangeError from the constructor, and a throw inside
 * `num()` takes out whatever screen was drawing a figure. So the rule is: two
 * or three letters of language, then any number of alphanumeric subtags.
 */
export function isWellFormedLocale(tag: string | null | undefined): boolean {
  if (!tag) return false;
  // Subsequent subtags are 1-8 characters, not 2-8: a BCP-47 extension opens
  // with a single-letter singleton, so 'en-US-u-ca-gregory' — which a handset
  // set to a non-Gregorian calendar really does report — is well formed.
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(normaliseLocale(tag));
}

/**
 * A tag with POSIX habits taken out of it: `en_US` becomes `en-US`.
 *
 * `Intl` returns hyphens, but this string does not always come from Intl — a
 * simulator, an emulator image or a device set up through a vendor skin can
 * hand back the underscore form, and `unitPreference.regionFromLocale` already
 * accepts both for exactly that reason. Returns the empty string for anything
 * absent, which `isWellFormedLocale` then rejects.
 */
export function normaliseLocale(tag: string | null | undefined): string {
  return tag == null ? '' : String(tag).trim().replace(/_/g, '-');
}

/**
 * The locale to write in, and where it came from.
 *
 * Pure, so the rules can be argued with in a test rather than inferred from
 * whichever machine the test happens to run on.
 */
export function resolveLocale(device: string | null | undefined): ResolvedLocale {
  const d = normaliseLocale(device);
  if (isWellFormedLocale(d)) return { locale: d, source: 'device' };
  return { locale: FALLBACK_LOCALE, source: 'fallback' };
}

/**
 * The sentence a screen shows where the reader might otherwise think they had
 * chosen this. Null when the device answered, because a line of apology on a
 * screen where nothing is wrong is a nag — the same rule `deviceUnitNote` in
 * unitPreference.ts follows, and for the same reason.
 */
export function localeNote(source: LocaleSource): string | null {
  if (source === 'device') return null;
  return `Your phone did not say which region it is set to, so dates and numbers are written the British way. Nothing you have entered is affected.`;
}

/* ── the latch ─────────────────────────────────────────────────────────────
 *
 * `num()` is called from several hundred places with one argument, and
 * threading a locale through every one of them would be a change to every
 * screen in the app to fix a bug in one file. So the resolved locale is held
 * here, seeded once, and read synchronously.
 *
 * It is seeded LAZILY rather than at module load: `Intl` on Hermes is a build
 * flag, and a throw during module evaluation kills the screen that imported it
 * rather than degrading. Reading it on first use puts the guarded call inside a
 * function, where its try/catch can do something.
 */
let latched: ResolvedLocale | null = null;

/**
 * Seed or re-seed the latch. `device` is a parameter rather than read inside,
 * so a test can state which handset it is talking about; the app calls it with
 * no arguments and gets the real one.
 */
export function setAppLocale(device: string | null | undefined = deviceLocale()): ResolvedLocale {
  latched = resolveLocale(device);
  return latched;
}

/** The tag every formatter in the app passes to Intl. */
export function appLocale(): string {
  return (latched ?? setAppLocale()).locale;
}

/** Where that tag came from. See `localeNote`. */
export function localeSource(): LocaleSource {
  return (latched ?? setAppLocale()).source;
}

/**
 * Does the reader's locale write a 12-hour clock?
 *
 * Asked of Intl rather than derived from a table of countries: en-GB is a
 * 24-hour locale and en-AU is a 12-hour one, both English, and no rule about
 * language gets that right. `true` when Intl cannot be asked, because a
 * 12-hour clock is what every screen in this app printed before this file
 * existed and a fallback should not also be a redesign.
 */
export function prefers12Hour(locale: string = appLocale()): boolean {
  try {
    // Cast because `hourCycle` landed in the ES2021 lib and this file is
    // compiled against ES2020 for the test runner. The property is present on
    // every runtime this ships to; the type just does not know about it yet.
    const r = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions() as {
      hour12?: boolean; hourCycle?: string;
    };
    if (typeof r.hour12 === 'boolean') return r.hour12;
    return r.hourCycle === 'h11' || r.hourCycle === 'h12';
  } catch {
    return true;
  }
}

/**
 * This handset's locale, or null when the platform will not say.
 *
 * The only impure function in the file, kept apart from the rules above for
 * the same reason `deviceRegion()` is in unitPreference.ts: the rules are then
 * testable against a string instead of against the test runner's own machine.
 * Wrapped because `Intl` is a Hermes build flag rather than a guarantee, and
 * the failure mode of this whole file is meant to be a worse guess, never a
 * blank screen.
 */
export function deviceLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}
