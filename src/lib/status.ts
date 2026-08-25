// One status vocabulary for the whole product.
//
// Repple had grown two scales that overlapped without agreeing. A client was
// On track / Watch / At risk; a trainer was Healthy / Not delivering / Watch /
// Idle. They shared one word — "Watch" — which made them look like the same
// scale while their other rungs did not correspond to anything. An owner
// reading both screens had no way to know whether a trainer marked "Healthy"
// and a client marked "On track" meant the same degree of fine.
//
// The settled scale is three levels of concern plus one state that is not a
// level at all:
//
//   on_track — nothing to do
//   watch    — worth a look before it becomes a problem
//   at_risk  — needs attention now
//   idle     — no recent activity, so there is nothing to judge
//
// `idle` is deliberately outside the ranking. A trainer with no sessions this
// month is not "doing badly"; there is simply nothing to assess, and grading
// absence as failure is how a dashboard starts lying about people.
//
// On "Not delivering": it was printed beside a person's name on their
// employer's dashboard. A status on an operations screen should describe the
// situation the numbers show, not deliver a verdict on the person — especially
// when the underlying signal is a session count that a holiday or an injury
// explains. "At risk" says the same thing about the work without saying it
// about the human.

export type StatusLevel = 'on_track' | 'watch' | 'at_risk' | 'idle';

export const STATUS_LABEL: Record<StatusLevel, string> = {
  on_track: 'On track',
  watch: 'Watch',
  at_risk: 'At risk',
  idle: 'Idle',
};

/** Ranking for sorting: worst first. `idle` sorts last — it is not a concern
 *  level, and floating it to the top would bury the rows that need action. */
export const STATUS_RANK: Record<StatusLevel, number> = {
  at_risk: 0,
  watch: 1,
  on_track: 2,
  idle: 3,
};

/**
 * Map the risk keys `trainerHealth()` returns onto the settled scale.
 *
 * Kept as a translation rather than renaming the keys at source: the keys are
 * what the scoring function computes and are meaningful to it, while these are
 * what a person reads. Anything unrecognised becomes `idle` — "no assessment"
 * is the honest answer to a value we cannot interpret, and safer than
 * defaulting to either end of the scale.
 */
export function statusFromRisk(risk: string): StatusLevel {
  switch (risk) {
    case 'high': return 'at_risk';
    case 'watch': return 'watch';
    case 'ok': return 'on_track';
    case 'idle': return 'idle';
    default: return 'idle';
  }
}

/** The label for a risk key, ready to print. */
export function riskLabel(risk: string): string {
  return STATUS_LABEL[statusFromRisk(risk)];
}
