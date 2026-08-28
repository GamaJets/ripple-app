// Reading a date-only value without a timezone changing it.
//
// Postgres `date` columns come back as a bare `YYYY-MM-DD` string. Fourteen
// columns in this schema are that type — memberships.started_on and ends_on,
// gym_invoices.issued_on and due_on, gym_passes.expires_on, habit_logs.done_on,
// scans.taken_at, clients.dob, payroll_settlements.period_from and period_to,
// and the rest.
//
// A bare date has no time and no offset. `Date.parse` resolves it to UTC
// midnight anyway, and every local getter then reads it back in the reader's
// zone — so west of Greenwich the value silently becomes the day before:
//
//     TZ=America/New_York  new Date('2026-08-01').getDate()   // 31
//     TZ=Asia/Dubai        new Date('2026-08-01').getDate()   // 1
//
// The consequences found so far, both in shipped code:
//
//   cohorts()      a member who joined on the 1st landed in the previous
//                  month's retention cohort
//   ageFromDob()   somebody born on the 1st was reported a year older on the
//                  31st — a day before their birthday
//
// Both were invisible to the gym they were written for, which is UTC+4. That
// is the trap: the bug does not exist for the author and is always present for
// a customer in the Americas.
//
// A date-only value means a calendar day in the reader's own life — a
// membership starts on the 1st wherever you are standing. So read the number
// off the string and build the Date locally. Values that carry their own
// offset (a timestamptz) are parsed normally; they mean an instant, not a day.

/** Year, month index (0-11) and day, or null when there is no readable date. */
export function dateParts(iso?: string | null): [number, number, number] | null {
  if (!iso) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (bare) return [Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])];
  const t = Date.parse(String(iso));
  if (!isFinite(t)) return null;
  const d = new Date(t);
  return [d.getFullYear(), d.getMonth(), d.getDate()];
}

/**
 * A date-only string as LOCAL midnight, so every getter reads back the day
 * that was written. A timestamp keeps its own instant.
 */
export function localDate(iso?: string | null): Date | null {
  const p = dateParts(iso);
  if (!p) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(String(iso).trim());
  return bare ? new Date(p[0], p[1], p[2]) : new Date(Date.parse(String(iso)));
}
