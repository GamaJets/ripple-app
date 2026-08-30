// What you see when the app is locked.
//
// Deliberately bare. There is nothing to read here and nothing to decide — the
// only thing on it is the way back in, plus the way out for somebody who has
// picked up the wrong phone.
//
// It renders INSTEAD of the app, not over it, so nothing behind can be read
// from a screenshot, a task switcher card, or a screen recording.
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './components';
import { useAppLock } from './appLock';
import { useAuth } from './auth';
import { Icon } from './Icon';
import { sp, layout, radius, type as ty } from '../theme/scale';

export function LockScreen() {
  const t = useTheme();
  const { unlock, label } = useAppLock();
  const auth = useAuth();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const attempt = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await unlock();
    setBusy(false);
    if (!ok) setTried(true);
  };

  // Ask once, the moment the screen appears, so the common case is a glance
  // rather than a tap and then a glance.
  useEffect(() => { void attempt(); /* eslint-disable-next-line */ }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: layout.gutter, gap: sp.lg }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={28} color={t.brand} />
        </View>

        <Text style={{ ...ty.title, color: t.ink, textAlign: 'center' }}>Repple Is Locked</Text>
        <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', maxWidth: 300 }}>
          {tried
            ? `${label} did not unlock it. Try again, or sign out if this is not your phone.`
            : `Unlock with ${label} to see your training.`}
        </Text>

        <Pressable onPress={attempt} disabled={busy} accessibilityRole="button"
          accessibilityLabel={`Unlock with ${label}`}
          style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.xl, paddingVertical: 14, minWidth: 200, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
          <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>
            {busy ? 'Waiting…' : `Unlock with ${label}`}
          </Text>
        </Pressable>

        {/* The way out for whoever is holding a phone that is not theirs. It
            ends the session, so the next person starts at sign-in. */}
        <Pressable onPress={() => { try { auth.signOut(); } catch { /* the lock lifts either way */ } }}
          hitSlop={8} accessibilityRole="button" accessibilityLabel="Sign out"
          style={{ paddingVertical: sp.md }}>
          <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** Shows the app, or the lock over it. */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { state } = useAppLock();
  return state === 'locked' ? <LockScreen /> : <>{children}</>;
}
