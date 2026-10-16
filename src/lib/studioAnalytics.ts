/**
 * Studio analytics: the shape owner_studio_analytics (supabase/parts/3510)
 * returns, and the figures the screen derives from it. Pure.
 *
 * Every figure keeps "unknown" apart from zero: a retention base of 0 has no
 * rate, an InBody average withheld for a small group is null, and revenue is
 * never added across currencies.
 */
export interface StudioAnalytics {
  days: number;
  activeMemberships: number;
  members: number;
  trainingMembers: number;
  retention: { base: number; retained: number; pct: number | null };
  sessionsPerCoach: { trainerId: string; name: string; sessions: number }[];
  /** One total per currency over the window, largest first. */
  revenue: { currency: string; cents: number; months: { month: string; cents: number }[] }[];
  inbody: {
    scannedMembers: number;
    repeatMembers: number;
    avgBodyFatChange: number | null;
    avgMuscleChangeKg: number | null;
    avgWeightChangeKg: number | null;
    minGroup: number;
  };
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const nn = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function parseStudioAnalytics(raw: unknown): StudioAnalytics | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const base = n(r.retention?.base), retained = n(r.retention?.retained);
  const byCur = new Map<string, { cents: number; months: Map<string, number> }>();
  for (const p of Array.isArray(r.revenue) ? r.revenue : []) {
    const cur = String(p.currency || '?');
    const e = byCur.get(cur) ?? { cents: 0, months: new Map() };
    e.cents += n(p.cents);
    e.months.set(String(p.month), (e.months.get(String(p.month)) ?? 0) + n(p.cents));
    byCur.set(cur, e);
  }
  return {
    days: n(r.days),
    activeMemberships: n(r.active_memberships),
    members: n(r.members),
    trainingMembers: n(r.training_members),
    retention: { base, retained, pct: base > 0 ? Math.round((Math.min(retained, base) / base) * 100) : null },
    sessionsPerCoach: (Array.isArray(r.sessions_per_coach) ? r.sessions_per_coach : [])
      .map((c: any) => ({ trainerId: String(c.trainer_id), name: String(c.name || 'Coach'), sessions: n(c.sessions) }))
      .sort((a: { sessions: number }, b: { sessions: number }) => b.sessions - a.sessions),
    revenue: [...byCur].map(([currency, e]) => ({
      currency, cents: e.cents,
      months: [...e.months].sort((a, b) => a[0].localeCompare(b[0])).map(([month, cents]) => ({ month, cents })),
    })).sort((a, b) => b.cents - a.cents),
    inbody: {
      scannedMembers: n(r.inbody?.scanned_members),
      repeatMembers: n(r.inbody?.repeat_members),
      avgBodyFatChange: nn(r.inbody?.avg_body_fat_change),
      avgMuscleChangeKg: nn(r.inbody?.avg_muscle_change_kg),
      avgWeightChangeKg: nn(r.inbody?.avg_weight_change_kg),
      minGroup: n(r.inbody?.min_group) || 3,
    },
  };
}

/** "+1.2" / "−0.8" / "0.0", with a real minus sign. Null stays null. */
export function signed(v: number | null, digits = 1): string | null {
  if (v == null) return null;
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `\u2212${s}` : s;
}
