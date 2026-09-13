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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NOTIFY_PREFS, prefsFromStored, type NotifyCategory, type NotifyPrefs,
} from '../lib/notifyPrefs';
import { setNotifyPrefsLatch } from '../lib/notifyPrefsLatch';
import { useAuthRevision } from './authRevision';

const KEY = 'repple.notifyPrefs';

/**
 * What a write to this device actually did.
 *
 *   'stored'     the latch, the state and AsyncStorage all took it.
 *   'not-stored' the latch and the state took it — so the choice is live for
 *                this session — and the store refused, so it will be forgotten
 *                at the next launch. A screen must not print "Saved" over this.
 *   'refused'    NOTHING happened. The stored preferences were never read, so
 *                writing would replace the member's own answers with this
 *                screen's defaults. See `read` below.
 */
export type PrefWrite = 'stored' | 'not-stored' | 'refused';

interface Value {
  prefs: NotifyPrefs;
  /**
   * Which of the three the stored answer is in — the same three the reminders
   * screen keeps, and for the same reason.
   *
   *   'loading'  the store has not answered yet. `prefs` is the defaults and
   *              is not a claim about the member. Over in a moment.
   *   'ready'    the store answered. `prefs` is theirs — including when the
   *              store held nothing, because nothing stored is a fact about a
   *              member who has never set these.
   *   'error'    the read THREW. `prefs` is the defaults wearing the member's
   *              own settings' clothes, and it is not over in a moment.
   */
  read: 'loading' | 'ready' | 'error';
  /**
   * True only for `read === 'ready'`, and it is defined as exactly that.
   *
   * It used to be set on the error path too — `catch { raw = null }`, then
   * `setLoaded(true)` over `prefsFromStored(null)` — so a read that failed was
   * indistinguishable from a member who has never touched this screen, and
   * every consumer of this flag was told the defaults were their answers.
   */
  loaded: boolean;
  /** Whether a change may be written at all. False while reading and after a
   *  failed read; the setters refuse on their own besides. */
  canWrite: boolean;
  /** Each returns what the write DID. They are async because AsyncStorage is,
   *  and because "did it store?" has no answer before it resolves. */
  setCategory: (key: NotifyCategory, on: boolean) => Promise<PrefWrite>;
  setQuiet: (on: boolean) => Promise<PrefWrite>;
  setQuietHours: (fromHour: number, toHour: number) => Promise<PrefWrite>;
}

const Ctx = createContext<Value | null>(null);

export function NotifyPrefsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_NOTIFY_PREFS);
  const [read, setRead] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setRead('loading');
    (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(KEY);
      } catch {
        // A read that THREW is not a member with nothing stored.
        //
        // It used to become one, here: `raw = null` and then the same
        // `setLoaded(true)` the success path takes, so the defaults were handed
        // to every consumer wearing the member's own answers. Two costs, and
        // the second is the one that lasts:
        //
        //   · It MISREPORTS. Every switch on the settings screen drew the
        //     default — all of them on — and said nothing, so a member who had
        //     turned class reminders off was shown them on.
        //   · It OVERWRITES. Those switches write straight through on tap, and
        //     `write` below replaces the WHOLE blob. So one tap on one category
        //     stored the defaults over every other answer the member had ever
        //     given, including their quiet hours — a settings screen silently
        //     resetting settings it never managed to read.
        //
        // The latch is deliberately left alone: it still holds the defaults,
        // which is what src/lib/notifyPrefsLatch.ts argues for at length —
        // default-on loses one notification the member had off, default-off
        // loses a session reminder for ever. What changes is that nobody is
        // told those defaults are an answer, and nothing is written over the
        // answers we could not read.
        if (!cancelled) setRead('error');
        return;
      }
      if (cancelled) return;
      const next = prefsFromStored(raw);
      // The latch first, then React state. Anything scheduling a notification
      // in this same tick reads the latch, and a gate that lagged a render
      // behind would let through exactly the notification the member had
      // turned off.
      setNotifyPrefsLatch(next);
      setPrefs(next);
      setRead('ready');
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

  // `prefs` as it stands, readable from inside an async setter without putting
  // `prefs` in its dependency list — which would hand the screen a new function
  // identity on every keystroke. The setters below are `useCallback([])` for
  // the reason src/ui/roster.tsx sets out at length.
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const readRef = useRef(read);
  useEffect(() => { readRef.current = read; }, [read]);

  /**
   * Apply one change, and say what actually happened to it.
   *
   * ── Refused, before anything else ─────────────────────────────────────────
   *
   * A write on top of a read that never landed does not just save the wrong
   * thing, it DESTROYS the right thing: `next` is built from `prefs`, `prefs`
   * is the defaults when the read failed, and the store takes the whole blob.
   * So a member whose read threw and who then touched one switch had every
   * other category and both quiet hours replaced by defaults they never chose,
   * and nothing on any screen would ever say so. That is refused here rather
   * than only on the screen: a disabled control is a courtesy, and this is the
   * guarantee.
   *
   * ── And the write's answer is not thrown away ─────────────────────────────
   *
   * `AsyncStorage.setItem(...).catch(() => {})` swallowed the one fact a
   * settings screen has to have, while the screen said "Saved on this phone."
   * The latch and the state are still applied on a failed store — the old
   * comment's argument for that stands, and undoing a switch in front of
   * somebody because the disk refused is worse — but 'not-stored' is returned
   * so the sentence over it can be true.
   */
  const write = useCallback(async (build: (cur: NotifyPrefs) => NotifyPrefs): Promise<PrefWrite> => {
    if (readRef.current !== 'ready') return 'refused';
    const next = build(prefsRef.current);
    // Latch, state, then storage — in that order and deliberately. A member who
    // turns off daily reminders and immediately taps Save on the reminders
    // screen must not race their own AsyncStorage write and schedule the thing
    // they just turned off.
    setNotifyPrefsLatch(next);
    prefsRef.current = next;
    setPrefs(next);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
      return 'stored';
    } catch {
      // The choice is live for this session and will be forgotten at the next
      // launch. Not rolled back: undoing a switch the member just flipped, in
      // front of them, because a write failed is a worse answer than honouring
      // it for now. But it is REPORTED, which is the half that was missing.
      return 'not-stored';
    }
  }, []);

  const setCategory = useCallback((key: NotifyCategory, on: boolean) => write((cur) => {
    const off = { ...cur.off };
    // Turning one back ON deletes the key rather than storing `false`. The
    // absence of a key is the "not answered" state and it is what `allows`
    // reads as on, so the two must not become three.
    if (on) delete off[key]; else off[key] = true;
    return { ...cur, off };
  }), [write]);

  const setQuiet = useCallback((on: boolean) => write((cur) => ({ ...cur, quiet: on })), [write]);

  const setQuietHours = useCallback((fromHour: number, toHour: number) => {
    const clamp = (n: number) => Math.min(23, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
    return write((cur) => ({ ...cur, quietFromHour: clamp(fromHour), quietToHour: clamp(toHour) }));
  }, [write]);

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const loaded = read === 'ready';
  const value = useMemo<Value>(
    () => ({ prefs, read, loaded, canWrite: loaded, setCategory, setQuiet, setQuietHours }),
    [prefs, read, loaded, setCategory, setQuiet, setQuietHours],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifyPrefs(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifyPrefs must be used inside <NotifyPrefsProvider>');
  return v;
}
