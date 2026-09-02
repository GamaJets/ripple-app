// ── The date arithmetic an edge function is allowed to import ───────────────
//
// This module exists for a rule that was unwritten until it broke a deploy, and
// is worth stating plainly:
//
//   A MODULE AN EDGE FUNCTION IMPORTS MUST BE A LEAF. No relative imports.
//
// Deno resolves an import specifier literally. `from './coachMoney'` is a file
// called `coachMoney` with no extension, which does not exist, so the module
// throws the moment it is evaluated — not when the function is deployed, and
// not when it is called, but on the first request, as a 500 with a resolution
// error and nothing on any screen to explain it.
//
// The app cannot simply write `./coachMoney.ts` instead: `moduleResolution` is
// `bundler` and TypeScript refuses an import path ending in `.ts`. So the two
// runtimes want different specifiers for the same line, and the only shape that
// satisfies both is a module with no relative imports at all — which is why
// `directCharges.ts` and `refunds.ts` have none, and why `connect-refund` and
// `connect-checkout` have always deployed cleanly while `gym-checkout` did not.
//
// `memberBuy.ts` reached for six of them, all reasonable on their own, and the
// Supabase CLI reported six `failed to read file` warnings that are easy to
// scroll past. `npm run check:functions` now follows imports transitively out
// of an edge function and fails on exactly this, so the next one is caught
// before it ships rather than by a 500.
//
// Everything here is pure, UTC, and has no dependencies. `memberBuy.ts` and
// `gymPasses.ts` re-export from it, so every existing caller is unchanged and
// there is still one definition of each rule.

/** How often a plan bills. `once` does not renew and has no end date. */
export type PlanInterval = 'month' | 'year' | 'once';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A bare ISO day as [year, monthIndex, day], or null. The month is an INDEX,
 *  0-11, because that is what `Date.UTC` takes — see src/lib/localDate.ts for
 *  the two off-by-one bugs this repo has shipped by getting that backwards. */
export function parts(iso: string | null | undefined): [number, number, number] | null {
  const m = ISO.exec(String(iso ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}

/** A UTC date back as a bare ISO day. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** How many days there are in a given month, in UTC. */
export const lastDayOf = (y: number, mIndex: number): number => new Date(Date.UTC(y, mIndex + 1, 0)).getUTCDate();

/** `days` after a bare ISO date, in UTC. Null in, null out. */
export function addDays(day: string | null | undefined, days: number): string | null {
  const p = parts(day);
  if (!p) return null;
  const d = new Date(Date.UTC(p[0], p[1], p[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/**
 * The last day of a term that starts on `startsOn` under a plan billed at
 * `interval`. Null for a plan that does not renew, which is open-ended and is
 * not the same as expired.
 *
 * A month plan bought on 1 October runs to 31 October, not to 1 November: the
 * term ends the day BEFORE the same day of the next month, because the first
 * day of the new term is the day the next payment covers. Selling somebody 1
 * October to 1 November hands them a free day every month and makes every
 * renewal date drift.
 *
 * The exception is a start date with no counterpart next month. A month from 31
 * January is not "30 February minus a day"; it is the end of February, which is
 * what a person means by a month and what every gym's paperwork says. So a
 * day-of-month past the end of the target month CLAMPS to the last day of that
 * month and is NOT then reduced by one, which would take a day off a term for
 * the arithmetic's convenience. 31 January runs to 28 February.
 *
 * All of it in UTC from parsed components, never by constructing local Dates: a
 * membership term is a run of calendar days in the member's own life, and the
 * difference between two local midnights is not 24 hours across a DST boundary.
 * `npm run test:zones` runs this in Kiritimati (UTC+14) and Midway (UTC-11).
 */
export function termEnd(startsOn: string | null | undefined, interval: PlanInterval): string | null {
  if (interval === 'once') return null;
  const p = parts(startsOn);
  if (!p) return null;
  const [y, m, d] = p;
  const months = interval === 'year' ? 12 : 1;
  const total = m + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = lastDayOf(ty, tm);
  if (d > last) return isoDay(new Date(Date.UTC(ty, tm, last)));
  const end = new Date(Date.UTC(ty, tm, d));
  end.setUTCDate(end.getUTCDate() - 1);
  return isoDay(end);
}

/** A whole term: the two dates that go on the order and then on the
 *  membership. `endsOn` null is open-ended, for an interval of 'once'. */
export interface Term { startsOn: string; endsOn: string | null }

/** The term a purchase made today buys, starting today. */
export function termFrom(startsOn: string, interval: PlanInterval): Term {
  return { startsOn, endsOn: termEnd(startsOn, interval) };
}

/**
 * The day a renewal's term begins: the day after the current one ends, or
 * today if that day has already passed.
 *
 * Typed structurally on `{ endsOn }` rather than on `MemberMembership`, so this
 * module keeps no import. The caller's own row satisfies it.
 */
export function renewStart(m: { endsOn: string | null | undefined }, today: string): string | null {
  if (!m.endsOn || !parts(m.endsOn) || !parts(today)) return null;
  const next = addDays(m.endsOn, 1);
  if (!next) return null;
  return next > today ? next : today;
}

/** When a pass issued on `issuedOn` stops being usable. Null validDays means it
 *  does not expire, which is not the same as expiring today. */
export function expiryFor(issuedOn: string, validDays: number | null | undefined): string | null {
  if (validDays == null) return null;
  const d = new Date(`${issuedOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + validDays);
  return d.toISOString().slice(0, 10);
}

/** Does this renewal carry straight on from the term it renews?
 *
 *  It decides whether fulfilment EXTENDS the membership row or writes a NEW
 *  one, and the difference is a claim about somebody's attendance record. A
 *  renewal bought before the current term runs out starts the very next day and
 *  is one membership running longer; one bought after a lapse is not, and
 *  pushing `ends_on` out would leave a row claiming to have run continuously
 *  through weeks the member was not a member. That row is what an attendance or
 *  billing dispute is settled against. */
export function renewalIsContiguous(oldEndsOn: string | null | undefined, newStartsOn: string): boolean {
  if (!parts(oldEndsOn) || !parts(newStartsOn)) return false;
  return addDays(oldEndsOn, 1) === newStartsOn;
}

/** What to write onto the membership an upgrade replaces.
 *
 *  Closed as `'expired'` and never as `'active'` with a past date — that reads
 *  as `stale` and renders the "check at reception before you travel in" alarm
 *  over an ordinary upgrade. Typed structurally on `{ startedOn }` so this
 *  module keeps no import. */
export function supersedeRow(
  current: { startedOn: string },
  newStartsOn: string,
): { status: 'expired'; ends_on: string } | null {
  const before = addDays(newStartsOn, -1);
  if (!before) return null;
  const endsOn = before < current.startedOn ? current.startedOn : before;
  return { status: 'expired', ends_on: endsOn };
}
