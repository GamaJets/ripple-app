// App-wide crash guard. Catches render errors and shows a friendly, themed
// fallback with a Reload action instead of a white screen. componentDidCatch is
// the hook where a crash reporter (Sentry) is wired in Phase 8 / release.
import { Component, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { Icon } from './Icon';
// Scale only — this renders *after* a crash, so it imports no theme provider,
// no kit, nothing that could itself throw. `scale` is plain constants.
import { sp, radius, type as ty } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
// Plain module, no hook and no context: this component renders after a crash
// and a class cannot call a hook anyway. See src/ui/crashQueue.ts.
import { queueCrash } from './crashQueue';

let APP_VERSION = 'unknown';
try { APP_VERSION = require('expo-constants').default?.expoConfig?.version ?? 'unknown'; } catch { /* not available */ }

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: unknown) {
    // Lightweight crash log → Supabase `app_errors` (owner reviews). No Sentry
    // native SDK needed, so this ships over-the-air. Best-effort; never throws.
    if (!USE_SUPABASE) return;
    const message = String(error?.message || '').slice(0, 500);
    const stack = String(error?.stack || '').slice(0, 4000);
    // The moment it happened, taken here. A crash queued in a basement and sent
    // three days later must not arrive dated three days late — see
    // src/lib/crashQueue.ts, which puts this inside the message because the
    // table's own timestamp is written when the row lands.
    const at = new Date().toISOString();
    // The swallow stays: nothing here may throw a second time, and none of it
    // is shown to the member. What changed is what happens when the insert does
    // not land. It was dropped where it stood, so a crash on a dead network was
    // never reported — and those are the crashes worth most. Queued now, and
    // sent on the same reconnect as everything else.
    const keep = (uid: string | null) => { void queueCrash({ message, stack, userId: uid, at }); };
    try {
      supabase.auth.getUser().then(({ data }) => {
        const uid = data?.user?.id ?? null;
        supabase.from('app_errors').insert({
          user_id: uid, message, stack, platform: Platform.OS, app_version: APP_VERSION,
        }).then(({ error: e }: { error: unknown }) => { if (e) keep(uid); }, () => keep(uid));
      }, () => keep(null));
    } catch { keep(null); }
  }

  /**
   * Reload, and mean it.
   *
   * This was `setState({ error: null })`, which re-renders the same subtree
   * from the same state — so when the thing that threw was a provider reading a
   * malformed blob off disk at mount, Reload threw again immediately and the
   * button did nothing a person could see. That is now the case this boundary
   * is mounted at the top of the tree to catch, so the button has to be able to
   * answer it.
   *
   * `Updates.reloadAsync()` restarts the JS bundle, which re-runs every
   * provider from scratch. It is not a fix for a crash that is deterministic in
   * stored data — nothing here can be — but it is a real retry rather than a
   * repaint, and it is what recovers the ordinary case: a transient read, a
   * race at mount, a value that arrived once and will not again.
   *
   * The clear-and-re-render stays as the fallback, because `reloadAsync` throws
   * in a development build and in Expo Go, which is exactly where somebody is
   * most likely to be pressing this button.
   */
  reset = () => {
    (async () => {
      try {
        const Updates = require('expo-updates');
        if (Updates?.isEnabled) { await Updates.reloadAsync(); return; }
      } catch { /* falls through to the repaint below */ }
      this.setState({ error: null });
    })();
  };

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', padding: sp.xxl }}>
          <Icon name="wrench" size={40} color="#2dd4bf" />
          <Text accessibilityRole="header" style={{ ...ty.title, color: '#ffffff', textAlign: 'center', marginTop: sp.md, marginBottom: sp.sm }}>Something Went Wrong</Text>
          <Text style={{ ...ty.body, color: '#898781', textAlign: 'center', marginBottom: sp.xl }}>This screen hit an unexpected error. Your data is safe — tap below to reload.</Text>
          <Pressable onPress={this.reset} accessibilityRole="button" accessibilityLabel="Reload the app" style={{ backgroundColor: '#2dd4bf', borderRadius: radius.sm, paddingVertical: sp.lg, paddingHorizontal: 34 }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: '#062e2a' }}>Reload</Text>
          </Pressable>
          {this.state.error ? (
            <ScrollView style={{ maxHeight: 200, marginTop: sp.xl, alignSelf: 'stretch' }}>
              <Text selectable style={{ ...ty.caption, fontFamily: 'Courier', color: '#e66767' }}>{String(this.state.error.message || '')}

{String(this.state.error.stack || '')}</Text>
            </ScrollView>
          ) : null}
        </View>
      );
    }
    return this.props.children as any;
  }
}
