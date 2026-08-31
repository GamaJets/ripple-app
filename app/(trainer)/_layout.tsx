// Trainer portal tabs — Clients · Schedule · Videos · Analytics · Profile
//
// Configuration, not layout: every Tabs.Screen, name, href, title and the order
// they appear in is untouched. Only the tab label and the bar's padding moved
// onto the scale (`src/theme/scale`); the dead emoji TabIcon is gone.
//
// The bar is SIX items and stays six. Everything else in this group is a detail
// screen registered with `href: null` — reachable by navigation, absent from the
// bar. A seventh bar item does not simply appear at the end: it squeezes the six
// that matter, which is how "Programs" came to render as "Progra…" the one time
// a route was added without it. `my-training`, `my-nutrition` and `my-progress`
// — the coach's own workout log, food log and body record — are three of those
// detail screens, reached from the Coaching Tools row on the Clients tab. They
// are deliberately not bar items: the bar is about clients, and the coach's own
// tracking is the one thing in this group that is not.
//
// A `<Tabs.Screen>` list is walked by expo-router rather than rendered, so keep
// commentary out from between the entries — notes about a route belong here, or
// in the route's own file header.
import { Tabs, Redirect } from 'expo-router';
import { groupAllowed } from '../../src/lib/variant';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { sp, type as ty } from '../../src/theme/scale';

export default function TrainerLayout() {
  // This build is one of three separate apps. If the trainer portal is not
  // the one it ships, nothing here is reachable — a deep link or a tapped
  // notification pointing into it goes home instead of rendering a portal
  // this user's app is not supposed to have.
  if (!groupAllowed('trainer')) return <Redirect href="/" />;

  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 56 + bottomPad, paddingTop: sp.sm, paddingBottom: bottomPad },
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink3,
        tabBarLabelStyle: { ...ty.micro, textTransform: 'none', letterSpacing: 0.2, fontWeight: '500' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Clients', tabBarIcon: ({ color }) => <Icon name="people" size={23} color={color} /> }} />
      <Tabs.Screen name="builder" options={{ title: 'Programs', tabBarIcon: ({ color }) => <Icon name="train" size={23} color={color} /> }} />
      <Tabs.Screen name="calendar" options={{ title: 'Schedule', tabBarIcon: ({ color }) => <Icon name="calendar" size={23} color={color} /> }} />
      <Tabs.Screen name="videos" options={{ title: 'Videos', tabBarIcon: ({ color }) => <Icon name="video" size={23} color={color} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color }) => <Icon name="chart" size={23} color={color} /> }} />
            <Tabs.Screen name="sessions" options={{ href: null, title: 'Mark Sessions' }} />
<Tabs.Screen name="leaderboard" options={{ href: null, title: 'Leaderboard' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="chat" options={{ href: null, title: 'Chat' }} />
      <Tabs.Screen name="log-session" options={{ href: null, title: 'Log a Session' }} />
      <Tabs.Screen name="my-training" options={{ href: null, title: 'My Training' }} />
      <Tabs.Screen name="my-nutrition" options={{ href: null, title: 'My Nutrition' }} />
      <Tabs.Screen name="my-progress" options={{ href: null, title: 'My Progress' }} />
      <Tabs.Screen name="checklists" options={{ href: null, title: 'Their Checklists' }} />
      <Tabs.Screen name="client-goals" options={{ href: null, title: 'Working Toward' }} />
      <Tabs.Screen name="client-photos" options={{ href: null, title: 'Progress Photos' }} />
      <Tabs.Screen name="client-week" options={{ href: null, title: 'Their Week' }} />
      <Tabs.Screen name="client" options={{ href: null, title: 'Client' }} />
      <Tabs.Screen name="client-body" options={{ href: null, title: 'Body Composition' }} />
      <Tabs.Screen name="templates" options={{ href: null, title: 'Program Templates' }} />
      <Tabs.Screen name="exercise" options={{ href: null, title: 'Exercise' }} />
      <Tabs.Screen name="library" options={{ href: null, title: 'Exercise Library' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
      <Tabs.Screen name="billing" options={{ href: null, title: 'Billing & Subscription' }} />
      <Tabs.Screen name="payments" options={{ href: null, title: 'Payments' }} />
      <Tabs.Screen name="ad-spend" options={{ href: null, title: 'Ad Spend' }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
      <Tabs.Screen name="class-checkin" options={{ href: null, title: 'Class Check-in' }} />
      <Tabs.Screen name="broadcast" options={{ href: null, title: 'Broadcast' }} />
      <Tabs.Screen name="broadcast-session" options={{ href: null, title: 'Broadcast a Session' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Icon name="me" size={23} color={color} /> }} />
    </Tabs>
  );
}
