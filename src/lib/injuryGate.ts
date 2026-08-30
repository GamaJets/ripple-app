// A coach reads what a client cannot do before they write what they will do.
//
// Asked for directly: "Any injuries, when the client fills out the profile,
// this information needs to be sent to the client's profile in the coach app
// if they have hired a coach" — and then "the coach needs to acknowledge this
// before their workout program is built."
//
// ── Why the acknowledgement records WHICH injuries ────────────────────────
//
// A bare acknowledged_at is satisfied forever by one tap. A client who
// discloses a shoulder problem in March would have it silently covered by an
// acknowledgement made in January, and the coach would assign overhead press
// having never been shown it. That is the exact failure this exists to
// prevent, so the acknowledgement stores the disclosures it was made against
// and stands only while the current ones are a subset of them.
//
// Recovering from an injury therefore does NOT invalidate it — a shorter list
// is still a subset — while disclosing a new one does. Which is the right way
// round: the coach needs to be stopped by news, not by good news.
//
// ── Why it is the same shape as the overwrite guard ───────────────────────
//
// Because it is the same gesture from the coach's side: a control withheld,
// with a sentence saying why and what to do. See src/lib/overwriteGuard.ts.
import type { Injury } from './injuries';
import type { LoadStatus } from '../ui/loadStatus';

export interface InjuryGate {
  /** True only when there is nothing to acknowledge, or it has been. */
  allowed: boolean;
  /** Why the control is withheld, addressed to the coach. Null when allowed. */
  reason: string | null;
  /** What to put on the withheld control. Null when allowed, so a caller can
   *  write `gate.label ?? 'Assign'`. */
  label: string | null;
  /** The disclosures an acknowledgement made now would cover. Empty when there
   *  is nothing outstanding. This is what gets written, so the caller never
   *  has to re-derive it and risk writing a different list from the one the
   *  coach was shown. */
  outstanding: Injury[];
}

const ALLOWED: InjuryGate = { allowed: true, reason: null, label: null, outstanding: [] };

/** The identity of a disclosure for acknowledgement purposes.
 *
 *  Area and severity, not the note and not the id: a client rewording a note
 *  has not told the coach anything new, and a client whose mild knee became
 *  severe has. Ids are not used because the client app mints a fresh one when
 *  a disclosure is edited, which would invalidate the acknowledgement over a
 *  typo. */
export function injuryKey(i: Pick<Injury, 'area' | 'severity'>): string {
  return `${i.area}:${i.severity}`;
}

/**
 * May this coach assign a programme to this client?
 *
 * `status` is how the read of the acknowledgement went. Unknown is refused for
 * the same reason the overwrite guard refuses it: a programme built without
 * seeing an injury is not undone by finding out later.
 */
export function guardInjuries(
  status: LoadStatus,
  active: Injury[],
  acknowledged: string[] | null,
  clientName: string,
): InjuryGate {
  if (!active.length) return ALLOWED;

  if (status === 'loading') {
    return {
      allowed: false,
      label: 'Checking Injuries…',
      reason: `Still reading whether ${clientName}'s injuries have been acknowledged. This takes a moment.`,
      outstanding: [],
    };
  }
  if (status === 'error' || status === 'partial') {
    return {
      allowed: false,
      label: 'Injuries Could Not Be Read',
      reason: `${clientName} has disclosed injuries and this screen could not confirm they have been acknowledged. Building a programme around an injury nobody has read is the thing this check exists to stop, so it is held until the list loads.`,
      outstanding: [],
    };
  }

  const seen = new Set(acknowledged ?? []);
  const unseen = active.filter((i) => !seen.has(injuryKey(i)));
  if (!unseen.length) return ALLOWED;

  const isFirst = !acknowledged || acknowledged.length === 0;
  return {
    allowed: false,
    label: `Read ${clientName}'s Injuries First`,
    reason: isFirst
      ? `${clientName} has disclosed ${countPhrase(active.length)}. Read them and confirm before building a programme around them.`
      : `${clientName} has disclosed ${countPhrase(unseen.length)} since you last confirmed. Read the change before assigning.`,
    // The whole current list, not just the new part: an acknowledgement stands
    // for everything it was made against, and writing only the delta would
    // drop the ones acknowledged earlier out of the record.
    outstanding: active,
  };
}

function countPhrase(n: number): string {
  return n === 1 ? 'an injury' : `${n} injuries`;
}
