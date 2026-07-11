// ── Age from date of birth ───────────────────────────────────────────────────
/** Whole years from an ISO date of birth. Updates automatically each birthday. */
export function ageFromDob(dob: string, now: Date = new Date()): number | null {
  if (!dob) return null;
  const b = new Date(dob);
  if (isNaN(b.getTime())) return null;
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}
