// Client · Community. The gym's members board: private to this gym, moderated
// by its owner and coaches. The feed, the rules gate, reporting, blocking and
// hiding are all src/ui/CommunityFeed.tsx; the access rules are part 3300.
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { PageHead } from '../../src/ui/kit';
import { layout } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { CommunityFeed } from '../../src/ui/CommunityFeed';

export default function Community() {
  const t = useTheme();
  // Remounting the feed is the refresh: every read inside it runs again.
  const [key, setKey] = useState(0);
  const pull = usePullToRefresh(useCallback(() => setKey((k) => k + 1), []));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} refreshControl={pull} keyboardShouldPersistTaps="handled">
        <PageHead title="Community" subtitle="Your Gym, and Only Your Gym" />
        <CommunityFeed key={key} channel="members" canPost moderator={false} />
      </ScrollView>
    </SafeAreaView>
  );
}
