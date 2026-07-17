// Group-class attendance: the trainer checks members into a class so they get paid
// per attendee. Backend-aware (class_roster / set_class_attendance RPCs) with a demo
// roster fallback so the screen is usable before the backend/bookings exist.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';

export interface RosterMember { userId: string; name: string; status: string; attended: boolean }

const DEMO: RosterMember[] = [
  { userId: 'd1', name: 'Sara Malik', status: 'booked', attended: false },
  { userId: 'd2', name: 'Omar Khan', status: 'booked', attended: false },
  { userId: 'd3', name: 'Lena Farah', status: 'booked', attended: false },
  { userId: 'd4', name: 'Yusuf Amin', status: 'booked', attended: false },
  { userId: 'd5', name: 'Nadia Saleh', status: 'booked', attended: false },
  { userId: 'd6', name: 'Karim Bishara', status: 'waitlist', attended: false },
];

/** Load a class's booked members with their attendance. Returns demo data offline. */
export async function classRoster(classId: string): Promise<RosterMember[]> {
  if (USE_SUPABASE && classId && !classId.startsWith('demo')) {
    try {
      const { data } = await supabase.rpc('class_roster', { p_class: classId });
      if (Array.isArray(data)) return data.map((r: any) => ({ userId: String(r.user_id), name: String(r.name || 'Member'), status: String(r.status || 'booked'), attended: !!r.attended }));
    } catch { /* fall back to demo */ }
  }
  return DEMO.map((m) => ({ ...m }));
}

/** Mark a member present / absent for a class (trainer only; best-effort). */
export async function setAttendance(classId: string, userId: string, present: boolean): Promise<void> {
  if (!USE_SUPABASE || !classId || classId.startsWith('demo') || userId.startsWith('d')) return;
  try { await supabase.rpc('set_class_attendance', { p_class: classId, p_user: userId, p_present: present }); } catch { /* ignore */ }
}

// ── Owner analytics + payroll ──────────────────────────────────────────────
export interface ClassSummaryRow {
  classId: string; title: string; kind: string; branch: string;
  trainerId: string; trainerName: string; startsAt: string; booked: number; attended: number;
}

// A representative week of classes across branches/trainers for the demo view.
const DEMO_SUMMARY: ClassSummaryRow[] = [
  { classId: 'd1', title: 'HYROX', kind: 'HYROX', branch: 'Al Quoz', trainerId: 't1', trainerName: 'Andres Canty', startsAt: '', booked: 16, attended: 15 },
  { classId: 'd2', title: 'CrossFit WOD', kind: 'CrossFit', branch: 'DIFC', trainerId: 't2', trainerName: 'Sara Lindqvist', startsAt: '', booked: 14, attended: 12 },
  { classId: 'd3', title: 'Reformer Pilates', kind: 'Pilates', branch: 'Jumeirah Park', trainerId: 't3', trainerName: 'Aisha Rahman', startsAt: '', booked: 12, attended: 12 },
  { classId: 'd4', title: 'Spin', kind: 'Cycle', branch: 'Yas Bay', trainerId: 't1', trainerName: 'Andres Canty', startsAt: '', booked: 20, attended: 17 },
  { classId: 'd5', title: 'Yoga Flow', kind: 'Yoga', branch: 'Al Quoz', trainerId: 't3', trainerName: 'Aisha Rahman', startsAt: '', booked: 18, attended: 14 },
  { classId: 'd6', title: 'HIIT', kind: 'HIIT', branch: 'Business Bay', trainerId: 't2', trainerName: 'Sara Lindqvist', startsAt: '', booked: 15, attended: 13 },
  { classId: 'd7', title: 'Strength 101', kind: 'Strength', branch: 'Springs', trainerId: 't4', trainerName: 'Marcus Cole', startsAt: '', booked: 10, attended: 8 },
  { classId: 'd8', title: 'HYROX', kind: 'HYROX', branch: 'DIFC', trainerId: 't1', trainerName: 'Andres Canty', startsAt: '', booked: 16, attended: 16 },
];

/** Class attendance over a date range for payroll + analytics (owner-wide). Demo when offline. */
export async function classSummary(fromISO: string, toISO: string): Promise<ClassSummaryRow[]> {
  if (USE_SUPABASE) {
    try {
      const { data } = await supabase.rpc('class_attendance_summary', { p_from: fromISO, p_to: toISO });
      if (Array.isArray(data) && data.length) return data.map((r: any) => ({
        classId: String(r.class_id), title: String(r.title || 'Class'), kind: String(r.kind || ''),
        branch: String(r.branch || '—'), trainerId: String(r.trainer_id || ''), trainerName: String(r.trainer_name || 'Trainer'),
        startsAt: String(r.starts_at || ''), booked: Number(r.booked || 0), attended: Number(r.attended || 0),
      }));
    } catch { /* fall back to demo */ }
  }
  return DEMO_SUMMARY.map((r) => ({ ...r }));
}
