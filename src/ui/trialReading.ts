// One trial read, for both screens that talk about the trial.
//
// ── What this exists to stop happening again ───────────────────────────────
//
// On 3 September 2026 two lanes on a simulator, minutes apart, saw the coach
// app say two different things about one account:
//
//     Clients tab   "12 days left in your free trial."
//     Billing       "When your trial started could not be read, so nothing
//                    here says how long is left."
//
// Both screens were doing what their own code said. The Clients tab rendered
// `trialInfo()` — an AsyncStorage counter on the handset that cannot fail and
// is not about the account. Billing rendered `readTrial(fetchAccountTrial())`
// — a round trip that can. Neither knew the other existed.
//
// Wording either screen more carefully would have fixed that particular pair
// of sentences and left the mechanism intact: two sources, two clocks, two
// render paths, agreeing only while nothing went wrong. So the read is here,
// once, and both screens consume the same `TrialReading` and the same
// `Date.now()`. They cannot diverge without this file diverging from itself.
//
// ── Why the device figure is still read ────────────────────────────────────
//
// Not to be printed. `src/lib/trial.ts` is kept for exactly one purpose —
// `trialDisagreement` — because the gap between the phone's number and the
// account's IS the leak part 191 closes, and a coach who has reinstalled twice
// is entitled to see that the app noticed. It is handed to that function and
// to nothing else; `trialCard` never sees it.
//
// ── The clock ──────────────────────────────────────────────────────────────
//
// `Date.now()` is read inside `load`, not in a memo. These are tabs registered
// `href: null` that never unmount, so a clock captured at mount would still be
// counting down from yesterday at breakfast tomorrow. Both callers re-run
// `load` on focus, which is also what makes a figure change after the coach
// leaves the app open overnight.
import { useCallback, useEffect, useState } from 'react';
import { trialInfo } from '../lib/trial';
import { readTrial, type TrialReading } from '../lib/trialGate';
import { fetchAccountTrial } from './trialAccount';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';

export interface TrialRead {
  /** The account's answer, in one of its four states. Never null: 'loading' is
   *  a state of the reading rather than the absence of one, so no caller has
   *  to invent a sentence for the frame before the first read lands. */
  reading: TrialReading;
  /**
   * What THIS PHONE has recorded, or null when even that could not be read.
   *
   * For `trialDisagreement` and nothing else. It is not a fact about the
   * account and no screen prints it.
   */
  localDaysLeft: number | null;
  reload: () => Promise<void>;
}

/** The honest first frame: a request is out, and that is all anybody knows. */
const LOADING: TrialReading = readTrial(null, 'loading', 0);

export function useTrialReading(): TrialRead {
  const authRev = useAuthRevision();
  const [reading, setReading] = useState<TrialReading>(LOADING);
  const [localDaysLeft, setLocalDaysLeft] = useState<number | null>(null);

  const load = useCallback(async () => {
    // Both reads together, and neither allowed to take the other down:
    // `trialInfo` touches AsyncStorage and `fetchAccountTrial` touches the
    // network, and a phone with full storage must not blank the account's
    // answer any more than a flat connection may blank the phone's.
    const [acct, local] = await Promise.allSettled([fetchAccountTrial(), trialInfo()]);
    // One clock, read after both landed, so the figure the card prints and the
    // figure the disagreement line is computed from cannot differ by the width
    // of a render.
    const now = Date.now();
    if (acct.status === 'fulfilled') {
      setReading(readTrial(acct.value.startedAt, acct.value.status, now));
    } else {
      reportError('trialReading.account', acct.reason);
      // A rejection is a read that did not come back, which is 'unread' and
      // never 'no start date' — the second would be a claim about the account.
      setReading(readTrial(null, 'error', now));
    }
    setLocalDaysLeft(local.status === 'fulfilled' ? local.value.daysLeft : null);
  }, []);

  // `authRev` and not a bare mount: signing out and back in as somebody else
  // must not leave the previous coach's trial on the screen.
  useEffect(() => { void load(); }, [load, authRev]);

  return { reading, localDaysLeft, reload: load };
}
