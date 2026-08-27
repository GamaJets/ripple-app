// Gym analytics — pure functions over the gym's own roster.
//
// `profiles.role = 'owner'` means a gym owner, so these describe a gym, not
// Repple's SaaS business. The previous version scored trainers on `plan`, `mrr`
// and `status: suspended` — what a trainer pays Repple, which is not a figure a
// gym owner has any business seeing on their own dashboard, and which nothing
// in the database was writing anyway.
//
// What a gym owner actually knows about a coach: how many clients they carry
// and how many sessions they actually delivered. Both come from rows.
// No UI, no state → unit-testable.

export interface TrainerLike {
  id: string;
  name: string;
  /** Clients assigned to this trainer. */
  clients: number;
  /**
   * Sessions booked in the last 30 days whose start time has passed — what the
   * record shows took place, which is not the same as confirmed delivered.
   */
  sessions30: number;
  /** Sessions confirmed delivered. Absent on callers that do not track it. */
  delivered30?: number;
  /** Booked, finished, and awaiting an outcome. Absent on older callers. */
  unmarked30?: number;
  /** ISO timestamp they joined, or null. */
  since?: string | null;
}

export type Risk = 'ok' | 'watch' | 'high' | 'idle';
export type Tone = 'good' | 'moderate' | 'low';

export interface Health {
  score: number;   // 0..100
  tone: Tone;
  risk: Risk;
  reason: string;  // short, human
}

/**
 * Health from the two things a gym can observe: client load and delivered
 * sessions. A coach with clients who is running no sessions is the signal an
 * owner wants — it is invisible on a headcount.
 */
export function trainerHealth(tr: TrainerLike): Health {
  const clients = tr.clients || 0;
  const sessions = tr.sessions30 || 0;

  if (clients === 0 && sessions === 0) {
    return { score: 0, tone: 'low', risk: 'idle', reason: 'No clients and no sessions in the last 30 days.' };
  }

  // Client load and delivery weigh roughly equally; 12 clients and 20 sessions
  // in a month is a full book, not a ceiling on quality.
  const clientPts = Math.min(clients, 12) / 12 * 50;
  const sessionPts = Math.min(sessions, 20) / 20 * 50;
  const score = Math.max(0, Math.min(100, Math.round(clientPts + sessionPts)));

  let risk: Risk, reason: string;
  if (clients > 0 && sessions === 0) {
    risk = 'high';
    reason = `${clients} client${clients === 1 ? '' : 's'} but no sessions delivered in 30 days.`;
  } else if (clients === 0) {
    risk = 'watch';
    reason = 'Delivering sessions but has no clients on the roster.';
  } else if (sessions < 4) {
    risk = 'watch';
    reason = 'Few sessions delivered this month.';
  } else {
    risk = 'ok';
    reason = 'Carrying clients and delivering sessions.';
  }
  const tone: Tone = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'low';
  return { score, tone, risk, reason };
}

export interface GymRollup {
  trainers: number;
  clients: number;
  /** Sessions across the gym whose start time has passed, marked or not. */
  sessions30: number;
  /** Sessions confirmed delivered across the gym. */
  delivered30: number;
  /** Sessions still awaiting an outcome. Payroll cannot settle over these. */
  unmarked30: number;
  /**
   * Worth of the confirmed sessions at the tenant's fee. Null when no fee is
   * set, and null while sessions are unmarked — pricing those would mean
   * paying for no-shows and un-cancelled slots.
   */
  payroll30: number | null;
  /** Trainers flagged watch/high/idle. */
  atRiskCount: number;
  /** Clients carried by those trainers — the exposure, not the headcount. */
  atRiskClients: number;
  /** NULL with no trainers. An average over an empty set is undefined, and 0
   *  said "every trainer carries no clients" to a gym that has no trainers. */
  avgClientsPerTrainer: number | null;
  avgSessionsPerTrainer: number | null;
}

export function gymRollup(trainers: TrainerLike[], sessionFee: number | null): GymRollup {
  const clients = trainers.reduce((a, t) => a + (t.clients || 0), 0);
  const sessions30 = trainers.reduce((a, t) => a + (t.sessions30 || 0), 0);
  const delivered30 = trainers.reduce((a, t) => a + (t.delivered30 ?? 0), 0);
  const unmarked30 = trainers.reduce((a, t) => a + (t.unmarked30 ?? 0), 0);
  let atRiskCount = 0, atRiskClients = 0;
  for (const t of trainers) {
    const h = trainerHealth(t);
    if (h.risk !== 'ok') { atRiskCount++; atRiskClients += t.clients || 0; }
  }
  const n = trainers.length;
  return {
    trainers: n,
    clients,
    sessions30,
    delivered30,
    unmarked30,
    payroll30:
      sessionFee == null || unmarked30 > 0 ? null : Math.round(delivered30 * sessionFee),
    atRiskCount,
    atRiskClients,
    avgClientsPerTrainer: n ? Math.round((clients / n) * 10) / 10 : null,
    avgSessionsPerTrainer: n ? Math.round((sessions30 / n) * 10) / 10 : null,
  };
}

export interface Cohort { label: string; total: number; active: number; pct: number }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "2026-08-19T…" → "Aug 2026". Null/unparseable → null, never a guess. */
function monthLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Trainers grouped by the month they joined, with the share still delivering.
 * Trainers whose join date is unknown are left out rather than bucketed into a
 * fabricated "Unknown" cohort that would drag every percentage.
 */
export function cohorts(trainers: TrainerLike[]): Cohort[] {
  const map = new Map<string, { total: number; active: number; key: number }>();
  for (const t of trainers) {
    const label = monthLabel(t.since);
    if (!label) continue;
    const d = new Date(Date.parse(t.since as string));
    const key = d.getFullYear() * 12 + d.getMonth();
    const cur = map.get(label) || { total: 0, active: 0, key };
    cur.total++;
    if ((t.sessions30 || 0) > 0) cur.active++;
    map.set(label, cur);
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, total: v.total, active: v.active, pct: Math.round((v.active / v.total) * 100), key: v.key }))
    .sort((a, b) => a.key - b.key)
    .map(({ key, ...rest }) => rest);
}

/** The gym's members, seen through who coaches them. */
export interface ClientAnalytics {
  total: number;
  /** Clients whose trainer is healthy. */
  engaged: number;
  /** Clients whose trainer is flagged. */
  atRisk: number;
  /** NULL with no clients — a percentage of nobody. */
  engagementPct: number | null;
  /** NULL with no trainers — an average over an empty set. */
  avgPerTrainer: number | null;
  /** Client load per trainer, biggest book first. */
  byTrainer: { id: string; name: string; clients: number; pct: number }[];
}

export function clientAnalytics(trainers: TrainerLike[]): ClientAnalytics {
  const total = trainers.reduce((a, t) => a + (t.clients || 0), 0);
  let engaged = 0, atRisk = 0;
  for (const tr of trainers) {
    const c = tr.clients || 0;
    if (trainerHealth(tr).risk === 'ok') engaged += c; else atRisk += c;
  }
  const byTrainer = trainers
    .map((t) => ({ id: t.id, name: t.name, clients: t.clients || 0, pct: total ? Math.round(((t.clients || 0) / total) * 100) : 0 }))
    .sort((a, b) => b.clients - a.clients);
  return {
    total, engaged, atRisk,
    engagementPct: total ? Math.round((engaged / total) * 100) : null,
    avgPerTrainer: trainers.length ? Math.round((total / trainers.length) * 10) / 10 : null,
    byTrainer,
  };
}
