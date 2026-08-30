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
    try {
      supabase.auth.getUser().then(({ data }) => {
        const uid = data?.user?.id ?? null;
        supabase.from('app_errors').insert({
          user_id: uid,
          message: String(error?.message || '').slice(0, 500),
          stack: String(error?.stack || '').slice(0, 4000),
          platform: Platform.OS,
          app_version: APP_VERSION,
        }).then(() => {}, () => {});
      }, () => {});
    } catch { /* swallow */ }
  }

  reset = () => this.setState({ error: null });

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
