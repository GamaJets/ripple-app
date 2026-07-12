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
