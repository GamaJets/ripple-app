// Owner · Community. The moderation queue first, then the members board, which
// the owner reads and can hide from but does not post to. Feed and queue are
// src/ui/CommunityFeed.tsx; who may read and hide what is part 3300.
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { PageHead, Section, SectionHead } from '../../src/ui/kit';
import { layout } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { CommunityFeed, CommunityReports } from '../../src/ui/CommunityFeed';

export default function OwnerCommunity() {
  const t = useTheme();
  const [key, setKey] = useState(0);
  const pull = usePullToRefresh(useCallback(() => setKey((k) => k + 1), []));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} refreshControl={pull}>
        <PageHead title="Community" subtitle="Reports, and your members' board" />
        <CommunityReports key={`r-${key}`} />
        <Section>
          <SectionHead title="Members Board" />
          <CommunityFeed key={key} channel="members" canPost={false} moderator />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
