// Group fitness classes — the multi-location "gym platform" layer. A gym chain
// runs classes across several branches; each class is a scheduled group session
// with a capacity. Clients pick their branch, then book/cancel (waitlist when
// full). Types + a realistic demo schedule so the screen renders offline.

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
export const CLASS_KINDS = ['CrossFit', 'Strength & Conditioning', 'HYROX', 'GRIT', 'MetCon', 'Cycle', 'Zumba', 'Yoga Flow', 'Yoga Stretch', 'Reformer Pilates', 'TRX', 'Olympic Lifting', 'Abs & Glutes', 'Boxing'] as const;

// Demo branch list (a real gym's branches come from the backend).
export const BRANCHES = ['Al Quoz', 'DIFC', 'Jumeirah Park', 'Business Bay', 'Al Khawaneej', 'Yas Bay'] as const;

const at = (dayOffset: number, hour: number, min = 0): string => {
  const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, min, 0, 0); return d.toISOString();
};

export const MOCK_CLASSES: GymClass[] = [
  { id: 'gc1', title: 'CrossFit WOD', kind: 'CrossFit', instructor: 'Coach Mia', branch: 'Al Quoz', room: 'Box 1', startsAt: at(0, 6, 30), durationMin: 60, capacity: 16, booked: 11 },
  { id: 'gc2', title: 'HYROX Prep', kind: 'HYROX', instructor: 'Coach Dev', branch: 'Al Quoz', room: 'Turf', startsAt: at(0, 18), durationMin: 60, capacity: 14, booked: 14 },
  { id: 'gc3', title: 'GRIT Strength', kind: 'GRIT', instructor: 'Coach Sam', branch: 'DIFC', room: 'Studio A', startsAt: at(0, 7), durationMin: 45, capacity: 20, booked: 8 },
  { id: 'gc4', title: 'Rhythm Cycle', kind: 'Cycle', instructor: 'Coach Lena', branch: 'DIFC', room: 'Cycle room', startsAt: at(1, 6, 30), durationMin: 45, capacity: 22, booked: 19 },
  { id: 'gc5', title: 'Reformer Flow', kind: 'Reformer Pilates', instructor: 'Coach Nadia', branch: 'Jumeirah Park', room: 'Reformer studio', startsAt: at(1, 9), durationMin: 50, capacity: 12, booked: 6 },
  { id: 'gc6', title: 'Yoga Flow', kind: 'Yoga Flow', instructor: 'Coach Lena', branch: 'Jumeirah Park', room: 'Studio B', startsAt: at(1, 19), durationMin: 60, capacity: 18, booked: 5 },
  { id: 'gc7', title: 'MetCon Blast', kind: 'MetCon', instructor: 'Coach Ray', branch: 'Business Bay', room: 'Floor', startsAt: at(2, 12), durationMin: 45, capacity: 16, booked: 10 },
  { id: 'gc8', title: 'Olympic Lifting', kind: 'Olympic Lifting', instructor: 'Coach Dev', branch: 'Business Bay', room: 'Platforms', startsAt: at(2, 18, 30), durationMin: 60, capacity: 10, booked: 7 },
  { id: 'gc9', title: 'TRX Circuit', kind: 'TRX', instructor: 'Coach Mia', branch: 'Al Khawaneej', room: 'Studio A', startsAt: at(2, 8), durationMin: 45, capacity: 14, booked: 4 },
  { id: 'gc10', title: 'Sunrise CrossFit', kind: 'CrossFit', instructor: 'Coach Omar', branch: 'Yas Bay', room: 'Box', startsAt: at(3, 7), durationMin: 60, capacity: 18, booked: 12 },
  { id: 'gc11', title: 'Boxing Circuit', kind: 'Boxing', instructor: 'Coach Ray', branch: 'Yas Bay', room: 'Ring', startsAt: at(3, 18), durationMin: 50, capacity: 14, booked: 9 },
  { id: 'gc12', title: 'Abs & Glutes', kind: 'Abs & Glutes', instructor: 'Coach Nadia', branch: 'Al Quoz', room: 'Studio B', startsAt: at(3, 12), durationMin: 30, capacity: 20, booked: 6 },
];
