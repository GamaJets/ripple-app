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
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lockDecision, type LockState } from '../lib/appLock';
import { reportError } from '../lib/reportError';

const ENABLED_KEY = 'repple.appLock.enabled';

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
  const [label, setLabel] = useState('your passcode');
  const [state, setState] = useState<LockState>('open');
  const backgroundedAt = useRef<number | null>(null);
  const hydrated = useRef(false);

  // What the hardware can do, and what to call it.
  useEffect(() => {
    let off = false;
    (async () => {
      const LA = biometrics();
      let can = false;
      let name = 'your passcode';
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
          if (types?.includes(FACE)) name = 'Face ID';
          else if (types?.includes(TOUCH)) name = 'Touch ID';
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
      setState(lockDecision({ enabled: on, available: can, signedIn, backgroundedAt: null, now: Date.now() }).state);
    })();
    return () => { off = true; };
    // Deliberately once: re-running on every signedIn flip would re-lock the
    // app the instant somebody signs in, before they have seen anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signing out drops the lock; signing in re-arms it for the next time away.
  useEffect(() => {
    if (!hydrated.current) return;
    if (!signedIn) setState('open');
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
        promptMessage: 'Unlock Repple',
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

  return (
    <Ctx.Provider value={{ enabled, available, label, state, unlock, setEnabled }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return v;
}
