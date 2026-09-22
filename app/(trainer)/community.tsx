// Coach · Community. The gym's Members board and the staff-only Coaches board,
// and the reports queue a coach moderates with the owner. Feed and queue are
// src/ui/CommunityFeed.tsx; who may read and hide what is part 3300.
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { PageHead, Segmented } from '../../src/ui/kit';
import { layout, sp } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { CommunityFeed, CommunityReports } from '../../src/ui/CommunityFeed';
import type { Channel } from '../../src/lib/community';

export default function CoachCommunity() {
  const t = useTheme();
  const [channel, setChannel] = useState<Channel>('members');
  const [key, setKey] = useState(0);
  const pull = usePullToRefresh(useCallback(() => setKey((k) => k + 1), []));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} refreshControl={pull} keyboardShouldPersistTaps="handled">
        <PageHead title="Coach Community" subtitle="Your gym's boards, and what members have reported" />
        <Segmented style={{ marginTop: sp.lg }} value={channel} onChange={setChannel}
          options={[{ key: 'members', label: 'Members' }, { key: 'coaches', label: 'Coaches' }] as const} />
        <CommunityFeed key={`${channel}-${key}`} channel={channel} canPost moderator />
        <CommunityReports key={`r-${key}`} />
      </ScrollView>
    </SafeAreaView>
  );
}
