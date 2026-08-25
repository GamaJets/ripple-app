// Group-class attendance: the trainer checks members into a class so they get paid
// per attendee. Backed by the class_roster / set_class_attendance RPCs.
//
// No demo fallback. This screen decides who gets paid for what — showing invented
// attendees on it was worse than showing nothing, and setAttendance silently
// no-opped for those fake ids, so the trainer ticked six strangers present and
// the owner's payroll recorded zero.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';

export interface RosterMember { userId: string; name: string; status: string; attended: boolean }


/** Load a class's booked members with their attendance. Empty when there are none. */
export async function classRoster(classId: string): Promise<RosterMember[]> {
  if (USE_SUPABASE && classId && !classId.startsWith('demo')) {
    try {
      const { data } = await supabase.rpc('class_roster', { p_class: classId });
      if (Array.isArray(data)) return data.map((r: any) => ({ userId: String(r.user_id), name: String(r.name || 'Member'), status: String(r.status || 'booked'), attended: !!r.attended }));
    } catch { /* fall through to empty */ }
  }
  return [];
}

/** Mark a member present / absent for a class (trainer only; best-effort). */
export async function setAttendance(classId: string, userId: string, present: boolean): Promise<void> {
  if (!USE_SUPABASE || !classId || classId.startsWith('demo')) return;
  try { await supabase.rpc('set_class_attendance', { p_class: classId, p_user: userId, p_present: present }); } catch { /* ignore */ }
}

// ── Owner analytics + payroll ──────────────────────────────────────────────
// The row shape and the rate maths live in classRates.ts, which imports
// nothing — see the note at the top of that file.
export { summariseClassRows, type ClassSummaryRow, type ClassRates } from './classRates';
import type { ClassSummaryRow } from './classRates';

/** Class attendance over a date range for payroll + analytics (owner-wide). */
export async function classSummary(fromISO: string, toISO: string): Promise<ClassSummaryRow[]> {
  if (USE_SUPABASE) {
    try {
      const { data } = await supabase.rpc('class_attendance_summary', { p_from: fromISO, p_to: toISO });
      if (Array.isArray(data) && data.length) return data.map((r: any) => ({
        classId: String(r.class_id), title: String(r.title || 'Class'), kind: String(r.kind || ''),
        branch: String(r.branch || '—'), trainerId: String(r.trainer_id || ''), trainerName: String(r.trainer_name || 'Trainer'),
        startsAt: String(r.starts_at || ''), capacity: Number(r.capacity || 0),
          booked: Number(r.booked || 0), attended: Number(r.attended || 0),
      }));
    } catch { /* fall back to demo */ }
  }
  // No rows means no classes in range. Return that honestly rather than
  // falling back to DEMO_SUMMARY, which rendered invented attendance figures.
  return [];
}
