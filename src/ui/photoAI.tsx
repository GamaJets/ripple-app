// The member's answer about sending a photograph to a language model, read
// once and remembered.
//
// A hook rather than a provider, for the same reason as src/ui/coachShare.tsx:
// the screens that take a photograph are few, and mounting a read of a consent
// on the launch path of all three apps to serve them would be the wrong trade.
// The rules are in src/lib/photoAI.ts, which is pure and tested; this file is
// only the store.
//
// 'unknown' until the stored answer lands, and nothing is sent on 'unknown' —
// see mayAnalyzePhoto, which refuses it rather than trusting a caller to check.
//
// ── The subject is a required argument ────────────────────────────────────
//
// There is one answer per SUBJECT — a gym-floor photograph and a photograph of
// somebody's dinner table are two questions with two keys — and this hook will
// not default to either. A screen that has not said which question it put does
// not compile, which is the same enforcement `readInjuryDocument` uses and the
// only kind that survives somebody adding a third camera without reading
// src/lib/photoAI.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from '../lib/reportError';
import { photoAIKey, consentFromStored, storedConsent, type PhotoConsent, type PhotoSubject } from '../lib/photoAI';

export interface PhotoAI {
  consent: PhotoConsent;
  /** Record an answer. Applied to this session immediately and written behind
   *  it — a member who taps Yes must not have the next tap refused because a
   *  disk write had not finished. */
  answer: (a: 'yes' | 'no') => void;
}

export function usePhotoAI(subject: PhotoSubject): PhotoAI {
  const [consent, setConsent] = useState<PhotoConsent>('unknown');
  // Guards the read against a late landing overwriting a fresh answer.
  const answered = useRef(false);
  const key = photoAIKey(subject);

  useEffect(() => {
    let alive = true;
    // A screen that switches subject is a screen asking a different question,
    // so the answer it is holding is not an answer to it. Back to 'unknown'
    // and read again rather than carrying the old subject's yes across.
    answered.current = false;
    setConsent('unknown');
    (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(key);
      } catch (e) {
        // A failed read is not an answer. It resolves to 'unasked' — the
        // question gets put again, which is the only safe direction for a
        // consent whose stored state we could not establish.
        reportError('photoAI.read', e);
      }
      if (!alive || answered.current) return;
      setConsent(consentFromStored(raw));
    })();
    return () => { alive = false; };
  }, [key]);

  const answer = useCallback((a: 'yes' | 'no') => {
    answered.current = true;
    setConsent(a);
    AsyncStorage.setItem(key, storedConsent(a))
      .catch((e) => reportError('photoAI.write', e));
  }, [key]);

  return { consent, answer };
}
