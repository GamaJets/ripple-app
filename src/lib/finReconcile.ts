// Reconciling a figure the owner typed against the same figure Repple can
// work out for itself.
//
// The financial-health screen asks an owner to type their recurring membership
// revenue and their active member count. Both are things the database already
// knows: memberships on priced plans give one, memberships with status
// 'active' give the other. Two sources for one number that nothing compares is
// how a console starts contradicting itself — one screen says AED 40,000 and
// another says AED 34,500, and neither admits the other exists.
//
// This does not pick a winner. An owner typing a different number from the one
// the records imply is usually right about something the records do not hold —
// a corporate contract invoiced annually offline, a plan whose price changed
// mid-month. Silently overwriting that would replace one wrong number with
// another and lose the owner's knowledge in the process. So the rule is:
// surface the difference, name both figures, and let the person decide.

export type Agreement =
  /** Nothing is recorded, so there is nothing to compare against. */
  | 'no_record'
  /** Records exist but the owner has not typed anything yet. */
  | 'not_entered'
  /** Both exist and match within tolerance. */
  | 'agrees'
  /** Both exist and disagree. */
  | 'differs';

export interface Reconciliation {
  state: Agreement;
  /** What the owner typed. */
  typed: number;
  /** What the records imply, or null when nothing is recorded. */
  derived: number | null;
  /** derived − typed, or null when either side is missing. */
  delta: number | null;
  /** How far apart they are as a share of the derived figure, 0–1. */
  driftPct: number | null;
}

/**
 * Compare a typed figure with a derived one.
 *
 * `tolerance` is a fraction of the derived value, not an absolute amount, so
 * the same rule works for a figure in dirhams and a headcount. It defaults to
 * 2%: rounding, a payment landing a day late or a mid-month price change should
 * not raise a flag, but a genuinely different number should.
 *
 * A derived value of null means the records hold nothing — no priced plan, no
 * membership. That is `no_record`, never a derived zero, because "we have not
 * recorded it" and "it is nothing" are different answers and only one of them
 * should make an owner doubt what they typed.
 */
export function reconcile(
  typed: number,
  derived: number | null,
  tolerance = 0.02,
): Reconciliation {
  if (derived == null) {
    return { state: 'no_record', typed, derived: null, delta: null, driftPct: null };
  }
  if (!typed) {
    return { state: 'not_entered', typed, derived, delta: null, driftPct: null };
  }
  const delta = derived - typed;
  // Guard the divide: a derived zero is a real measurement (nobody active), but
  // it cannot be a denominator.
  const driftPct = derived === 0 ? (delta === 0 ? 0 : 1) : Math.abs(delta) / Math.abs(derived);
  return {
    state: driftPct <= tolerance ? 'agrees' : 'differs',
    typed,
    derived,
    delta,
    driftPct,
  };
}

/**
 * A sentence for the screen, or null when there is nothing worth saying.
 *
 * `agrees` returns null on purpose. A console that congratulates itself every
 * time two numbers match trains people to stop reading it; the interesting
 * states are the ones that need an action.
 */
export function reconcileNote(
  r: Reconciliation,
  label: string,
  fmt: (n: number) => string = String,
): string | null {
  switch (r.state) {
    case 'no_record':
      return `Nothing recorded yet, so your ${label} cannot be checked against the register.`;
    case 'not_entered':
      return `Your records show ${fmt(r.derived as number)}. Use that, or type your own figure.`;
    case 'differs':
      return `Your records show ${fmt(r.derived as number)}, which is ${fmt(Math.abs(r.delta as number))} ${
        (r.delta as number) > 0 ? 'more' : 'less'
      } than the ${fmt(r.typed)} entered here.`;
    case 'agrees':
    default:
      return null;
  }
}
