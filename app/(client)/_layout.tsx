// Client tab navigator — Home · Train · Meals · Progress · Me
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

export default function ClientLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.ring, height: 56 + bottomPad, paddingTop: 8, paddingBottom: bottomPad },
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink3,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ headerShown: false, title: 'Home', tabBarIcon: ({ color }) => <Icon name="home" size={23} color={color} /> }} />
      <Tabs.Screen name="workouts" options={{ headerShown: false, title: 'Train', tabBarIcon: ({ color }) => <Icon name="train" size={23} color={color} /> }} />
      <Tabs.Screen name="nutrition" options={{ headerShown: false, title: 'Meals', tabBarIcon: ({ color }) => <Icon name="meals" size={23} color={color} /> }} />
      <Tabs.Screen name="scans" options={{ headerShown: false, title: 'Progress', tabBarIcon: ({ color }) => <Icon name="progress" size={23} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ headerShown: false, title: 'Me', tabBarIcon: ({ color }) => <Icon name="me" size={23} color={color} /> }} />
      <Tabs.Screen name="messages" options={{ href: null, title: "Messages" }} />
      <Tabs.Screen name="devices" options={{ href: null, title: "Watch & Devices" }} />
      <Tabs.Screen name="foodlog" options={{ href: null, title: "Food Log" }} />
      <Tabs.Screen name="library" options={{ href: null, title: "Exercise Library" }} />
      <Tabs.Screen name="social" options={{ href: null, title: "Share & Social" }} />
      <Tabs.Screen name="appearance" options={{ href: null, title: "Appearance" }} />
      <Tabs.Screen name="coach" options={{ href: null, title: "AI Coach" }} />
      <Tabs.Screen name="music" options={{ href: null, title: "Music & Playlists" }} />
      <Tabs.Screen name="calendar" options={{ href: null, title: 'Book Sessions' }} />
      <Tabs.Screen name="habits" options={{ href: null, title: 'Daily Habits' }} />
      <Tabs.Screen name="achievements" options={{ href: null, title: 'Achievements' }} />
      <Tabs.Screen name="checkin" options={{ href: null, title: 'Weekly Check-in' }} />
      <Tabs.Screen name="activity" options={{ href: null, title: 'Activity' }} />
      <Tabs.Screen name="measurements" options={{ href: null, title: 'Body Measurements' }} />
      <Tabs.Screen name="injuries" options={{ href: null, title: 'Injuries & limitations' }} />
      <Tabs.Screen name="reminders" options={{ href: null, title: 'Reminders' }} />
      <Tabs.Screen name="packages" options={{ href: null, title: 'Memberships & packs' }} />
      <Tabs.Screen name="report" options={{ href: null, title: 'Weekly Report' }} />
      <Tabs.Screen name="records" options={{ href: null, title: 'Personal Records' }} />
      <Tabs.Screen name="goal" options={{ href: null, title: 'Goal Tracker' }} />
      <Tabs.Screen name="tools" options={{ href: null, title: 'Lifting Tools' }} />
      <Tabs.Screen name="recovery" options={{ href: null, title: 'Recovery' }} />
      <Tabs.Screen name="week" options={{ href: null, title: 'This Week' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      <Tabs.Screen name="cards" options={{ href: null, title: 'Milestone Cards' }} />
      <Tabs.Screen name="consistency" options={{ href: null, title: 'Consistency' }} />
      <Tabs.Screen name="standards" options={{ href: null, title: 'Strength Standards' }} />
      <Tabs.Screen name="trainers" options={{ href: null, title: 'Find a Trainer' }} />
      <Tabs.Screen name="explore" options={{ href: null, title: 'Explore' }} />
      <Tabs.Screen name="challenges" options={{ href: null, title: 'Challenges' }} />
      <Tabs.Screen name="onboarding" options={{ href: null, title: 'Get started' }} />
      <Tabs.Screen name="progression" options={{ href: null, title: 'Progression' }} />
      <Tabs.Screen name="scan-machine" options={{ href: null, title: 'Scan machine' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Send Feedback' }} />
      <Tabs.Screen name="referral" options={{ href: null, title: 'Invite Friends' }} />
      <Tabs.Screen name="restaurant" options={{ href: null, title: 'Eating out' }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
    </Tabs>
  );
}
