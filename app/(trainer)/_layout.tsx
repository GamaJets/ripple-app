// Trainer portal tabs — Clients · Schedule · Videos · Analytics · Profile
//
// Configuration, not layout: every Tabs.Screen, name, href, title and the order
// they appear in is untouched. Only the tab label and the bar's padding moved
// onto the scale (`src/theme/scale`); the dead emoji TabIcon is gone.
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
            <Tabs.Screen name="sessions" options={{ href: null, title: 'Mark sessions' }} />
<Tabs.Screen name="leaderboard" options={{ href: null, title: 'Leaderboard' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="chat" options={{ href: null, title: 'Chat' }} />
      <Tabs.Screen name="templates" options={{ href: null, title: 'Program Templates' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
      <Tabs.Screen name="billing" options={{ href: null, title: 'Billing & subscription' }} />
      <Tabs.Screen name="payments" options={{ href: null, title: 'Payments' }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
      <Tabs.Screen name="class-checkin" options={{ href: null, title: 'Class check-in' }} />
      <Tabs.Screen name="broadcast" options={{ href: null, title: 'Broadcast' }} />
      <Tabs.Screen name="broadcast-session" options={{ href: null, title: 'Broadcast a session' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Icon name="me" size={23} color={color} /> }} />
    </Tabs>
  );
}
