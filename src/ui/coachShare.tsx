// The member's answer about sending their health details to the AI Coach,
// read once and remembered.
//
// A hook rather than a provider, because exactly one screen asks the question
// and exactly one screen sends the data: app/(client)/coach.tsx. A context
// mounted in app/_layout.tsx would put a read of a medical consent on the
// launch path of all three apps to serve one route. The rules it applies are in
// src/lib/coachShare.ts, which is pure and tested; this file is only the store.
//
// ── Why the answer is device-local, and what that costs ───────────────────
//
// It is in AsyncStorage under its own key, not in `clients` and not in the
// 'repple.settings' blob. Two reasons, and the second is the honest one:
//
//   · The settings blob is device settings, and a settings migration that
//     rewrites it must never be able to silently clear an answer somebody gave
//     about their medical data. Its own key cannot be collateral damage.
//   · Following the account would need a column and a migration, and this
//     change is not permitted to apply SQL. So it is device-local for now, and
//     the cost is real and specific: a member who reinstalls, or who signs in
//     on a second handset, is ASKED AGAIN. That is the right failure — being
//     asked twice costs a tap, and inheriting a "yes" onto a device where the
//     question was never put would be the defect this replaces, pointing the
//     other way.
//
// ── Why 'unknown' is a state and not a default ────────────────────────────
//
// AsyncStorage is asynchronous, so between the first render and the read
// landing, nobody in this process knows the answer. A boolean would have to
// pick one, and both choices are wrong: 'no' would silently withhold data from
// somebody who agreed, and 'yes' would send a stranger's body composition on
// the strength of a race. Nothing is sent while it is 'unknown', and
// `shareableContext` refuses on it rather than trusting the caller to check.
// This is the same argument, and the same shape, as src/lib/pushConsent.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from '../lib/reportError';
import { COACH_SHARE_KEY, consentFromStored, storedConsent, type ShareConsent } from '../lib/coachShare';

export interface CoachShare {
  /** 'unknown' until the stored answer has been read. Nothing goes out on it. */
  consent: ShareConsent;
  /** Record an answer. Applied to this session immediately and written behind
   *  it — a member who taps Yes and types a question must not have their
   *  question refused because a disk write had not finished. */
  answer: (a: 'yes' | 'no') => void;
}

export function useCoachShare(): CoachShare {
  const [consent, setConsent] = useState<ShareConsent>('unknown');
  // Guards the read against a late landing overwriting a fresh answer: a
  // member who is quick enough to tap Yes before AsyncStorage comes back would
  // otherwise be put back to 'unasked' by their own first launch.
  const answered = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(COACH_SHARE_KEY);
      } catch (e) {
        // A failed read is not an answer. Leaving it 'unknown' would strand the
        // screen with no way forward, so it resolves to 'unasked' — the
        // question gets put again, which is the only safe direction for a
        // consent whose stored state we could not establish.
        reportError('coachShare.read', e);
      }
      if (!alive || answered.current) return;
      setConsent(consentFromStored(raw));
    })();
    return () => { alive = false; };
  }, []);

  const answer = useCallback((a: 'yes' | 'no') => {
    answered.current = true;
    setConsent(a);
    AsyncStorage.setItem(COACH_SHARE_KEY, storedConsent(a))
      .catch((e) => reportError('coachShare.write', e));
  }, []);

  return { consent, answer };
}
