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

/** How a set of acknowledged keys stands against the disclosures of the day.
 *
 *  Split out of `guardInjuries` because the CLIENT is shown the same fact from
 *  the other side — "your coach has read these" — and the two sides must not be
 *  able to disagree about what "read" means. One function, two readers.
 *
 *   'unknown' — the read did not finish or did not land. Nothing may be
 *               claimed in either direction, least of all to the client.
 *   'none'    — nothing has ever been acknowledged for them.
 *   'stale'   — something was, and something has been disclosed since.
 *   'covered' — every current disclosure is inside what was acknowledged.
 */
export type AckState = 'unknown' | 'none' | 'stale' | 'covered';

export function ackState(
  status: LoadStatus,
  active: Injury[],
  acknowledged: string[] | null,
): AckState {
  // 'partial' is not 'ready' here for the same reason it is not anywhere else:
  // a list that is some of the acknowledged keys cannot tell a disclosure that
  // was never acknowledged from one whose key did not come back.
  if (status !== 'ready') return 'unknown';
  if (!acknowledged || !acknowledged.length) return 'none';
  const seen = new Set(acknowledged);
  return active.every((i) => seen.has(injuryKey(i))) ? 'covered' : 'stale';
}

/** How the SECOND client-side read stands — the programmes a coach assigned
 *  knowing about a disclosure.
 *
 *  Separate from `ackState` because it is a separate table and a separate
 *  failure. Folding the two together is what let a screen print "we couldn't
 *  check whether your coach has read these" over an acknowledgement that had
 *  been read, while the block that really had failed rendered as nothing at
 *  all — a member reading that concludes their coach assigned nothing over
 *  their knee, which is the one conclusion a failed read must not produce.
 *
 *   'unknown' — the read did not finish or did not land. An empty list here
 *               means we do not know, and the screen must say so.
 *   'none'    — the read finished and there are none. Sayable as a fact.
 *   'some'    — the read finished and these are all of them.
 *   'partial' — the rows are real but there are more than came back. The list
 *               may be shown; "these are all of them" may not.
 */
export type ChoiceState = 'unknown' | 'none' | 'some' | 'partial';

export function programmeChoiceState(status: LoadStatus, count: number): ChoiceState {
  // whole-ok: 'partial' is a value of this function's own return type and it is
  // produced on the very next line — the type comment above lists all four
  // answers precisely so 'partial' would not have to hide inside one of the
  // others. This guard means "the read did not land", and a truncated read did
  // land: some programmes assigned over a disclosure are known to exist, which
  // is not 'unknown' and is not "these are all of them" either. Note that a
  // truncated read with a zero count still goes to 'unknown' below, because a
  // count of zero off a prefix is the one number a prefix cannot supply.
  if (status === 'error' || status === 'loading') return 'unknown';
  if (status === 'partial') return count > 0 ? 'partial' : 'unknown';
  return count > 0 ? 'some' : 'none';
}

/**
 * May this coach assign a programme to this client?
 *
 * `disclosures` is how the read of the client's OWN injury list went, and
 * `status` is how the read of the acknowledgement went. Both unknowns are
 * refused for the same reason the overwrite guard refuses one: a programme
 * built without seeing an injury is not undone by finding out later.
 */
export function guardInjuries(
  disclosures: LoadStatus,
  status: LoadStatus,
  active: Injury[],
  acknowledged: string[] | null,
  clientName: string,
): InjuryGate {
  // Asked before the empty-list shortcut below, and that order is the whole
  // point. An empty `active` means "they have disclosed nothing" only when the
  // read that produced it finished; under a failed one it means we did not find
  // out. The builder read its client out of the roster, and a roster read that
  // failed left no client, no injuries, and a gate that opened on the silence —
  // the coach was free to assign around disclosures nobody had shown them. It
  // is the same mistake as printing "no injuries disclosed" over a read that
  // never landed, made where it costs somebody their training.
  if (disclosures === 'loading') {
    return {
      allowed: false,
      label: 'Checking Injuries…',
      reason: `Still reading whether ${clientName} has disclosed any injuries. This takes a moment.`,
      outstanding: [],
    };
  }
  if (disclosures === 'error' || disclosures === 'partial') {
    return {
      allowed: false,
      label: 'Injuries Could Not Be Read',
      reason: `${clientName}'s injuries could not be read, so this screen cannot tell whether they have disclosed any. Assigning on the assumption that they have not is exactly what this check exists to stop, so it is held until they load.`,
      outstanding: [],
    };
  }

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
