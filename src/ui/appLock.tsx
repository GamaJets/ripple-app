// The Face ID lock, wired to the device and the app's lifecycle.
//
// The decision itself lives in `src/lib/appLock.ts` with no imports, so it can
// be asserted on without a device. This file is the parts that need one:
// asking iOS what hardware exists, prompting, and noticing when the app goes
// away and comes back.
//
// Shared by all three apps. It sits inside the auth provider in the root
// layout, so it can ask whether anybody is signed in — a lock over a sign-in
// screen protects nothing and would only teach people to dismiss it.
import { createContext, useCallback, useContext, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import { BRAND } from '../lib/brands';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lockDecision, defaultLockLabel, type LockPlatform, type LockState } from '../lib/appLock';
import { reportError } from '../lib/reportError';

const ENABLED_KEY = 'repple.appLock.enabled';

/**
 * Whose vocabulary the lock is explained in.
 *
 * Read once at module load — it cannot change while the app is running — and
 * passed into `src/lib/appLock.ts`, which holds every sentence and has no
 * imports on purpose. Every one of those sentences used to name Face ID, Touch
 * ID and iOS Settings on all three platforms, so an Android member was sent
 * looking for an Apple feature inside an Apple settings app.
 */
export const LOCK_PLATFORM: LockPlatform =
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';

/**
 * Loaded lazily and never at module scope.
 *
 * expo-local-authentication is native. A build made before it was added does
 * not contain it, and a static import would take the whole app down on launch
 * rather than simply not offering the lock. Same hazard as expo-video, and the
 * same treatment: ask for it, cope with not having it.
 */
function biometrics(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-local-authentication');
  } catch {
    return null;
  }
}

export interface AppLockValue {
  /** Whether the user has turned the lock on. */
  enabled: boolean;
  /** Whether this device can actually do it. */
  available: boolean;
  /** "Face ID", "Touch ID", or "your passcode". What to call it on screen. */
  label: string;
  state: LockState;
  /** Resolves false when the attempt failed or was cancelled. */
  unlock: () => Promise<boolean>;
  /** Resolves false when it could not be saved — the caller must not claim it was. */
  setEnabled: (on: boolean) => Promise<boolean>;
}

const Ctx = createContext<AppLockValue | null>(null);

export function AppLockProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [available, setAvailable] = useState(false);
  const [label, setLabel] = useState(defaultLockLabel(LOCK_PLATFORM));
  const [state, setState] = useState<LockState>('open');
  const backgroundedAt = useRef<number | null>(null);
  const hydrated = useRef(false);

  // What the hardware can do, and what to call it.
  useEffect(() => {
    let off = false;
    (async () => {
      const LA = biometrics();
      let can = false;
      let name = defaultLockLabel(LOCK_PLATFORM);
      try {
        if (LA) {
          const hardware = await LA.hasHardwareAsync();
          const enrolled = await LA.isEnrolledAsync();
          can = !!hardware && !!enrolled;
          const types = await LA.supportedAuthenticationTypesAsync();
          // 2 is FACIAL_RECOGNITION, 1 is FINGERPRINT, in every SDK this has
          // shipped in. Named rather than numbered where the enum is present.
          const FACE = LA.AuthenticationType?.FACIAL_RECOGNITION ?? 2;
          const TOUCH = LA.AuthenticationType?.FINGERPRINT ?? 1;
          // "Face ID" and "Touch ID" are Apple's names for these. On Android
          // the same two capabilities are face unlock and a fingerprint, and
          // calling them Face ID sends a member looking for a setting that is
          // not on their handset.
          if (types?.includes(FACE)) name = LOCK_PLATFORM === 'ios' ? 'Face ID' : 'face unlock';
          else if (types?.includes(TOUCH)) name = LOCK_PLATFORM === 'ios' ? 'Touch ID' : 'your fingerprint';
        }
      } catch (e) {
        reportError('appLock.capabilities', e);
      }
      let on = false;
      try {
        on = (await AsyncStorage.getItem(ENABLED_KEY)) === '1';
      } catch { /* a preference that cannot be read is off */ }
      if (off) return;
      setAvailable(can);
      setLabel(name);
      setEnabledState(on);
      hydrated.current = true;
      // First decision, once we know all three facts.
      setState(lockDecision({ enabled: on, available: can, signedIn, backgroundedAt: null, now: Date.now(), platform: LOCK_PLATFORM }).state);
    })();
    return () => { off = true; };
    // Deliberately once: re-running on every signedIn flip would re-lock the
    // app the instant somebody signs in, before they have seen anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signing out drops the lock; signing in re-arms it for the next time away.
  //
  // And it drops the PREFERENCE with it, not just the current state. Signing
  // out clears `repple.appLock.enabled` from the device (src/lib/signOutState.ts)
  // because it is one person's answer stored under a key with no account in it;
  // leaving `enabled` true in memory afterwards would leave the next person to
  // sign in on this handset — within the same session, before any relaunch —
  // holding a lock armed by somebody who has gone. The read above is
  // deliberately once-per-launch, so this is the only place that correction can
  // be made.
  useEffect(() => {
    if (!hydrated.current) return;
    if (!signedIn) { setState('open'); setEnabledState(false); }
  }, [signedIn]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next !== 'active' || !hydrated.current) return;
      const d = lockDecision({
        enabled, available, signedIn,
        backgroundedAt: backgroundedAt.current,
        now: Date.now(),
        platform: LOCK_PLATFORM,
      });
      // Only ever tightens on resume. An 'unlocked' answer must not reopen an
      // app that is currently locked and waiting for a face.
      if (d.state === 'locked') setState('locked');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [enabled, available, signedIn]);

  const unlock = useCallback(async (): Promise<boolean> => {
    const LA = biometrics();
    if (!LA) { setState('open'); return true; }
    try {
      const r = await LA.authenticateAsync({
        promptMessage: `Unlock ${BRAND.label}`,
        // The passcode is the fallback on purpose: a face that will not read
        // in a dark gym must not lock somebody out of their own training.
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });
      if (r?.success) { setState('unlocked'); return true; }
      return false;
    } catch (e) {
      reportError('appLock.unlock', e);
      return false;
    }
  }, []);

  const setEnabled = useCallback(async (on: boolean): Promise<boolean> => {
    // Turning it ON asks for a face first. Enabling a lock you cannot open is
    // how somebody ends up shut out of their own record.
    if (on) {
      const ok = await unlock();
      if (!ok) return false;
    }
    setEnabledState(on);
    try {
      await AsyncStorage.setItem(ENABLED_KEY, on ? '1' : '0');
      return true;
    } catch (e) {
      reportError('appLock.setEnabled', e);
      return false;
    }
  }, [unlock]);

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const value = useMemo<AppLockValue>(() => ({ enabled, available, label, state, unlock, setEnabled }), [enabled, available, label, state, unlock, setEnabled]);
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return v;
}
