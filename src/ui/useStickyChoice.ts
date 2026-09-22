// A segment or range choice that the screen remembers between visits.
// Review rule 8: the filter stays on the card it changes, and it stays put.
// Why the handset and why sign-out leaves it: src/lib/stickyChoice.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseStickyChoice, stickyChoiceKey } from '../lib/stickyChoice';

/**
 * `useState` for a choice of one from a fixed set, persisted per device.
 *
 * Paints with `fallback`, then adopts the stored choice once it is read — unless
 * the person has already tapped one, which always wins over a slow read. A stored
 * value that is not in `allowed` is ignored. Storage failing costs only the memory.
 */
export function useStickyChoice<K extends string>(key: string, allowed: readonly K[], fallback: K): [K, (k: K) => void] {
  const [value, setValue] = useState<K>(fallback);
  const touched = useRef(false);
  const storageKey = stickyChoiceKey(key);
  // `allowed` is usually an inline array; hydrate once per key, not per render.
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const got = parseStickyChoice(await AsyncStorage.getItem(storageKey), allowedRef.current);
        if (live && got && !touched.current) setValue(got);
      } catch { /* keep the default */ }
    })();
    return () => { live = false; };
  }, [storageKey]);

  const choose = useCallback((k: K) => {
    touched.current = true;
    setValue(k);
    AsyncStorage.setItem(storageKey, k).catch(() => {});
  }, [storageKey]);

  return [value, choose];
}
