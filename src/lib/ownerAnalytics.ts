// Owner analytics — pure functions that turn the trainer roster into real
// operating signals: a per-trainer health score, churn risk, and platform
// roll-ups (at-risk MRR, trial conversion). No UI, no state → unit-testable.

export interface TrainerLike {
  id: string; name: string; plan: string; clients: number; mrr: number;
  status: 'active' | 'trial' | 'suspended'; since?: string;
}

export type Risk = 'ok' | 'watch' | 'high' | 'suspended';
export type Tone = 'good' | 'moderate' | 'low';

export interface Health {
  score: number;   // 0..100
  tone: Tone;
  risk: Risk;
  reason: string;  // short, human
}

/** Health from what we know: paying-vs-trial, client load, and engagement. */
export function trainerHealth(tr: TrainerLike): Health {
  if (tr.status === 'suspended') {
    return { score: 0, tone: 'low', risk: 'suspended', reason: 'Suspended — no active revenue.' };
  }
  const statusPts = tr.status === 'active' ? 45 : 25;          // paying beats trial
  const clientPts = Math.min(tr.clients, 12) / 12 * 45;        // client load
  const engagePts = tr.clients > 0 ? 10 : 0;                   // any activity at all
  const score = Math.max(0, Math.min(100, Math.round(statusPts + clientPts + engagePts)));

  let risk: Risk, reason: string;
  if (tr.clients === 0) {
    risk = 'high';
    reason = tr.status === 'trial' ? 'Trial with no clients yet — nudge onboarding.' : 'Paying but zero clients — likely to cancel.';
  } else if (tr.clients <= 1) {
    risk = 'watch';
    reason = 'Only just started adding clients.';
  } else {
    risk = 'ok';
    reason = tr.status === 'trial' ? 'Trial going well — ripe to convert.' : 'Healthy and active.';
  }
  const tone: Tone = score >= 70 ? 'good' : score >= 45 ? 'moderate' : 'low';
  return { score, tone, risk, reason };
}

export interface PlatformRollup {
  mrr: number;
  arr: number;
  trainers: number;
  paying: number;
  trial: number;
  suspended: number;
  clients: number;
  atRiskMrr: number;       // active/trial revenue on trainers flagged watch/high
  atRiskCount: number;
  trialConversionPct: number | null; // paying / (paying + trial)
  avgClientsPerTrainer: number;
}

export function platformRollup(trainers: TrainerLike[]): PlatformRollup {
  const active = trainers.filter((t) => t.status !== 'suspended');
  const mrr = active.reduce((a, t) => a + (t.mrr || 0), 0);
  const paying = trainers.filter((t) => t.status === 'active').length;
  const trial = trainers.filter((t) => t.status === 'trial').length;
  const suspended = trainers.filter((t) => t.status === 'suspended').length;
  const clients = trainers.reduce((a, t) => a + (t.clients || 0), 0);
  let atRiskMrr = 0, atRiskCount = 0;
  for (const t of trainers) {
    const h = trainerHealth(t);
    if (t.status !== 'suspended' && (h.risk === 'high' || h.risk === 'watch')) { atRiskMrr += t.mrr || 0; atRiskCount++; }
  }
  return {
    mrr, arr: mrr * 12, trainers: trainers.length, paying, trial, suspended, clients,
    atRiskMrr, atRiskCount,
    trialConversionPct: paying + trial > 0 ? Math.round((paying / (paying + trial)) * 100) : null,
    avgClientsPerTrainer: trainers.length ? Math.round((clients / trainers.length) * 10) / 10 : 0,
  };
}

export interface Cohort { label: string; total: number; active: number; pct: number }

const MONTH_IDX: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function sinceKey(since?: string): number {
  if (!since) return 0;
  const m = /([A-Za-z]{3})\s+(\d{4})/.exec(since);
  if (!m) return 0;
  const mi = MONTH_IDX[m[1].toLowerCase()] ?? 0;
  return parseInt(m[2], 10) * 12 + mi;
}

/** Group trainers by signup month → retention (% still active). Oldest first. */
export function cohorts(trainers: TrainerLike[]): Cohort[] {
  const map = new Map<string, { total: number; active: number; key: number }>();
  for (const t of trainers) {
    const label = t.since || "Unknown";
    const cur = map.get(label) || { total: 0, active: 0, key: sinceKey(t.since) };
    cur.total++;
    if (t.status !== "suspended") cur.active++;
    map.set(label, cur);
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, total: v.total, active: v.active, pct: Math.round((v.active / v.total) * 100), key: v.key }))
    .sort((a, b) => a.key - b.key)
    .map(({ key, ...rest }) => rest);
}

// Platform-wide end-client analytics (owner #7): total end-clients, an
// engagement proxy (clients served by a healthy vs at-risk trainer), average
// per trainer, and the client distribution by plan. Pure over the roster.
export interface ClientAnalytics {
  total: number;
  engaged: number;      // clients on trainers whose health.risk is 'ok'
  atRisk: number;       // clients on watch/high/suspended trainers
  engagementPct: number;
  avgPerTrainer: number;
  byPlan: { plan: string; clients: number; pct: number }[];
}

export function clientAnalytics(trainers: TrainerLike[]): ClientAnalytics {
  const total = trainers.reduce((a, t) => a + (t.clients || 0), 0);
  let engaged = 0, atRisk = 0;
  const planMap: Record<string, number> = {};
  for (const tr of trainers) {
    const c = tr.clients || 0;
    const h = trainerHealth(tr);
    if (tr.status !== 'suspended' && h.risk === 'ok') engaged += c; else atRisk += c;
    const key = tr.plan || '—';
    planMap[key] = (planMap[key] || 0) + c;
  }
  const byPlan = Object.entries(planMap)
    .map(([plan, clients]) => ({ plan, clients, pct: total ? Math.round((clients / total) * 100) : 0 }))
    .sort((a, b) => b.clients - a.clients);
  return {
    total, engaged, atRisk,
    engagementPct: total ? Math.round((engaged / total) * 100) : 0,
    avgPerTrainer: trainers.length ? Math.round((total / trainers.length) * 10) / 10 : 0,
    byPlan,
  };
}
