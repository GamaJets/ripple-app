// The release a client agrees to before they train, and the one rule that
// decides whether they have.
//
// Versioned by date on purpose. Re-wording the release later changes this
// constant, which makes every existing acceptance stop matching and asks
// everybody again — an agreement to wording nobody has read is not an
// agreement. Old rows are kept, never rewritten, so what somebody actually
// agreed to on the day remains readable.
export const WAIVER_VERSION = '2026-08-31';

export interface WaiverClause {
  key: 'physician' | 'release';
  /** The sentence beside the box. This is what they are agreeing to. */
  label: string;
  /** The detail underneath it. */
  detail: string;
}

export const WAIVER_CLAUSES: WaiverClause[] = [
  {
    key: 'physician',
    label: 'I should speak to a doctor before I start.',
    detail:
      'Exercise carries risk, and that risk is not the same for everyone. I understand I should consult a physician before beginning any workout or nutrition regime, and that Repple and my coach are not medical providers and give no medical advice.',
  },
  {
    key: 'release',
    label: 'I take part at my own risk, and release Repple from liability.',
    detail:
      'I am taking part voluntarily and accept the risk of injury, illness or worse. To the fullest extent the law allows, I release Repple, its staff and my coach from liability for any injury, loss or damage arising out of my use of this app or the training and nutrition it suggests. I will stop and seek medical help if I feel unwell.',
  },
];

/** What a read of `liability_waivers` came back with. `null` = still reading. */
export interface WaiverRead {
  /** False when the read failed. An unreadable record is NOT an unsigned one. */
  ok: boolean;
  /** Versions this person has already agreed to. */
  versions: string[];
}

export type WaiverState =
  /** Still reading — say nothing yet. */
  | 'loading'
  /** Agreed to the current wording. */
  | 'accepted'
  /** Definitely has not agreed to the current wording. */
  | 'needed'
  /** The record could not be read. Not the same as unsigned, and not the same
   *  as signed — the one thing it must never do is pass for either. */
  | 'unknown';

export function waiverState(read: WaiverRead | null): WaiverState {
  if (read == null) return 'loading';
  if (!read.ok) return 'unknown';
  return read.versions.includes(WAIVER_VERSION) ? 'accepted' : 'needed';
}

/** Whether both boxes are ticked. Both, or it is not a release. */
export function bothGiven(ticked: Record<string, boolean>): boolean {
  return WAIVER_CLAUSES.every((c) => ticked[c.key] === true);
}

/** What the gate should do, given the read and whether THIS DEVICE has seen
 *  this person accept before.
 *
 *  The interesting case is 'unknown'. Blocking somebody whose record simply
 *  could not be read does not create consent — it only denies them the app on
 *  a bad connection, which in a gym basement is the normal case rather than the
 *  edge one, and the Try Again behind that modal cannot reach the server
 *  either. So a reader this device has already watched accept is let through
 *  and re-checked next launch. Anybody else might be signing for the first
 *  time, and is asked. */
export function waiverGate(state: WaiverState, seenAcceptBefore: boolean): 'pass' | 'block' | 'wait' {
  if (state === 'loading') return 'wait';
  if (state === 'accepted') return 'pass';
  if (state === 'needed') return 'block';
  return seenAcceptBefore ? 'pass' : 'block';
}
