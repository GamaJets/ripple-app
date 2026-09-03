// The member's per-category notification choices, stored on this device.
//
// ── Why the device and not the server ─────────────────────────────────────
//
// Everything these preferences gate is scheduled BY THIS PHONE — the session
// reminder for a booking, the class reminder, the streak nudge, the badge
// banner, every daily reminder. A phone is where those decisions are taken and
// where they have to be read synchronously (see src/lib/notifyPrefsLatch.ts),
// so a server round trip would add a race to a question that has no network
// component.
//
// The honest cost of that is stated on the screen: a second handset has its own
// answer. That is arguably right for quiet hours — a work phone and a personal
// phone genuinely have different nights — and arguably wrong for the categories.
// Moving the categories to the server is the change that would let the
// send-push edge function honour them too, which is what the 'coach' category
// needs before it can become a switch at all.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NOTIFY_PREFS, prefsFromStored, type NotifyCategory, type NotifyPrefs,
} from '../lib/notifyPrefs';
import { setNotifyPrefsLatch } from '../lib/notifyPrefsLatch';
import { useAuthRevision } from './authRevision';

const KEY = 'repple.notifyPrefs';

interface Value {
  prefs: NotifyPrefs;
  /** False until the stored answer has been read. The screen shows the
   *  defaults meanwhile and says nothing about them being the member's, because
   *  they may not be. */
  loaded: boolean;
  setCategory: (key: NotifyCategory, on: boolean) => void;
  setQuiet: (on: boolean) => void;
  setQuietHours: (fromHour: number, toHour: number) => void;
}

const Ctx = createContext<Value | null>(null);

export function NotifyPrefsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_NOTIFY_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let raw: string | null = null;
      try { raw = await AsyncStorage.getItem(KEY); } catch { raw = null; }
      if (cancelled) return;
      const next = prefsFromStored(raw);
      // The latch first, then React state. Anything scheduling a notification
      // in this same tick reads the latch, and a gate that lagged a render
      // behind would let through exactly the notification the member had
      // turned off.
      setNotifyPrefsLatch(next);
      setPrefs(next);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
    // Re-read on every change of signed-in account, not once per mount. These
    // preferences are one person's answers under a device-local key, and
    // signing out now clears that key (src/lib/signOutState.ts) — so without
    // this the CLEARED preferences would go on being applied from memory for
    // the rest of the session, and the next person to sign in on the handset
    // would still be under the previous member's quiet hours until the app was
    // killed. Re-reading finds nothing and seeds the defaults, latch first,
    // exactly as it does at launch.
  }, [authRev]);

  const write = useCallback((next: NotifyPrefs) => {
    // Latch, state, then storage — in that order and deliberately. A member who
    // turns off daily reminders and immediately taps Save on the reminders
    // screen must not race their own AsyncStorage write and schedule the thing
    // they just turned off.
    setNotifyPrefsLatch(next);
    setPrefs(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {
      // The choice is live for this session and will be forgotten at the next
      // launch. Not rolled back: undoing a switch the member just flipped, in
      // front of them, because a write failed is a worse answer than honouring
      // it for now.
    });
  }, []);

  const setCategory = useCallback((key: NotifyCategory, on: boolean) => {
    setPrefs((cur) => {
      const off = { ...cur.off };
      // Turning one back ON deletes the key rather than storing `false`. The
      // absence of a key is the "not answered" state and it is what `allows`
      // reads as on, so the two must not become three.
      if (on) delete off[key]; else off[key] = true;
      const next = { ...cur, off };
      write(next);
      return next;
    });
  }, [write]);

  const setQuiet = useCallback((on: boolean) => {
    setPrefs((cur) => { const next = { ...cur, quiet: on }; write(next); return next; });
  }, [write]);

  const setQuietHours = useCallback((fromHour: number, toHour: number) => {
    const clamp = (n: number) => Math.min(23, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
    setPrefs((cur) => {
      const next = { ...cur, quietFromHour: clamp(fromHour), quietToHour: clamp(toHour) };
      write(next);
      return next;
    });
  }, [write]);

  return (
    <Ctx.Provider value={{ prefs, loaded, setCategory, setQuiet, setQuietHours }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifyPrefs(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifyPrefs must be used inside <NotifyPrefsProvider>');
  return v;
}
