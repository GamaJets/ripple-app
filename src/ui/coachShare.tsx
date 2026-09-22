// The member's answer about sending their health details to the AI Coach,
// read once and remembered.
//
// A hook rather than a provider, because exactly one screen asks the question
// and exactly one screen sends the data: app/(client)/coach.tsx. A context
// mounted in app/_layout.tsx would put a read of a medical consent on the
// launch path of all three apps to serve one route. The rules it applies are in
// src/lib/coachShare.ts, which is pure and tested; this file is only the store.
//
// ── Where the answer lives ─────────────────────────────────────────────────
//
// On the account since part 2940 (applied 22 Sep 2026): an append-only log,
// one row per answer, readable only by the member. The newest row wins, so a
// reinstall or a second phone gets the answer already given instead of asking
// again. The phone keeps its own copy under its own key, outside the
// 'repple.settings' blob, so a settings migration can never clear it; when the
// account cannot be read, the phone's copy is what applies. A phone answer the
// account has never seen is carried up once, UNDATED, because the phone never
// recorded when it was given. `resolveConsent` in src/lib/coachShare.ts is the
// rule, and its tests are the cases.
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
import { COACH_SHARE_KEY, consentFromStored, storedConsent, resolveConsent, type ShareConsent } from '../lib/coachShare';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

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
      const local = consentFromStored(raw);
      // The account's record (part 2940): newest answer on the account wins,
      // so a reinstall or a second phone gets the same answer the member gave.
      let server: { share: boolean } | null | 'error' = 'error';
      if (USE_SUPABASE) {
        try {
          const { data, error } = await supabase.rpc('my_ai_coach_health_consent');
          if (error) reportError('coachShare.readAccount', error);
          else {
            const row = Array.isArray(data) ? data[0] : data;
            server = row && typeof row.share_health === 'boolean' ? { share: row.share_health } : null;
          }
        } catch (e) { reportError('coachShare.readAccount', e); }
      }
      if (!alive || answered.current) return;
      const r = resolveConsent(server, local);
      setConsent(r.consent);
      if (r.syncLocal) AsyncStorage.setItem(COACH_SHARE_KEY, storedConsent(r.syncLocal)).catch((e) => reportError('coachShare.write', e));
      // Undated on purpose: the phone never stored when the answer was given.
      if (r.carryUp && r.consent !== 'unasked') {
        const { error } = await supabase.rpc('record_ai_coach_health_consent', { p_share: r.consent === 'yes', p_carried_over: true });
        if (error) reportError('coachShare.carryUp', error);
      }
    })();
    return () => { alive = false; };
  }, []);

  const answer = useCallback((a: 'yes' | 'no') => {
    answered.current = true;
    setConsent(a);
    AsyncStorage.setItem(COACH_SHARE_KEY, storedConsent(a))
      .catch((e) => reportError('coachShare.write', e));
    // And on the account, dated now: this is the moment the member answered.
    if (USE_SUPABASE) {
      void supabase.rpc('record_ai_coach_health_consent', { p_share: a === 'yes', p_carried_over: false })
        .then(({ error }) => { if (error) reportError('coachShare.record', error); });
    }
  }, []);

  return { consent, answer };
}
