// Group fitness classes — the multi-location "gym platform" layer. A gym chain
// runs classes across several branches; each class is a scheduled group session
// with a capacity. Clients pick their branch, then book/cancel (waitlist when
// full).
//
// Types and the class-format vocabulary only. MOCK_CLASSES previously held a
// twelve-class schedule with invented instructors ("Coach Mia", "Coach Nadia")
// and invented booking counts, and BRANCHES hardcoded six Dubai locations that
// a real gym does not necessarily have — both shipped in the production
// bundle, and the branch list was what a trainer picked from when creating a
// real class. Branches now come from the gym's own classes, and MOCK_CLASSES
// is gone entirely: it had been an empty array nothing imported, which is a
// place for sample data to grow back.

export type ClassBookingStatus = 'booked' | 'waitlist';

export interface GymClass {
  id: string;
  title: string;
  kind: string;          // CrossFit · HYROX · GRIT · Cycle · Yoga Flow · Reformer …
  instructor: string;
  branch: string;        // gym location (e.g. "Al Quoz", "DIFC", "Yas Bay")
  room: string;          // room within the branch (optional)
  startsAt: string;      // ISO
  durationMin: number;
  capacity: number;
  booked: number;        // confirmed count (from class_counts on the backend)
}

// Common studio-class formats (chain-agnostic; a gym can add its own).
export const CLASS_KINDS = ['Abs & Glutes', 'Boxing', 'CrossFit', 'Cycle', 'GRIT', 'HYROX', 'MetCon', 'Olympic Lifting', 'Reformer Pilates', 'Strength & Conditioning', 'TRX', 'Yoga Flow', 'Yoga Stretch', 'Zumba'] as const;

// A gym's branches are derived from the classes it has actually created — see
// `branchesFrom` — so nothing is suggested that the gym did not enter itself.
export function branchesFrom(classes: { branch: string }[]): string[] {
  return [...new Set(classes.map((c) => (c.branch || '').trim()).filter(Boolean))].sort();
}
