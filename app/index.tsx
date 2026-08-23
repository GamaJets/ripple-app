// Post-login router / role chooser. Redirects to the welcome screen when
// signed out; otherwise lets you enter a portal.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same redirect, same three routes, same sign-out — only
// the presentation changed: no hero (a chooser has no live number to lead
// with), the brand mark and the white-label app name lead instead, and the
// three bordered portal cards became hairline-separated `<ListRow>`s.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { useBrand } from '../src/ui/brand';
import { Rule, Section, SectionHead, ListRow, Ghost } from '../src/ui/kit';
import { sp, layout, radius, type as ty } from '../src/theme/scale';
import { VARIANT, HOME_ROUTE, SHOWS_PORTAL_CHOOSER } from '../src/lib/variant';
import { hasSeenTour } from './tour';

function Ripple({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, opacity: 0.35 }} />
      <View style={{ position: 'absolute', width: size * 0.6, height: size * 0.6, borderRadius: size, borderWidth: 2.5, borderColor: color, opacity: 0.65 }} />
      <View style={{ width: size * 0.24, height: size * 0.24, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { authed, user, loading, signOut } = useAuth();
  const { appName } = useBrand();

  // First launch of this app shows the tour once. `null` means we have not
  // finished asking AsyncStorage yet — treat it as "keep the splash up" rather
  // than flashing the dashboard and yanking it away a frame later.
  const [seenTour, setSeenTour] = useState<boolean | null>(null);
  useEffect(() => { let live = true; hasSeenTour(VARIANT).then((v) => { if (live) setSeenTour(v); }); return () => { live = false; }; }, []);

  // Live mode: brief splash while the persisted session is rehydrated so we
  // don't flash the welcome screen for an already signed-in user.
  if (loading || (authed && seenTour === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ripple size={52} color={t.brand} />
      </View>
    );
  }
  if (!authed) return <Redirect href="/welcome" />;

  // Never seen the tour in this app: show it before anything else.
  if (seenTour === false) return <Redirect href="/tour" />;

  // Repple ships as three separate apps. A store build has exactly one portal,
  // so there is nothing to choose: go straight in. The chooser below only ever
  // renders in a development build, where VARIANT is `all`.
  if (!SHOWS_PORTAL_CHOOSER) {
    return <Redirect href={HOME_ROUTE[VARIANT as Exclude<typeof VARIANT, 'all'>] as any} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.huge, paddingBottom: 40 }}>

        {/* ── the brand mark, then who you're signed in as ────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Ripple size={28} color={t.brandInk} />
          </View>
          <Text style={{ ...ty.title, color: t.ink }}>{appName}</Text>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }} numberOfLines={1}>
          Signed in as {user?.email}
        </Text>

        <Rule />

        {/* ── the three portals ──────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Choose a portal" note="development build" />
          <ListRow icon="me" title="Client App" note="Program, meals, progress, booking"
            onPress={() => router.push('/(client)/dashboard')} />
          <ListRow icon="people" title="Trainer Portal" note="Clients, schedule, videos, analytics"
            onPress={() => router.push('/(trainer)/dashboard')} />
          <ListRow icon="grid" title="Platform Owner" note="Trainers, billing, white-label, growth"
            onPress={() => router.push('/(owner)/dashboard')} />
        </Section>

        <Rule />

        <Section style={{ alignItems: 'center' }}>
          <Ghost label="Sign out" onPress={signOut} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
