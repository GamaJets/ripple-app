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
