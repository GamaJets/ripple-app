// Demo roster + exercise videos for the trainer portal (UI-only mock).
export interface RosterClient {
  id: string; name: string; goal: string; weightDelta: number;
  adherence: number; lastActive: string; next: string; unread: number;
  mode: 'online' | 'inperson';
  injuries?: { area: string; severity: string; note?: string; isNew?: boolean }[];
  metrics?: import('./inbodyMetrics').ScanMetrics;
}
export const ROSTER: RosterClient[] = [
  { id: 'c1', name: 'Timothy', goal: 'Fat loss', weightDelta: -3.8, adherence: 92, lastActive: '2h ago', next: 'Today · 9am', unread: 1, mode: 'online', injuries: [{ area: 'knee', severity: 'moderate', note: 'Sharp on deep squats — cleared for light work', isNew: true }] },
  { id: 'c2', name: 'Jordan P.', goal: 'Build muscle', weightDelta: 2.1, adherence: 74, lastActive: '1d ago', next: 'Wed · 5pm', unread: 0, mode: 'inperson', injuries: [{ area: 'lower_back', severity: 'mild', note: 'Tweak after long drives' }] },
  { id: 'c3', name: 'Sam R.', goal: 'Tone', weightDelta: -1.2, adherence: 88, lastActive: '4h ago', next: '—', unread: 2, mode: 'online' },
  { id: 'c4', name: 'Alex M.', goal: 'Fat loss', weightDelta: -5.4, adherence: 96, lastActive: '30m ago', next: 'Thu · 7am', unread: 0, mode: 'inperson' },
  { id: 'c5', name: 'Priya N.', goal: 'Build muscle', weightDelta: 3.6, adherence: 81, lastActive: '2d ago', next: 'Fri · 6pm', unread: 0, mode: 'online' },
];
export interface ExVideo { id: string; name: string; group: string; dur: string; uploaded: boolean; }

// Shared "at-risk" definition so every trainer screen agrees (adherence low OR inactive 2+ days).
export function staleDays(str: string): number { const m = /([0-9]+)d/.exec(str || ''); return m ? parseInt(m[1], 10) : 0; }
export function atRiskClient(c: { adherence: number; lastActive: string }): boolean { return c.adherence < 80 || staleDays(c.lastActive) >= 2; }
export const EX_VIDEOS: ExVideo[] = [
  { id: 'v1', name: 'Back Squat', group: 'Legs', dur: '1:12', uploaded: true },
  { id: 'v2', name: 'Barbell Bench Press', group: 'Chest', dur: '0:58', uploaded: true },
  { id: 'v3', name: 'Romanian Deadlift', group: 'Hamstrings', dur: '1:04', uploaded: true },
  { id: 'v4', name: 'Pull-up', group: 'Back', dur: '0:47', uploaded: false },
  { id: 'v5', name: 'Overhead Press', group: 'Shoulders', dur: '0:51', uploaded: false },
  { id: 'v6', name: 'Walking Lunge', group: 'Legs', dur: '1:20', uploaded: false },
];
