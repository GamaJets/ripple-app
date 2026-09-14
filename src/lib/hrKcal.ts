// Energy from a heart rate, for a session no watch put a figure on.
//
// ── What was asked for, and what this does instead ─────────────────────────
//
// The request was to take the calorie figure a cardio machine prints and
// "correct it" for the rider's heart rate, age, height and weight.
//
// That cannot be done honestly. A machine's number is already an estimate, and
// almost every machine makes it without knowing who is on it — most gym bikes
// and rowers assume a default body and some assume nothing at all. There is no
// function from somebody else's estimate to a better one, because what would
// have to be undone is unknown: you cannot subtract an assumption you were
// never told. Scaling it by a weight ratio would produce a figure with the
// authority of a measurement and the provenance of a guess, which is the one
// thing this codebase refuses everywhere else.
//
// So this does not correct the machine. It offers a SECOND figure, computed
// from the member's own body and their own measured heart rate, and leaves both
// on screen for them to choose between. A person who knows their machine reads
// high can now see what their own numbers say.
//
// ── The model ──────────────────────────────────────────────────────────────
//
// Keytel et al. (2005), the equations behind most heart-rate calorie estimates,
// fitted against indirect calorimetry on 115 people. They take heart rate, age,
// weight and sex, and they are sex-specific because the coefficients genuinely
// differ — the weight term even changes sign.
//
// It is a MODEL and is never to be presented as a measurement. Its stated
// standard error is about 20%, it is fitted on steady-state aerobic work, and
// it degrades outside roughly 90–150 bpm: below that a resting heart rate
// produces a figure for sitting still, and above it the linear fit runs out.
// `HR_MODEL_FLOOR` and `HR_MODEL_CEILING` mark that range, and a caller that
// wants to say so has `hrKcalConfidence`.
//
// ── Why it returns null so readily ─────────────────────────────────────────
//
// Every input is required and none is defaulted. There is no default sex, no
// assumed weight, no fallback age. This app has a rule that a figure which
// cannot be derived from something somebody actually recorded renders as a dash
// with a reason — and a calorie figure standing in for a body we do not know is
// exactly the invented number that rule exists to prevent. Height is not an
// input at all: it appears nowhere in these equations, and taking it as an
// argument would imply it was used.

export type Sex = 'male' | 'female';

/** Below this the fit is describing rest rather than work. */
export const HR_MODEL_FLOOR = 90;
/** Above this the linear fit is outside the data it was made from. */
export const HR_MODEL_CEILING = 150;

/** Kilojoules per kilocalorie, which is the unit the equations are published in. */
const KJ_PER_KCAL = 4.184;

export interface HrKcalInput {
  /** Average heart rate across the session, in beats per minute. */
  readonly avgBpm: number;
  /** How long it lasted, in minutes. */
  readonly minutes: number;
  /** Years. */
  readonly age: number;
  /** Kilograms — the unit every mass in this app is stored in. */
  readonly weightKg: number;
  readonly sex: Sex;
}

/**
 * Kilocalories for a session, or null when the inputs cannot support a figure.
 *
 * Null for a missing input, a nonsensical one, and for a result that comes out
 * at or below zero — which the male equation does at a low heart rate for a
 * light person, and which is not a small burn but a sign the model is being
 * asked about work nobody did.
 */
export function hrKcal(input: Partial<HrKcalInput> | null | undefined): number | null {
  if (!input) return null;
  const { avgBpm, minutes, age, weightKg, sex } = input;
  if (sex !== 'male' && sex !== 'female') return null;
  for (const n of [avgBpm, minutes, age, weightKg]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  }
  const hr = avgBpm as number, min = minutes as number;
  const yrs = age as number, kg = weightKg as number;

  const kjPerMin = sex === 'male'
    ? (-55.0969 + (0.6309 * hr) + (0.1988 * kg) + (0.2017 * yrs))
    : (-20.4022 + (0.4472 * hr) - (0.1263 * kg) + (0.0740 * yrs));

  const kcal = (kjPerMin / KJ_PER_KCAL) * min;
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  return Math.round(kcal);
}

export type HrKcalConfidence = 'in-range' | 'below-range' | 'above-range';

/**
 * Whether the heart rate sits inside the range this model was fitted on.
 *
 * Offered separately rather than folded into `hrKcal`, because a figure outside
 * the range is not worthless — it is simply less trustworthy, and the member is
 * the one who should be told that rather than have the number withheld.
 */
export function hrKcalConfidence(avgBpm: number): HrKcalConfidence {
  if (avgBpm < HR_MODEL_FLOOR) return 'below-range';
  if (avgBpm > HR_MODEL_CEILING) return 'above-range';
  return 'in-range';
}

/**
 * What the screen says about a figure this produced.
 *
 * Always names it as worked out rather than measured, and always says what it
 * was worked out from, because the member is being asked to accept or replace
 * it. Null when there is no figure, so a caller cannot print a sentence about a
 * number that does not exist.
 */
export function hrKcalNote(kcal: number | null, avgBpm: number | null): string | null {
  if (kcal == null || avgBpm == null) return null;
  const base = `Worked out from your average heart rate of ${Math.round(avgBpm)} bpm, your age and your weight — an estimate, not a measurement.`;
  const conf = hrKcalConfidence(avgBpm);
  if (conf === 'below-range') {
    return `${base} It is on the low side of where this calculation is reliable, so treat it as a rough figure.`;
  }
  if (conf === 'above-range') {
    return `${base} Your heart rate was above the range this calculation was built on, so it may read low.`;
  }
  return base;
}

