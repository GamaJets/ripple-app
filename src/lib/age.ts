// ── Age from date of birth ───────────────────────────────────────────────────
import { dateParts } from './localDate';

/**
 * Whole years from an ISO date of birth. Updates automatically each birthday.
 *
 * `dob` is a Postgres `date` — a bare YYYY-MM-DD with no time and no offset.
 * It used to go through `new Date(dob)`, which resolves to UTC midnight, and
 * the comparison then read it back with local getters: west of Greenwich a
 * birthday on the 1st was read as the 31st of the month before, and the person
 * turned a year older a day early. Invisible in UTC+4, wrong across the
 * Americas. See src/lib/localDate.ts.
 */
export function ageFromDob(dob: string, now: Date = new Date()): number | null {
  const b = dateParts(dob);
  if (!b) return null;
  const [by, bm, bd] = b;
  let age = now.getFullYear() - by;
  const m = now.getMonth() - bm;
  if (m < 0 || (m === 0 && now.getDate() < bd)) age--;
  return age;
}
