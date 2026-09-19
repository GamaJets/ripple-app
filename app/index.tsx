// Post-login router. Redirects to the welcome screen when signed out, to the
// tour on first launch, and otherwise straight into this app's one portal.
//
// There used to be a three-way portal chooser here, from when client, trainer
// and owner were one app. They are three apps now, each built with its own
// variant, so a chooser would offer two portals this bundle cannot reach.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { useAuth } from '../src/ui/auth';
import { VARIANT, HOME_ROUTE } from '../src/lib/variant';
import { hasSeenTour } from './tour';
import { BrandMark } from '../src/ui/BrandMark';


export default function Home() {
  const t = useTheme();
  const { authed, loading } = useAuth();

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
        <BrandMark size={60} />
      </View>
    );
  }
  if (!authed) return <Redirect href="/welcome" />;

  // Never seen the tour in this app: show it before anything else.
  if (seenTour === false) return <Redirect href="/tour" />;

  // One app, one portal.
  return <Redirect href={HOME_ROUTE[VARIANT] as any} />;
}