// ── When there is no figure ────────────────────────────────────────────────
//
// `hrKcal` returning null is the honest answer, and on a screen it is also a
// blank. Every refusal above has a reason and the member is owed it: a gap
// where a calorie figure belongs reads as the feature being broken, and one of
// the reasons — a sex nobody has ever asked them for — is not something they
// could work out by looking.
//
// Same shape as `FallbackReason` in src/lib/goalEnergy.ts and for the same
// purpose: the screen names which it was instead of showing nothing.

export type HrKcalUnknown =
  /** No average heart rate for the session — nothing was paired, or the
   *  samples have not come back yet. */
  | 'no-heart-rate'
  /** No duration, or not a positive number of minutes. */
  | 'no-duration'
  /** No date of birth on the profile, so no age. */
  | 'no-age'
  /** No weight on file. */
  | 'no-weight'
  /** No recorded sex. Today this is EVERY member: `clients.sex` is read here
   *  and written by nothing in the product, so there is no way for anyone to
   *  supply it. The sentence below says so, and whoever adds that field has to
   *  come back and change it. */
  | 'no-sex'
  /** Every input present, and the equation still yields nothing — which the
   *  male equation does at a low heart rate for a light person. Not a small
   *  burn; a sign the model is being asked about work nobody did. */
  | 'below-model';

/**
 * Why there is no figure, in a fixed order, or an empty array when there is
 * one.
 *
 * Every reason, not the first — three missing inputs named one at a time is
 * three rounds of the member fixing something and finding the blank still
 * blank. The one exception is 'below-model', which by construction cannot
 * co-occur with a missing input.
 *
 * The contract is exact and the test holds it: this is empty if and only if
 * `hrKcal` on the same input returns a number.
 */
export function hrKcalUnknown(input: Partial<HrKcalInput> | null | undefined): readonly HrKcalUnknown[] {
  const i = input ?? {};
  const why: HrKcalUnknown[] = [];
  // The same test `hrKcal` applies, so the two can never disagree about
  // whether an input is usable.
  const unusable = (n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0;
  if (unusable(i.avgBpm)) why.push('no-heart-rate');
  if (unusable(i.minutes)) why.push('no-duration');
  if (unusable(i.age)) why.push('no-age');
  if (unusable(i.weightKg)) why.push('no-weight');
  if (i.sex !== 'male' && i.sex !== 'female') why.push('no-sex');
  if (why.length === 0 && hrKcal(input) == null) why.push('below-model');
  return why;
}

type NamedNeed = Exclude<HrKcalUnknown, 'below-model'>;

/** What is missing, in the member's own terms. */
const NEED: Record<NamedNeed, string> = {
  'no-heart-rate': 'an average heart rate for the session',
  'no-duration': 'how long it lasted',
  'no-age': 'your date of birth',
  'no-weight': 'your weight',
  'no-sex': 'your sex',
};

/**
 * What would produce the missing thing.
 *
 * Each of these is a claim about this app and has to stay true. 'no-sex' is
 * the one that is currently an admission rather than an instruction, because
 * nothing in the product writes `clients.sex` — telling a member to go and set
 * it somewhere would send them looking for a screen that does not exist.
 */
const FIX: Record<NamedNeed, string> = {
  'no-heart-rate': 'Pair a heart-rate monitor before a session and it is recorded for you.',
  'no-duration': 'A session has to run a full minute before there is anything to work from.',
  'no-age': 'Your date of birth is on your profile.',
  'no-weight': 'Your weight is on your profile.',
  'no-sex': 'The two published equations behind this differ by sex, and there is nowhere to tell the app yours yet.',
};

/**
 * The sentence shown where the figure would have been.
 *
 * Null for an empty list, so a caller cannot print a reason for a figure that
 * exists. Never a dash and never a zero: both of those are answers, and this
 * is the absence of one.
 */
export function hrKcalUnknownNote(why: readonly HrKcalUnknown[]): string | null {
  if (why.length === 0) return null;
  if (why.includes('below-model')) {
    return 'No calorie estimate from your heart rate: the heart rate recorded for this session is too low for the calculation to be describing work rather than rest.';
  }
  const named = why.filter((r): r is NamedNeed => r !== 'below-model');
  if (named.length === 0) return null;
  const needs = named.map((r) => NEED[r]);
  const list = needs.length === 1
    ? needs[0]
    : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`;
  return `No calorie estimate from your heart rate: it needs ${list}. ${named.map((r) => FIX[r]).join(' ')}`;
}

/**
 * The stored `clients.sex` value, read into the union this model uses.
 *
 * The column holds 'f' or 'm' — that is its check constraint in
 * supabase/parts/01-schema.sql, and `Sex` in src/lib/types.ts is those same two
 * letters. This module spells the two words out instead, because an equation
 * selected by a single letter is an equation nobody can review. Something has
 * to translate between them, and nothing did: src/ui/clientData.tsx compared
 * the stored value against 'male' and 'female', two strings the check
 * constraint cannot hold, so the answer was null for every row whatever the
 * column said.
 *
 * Anything else — null, an empty string, a spelling from somewhere else — is
 * null. A body this app has not been told about is not one to guess at.
 */
export function sexFromColumn(v: unknown): Sex | null {
  if (v === 'f') return 'female';
  if (v === 'm') return 'male';
  return null;
}
