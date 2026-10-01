// Coach · Community. Discussion (the gym's Members board and the staff-only
// Coaches board), Resources (links coaches share with each other), Events (on
// either board; members see theirs under Upcoming), and the reports queue a
// coach moderates with the owner. Feed and queue are
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
import { useAuth } from '../../src/ui/auth';
import { useTenant } from '../../src/ui/tenant';

type Tab = 'post' | 'resource' | 'event';
/** Whose board. A gym's, or this coach's own clients — part 3370. */
type Board = 'gym' | 'mine';

export default function CoachCommunity() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('post');
  const [channel, setChannel] = useState<Channel>('members');
  const { user } = useAuth();
  const { tenant } = useTenant();
  const myId = user?.id ?? null;
  /* A coach with no gym has one board and is not asked to choose between it
     and nothing. A coach with both is: an independent coach running a
     twelve-week block and a coach employed by a gym are the same person here,
     and the cohort is theirs either way. */
  const hasGym = !!tenant?.id;
  const [board, setBoard] = useState<Board>(hasGym ? 'gym' : 'mine');
  const onMine = !hasGym || board === 'mine';
  const [key, setKey] = useState(0);
  const pull = usePullToRefresh(useCallback(() => setKey((k) => k + 1), []));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} refreshControl={pull} keyboardShouldPersistTaps="handled">
        <PageHead title="Coach Community" subtitle="Your Gym's Boards, and What Members Have Reported" />
        {hasGym ? (
          <Segmented style={{ marginTop: sp.lg }} value={board} onChange={setBoard}
            options={[{ key: 'gym', label: 'Your Gym' }, { key: 'mine', label: 'Your Clients' }] as const} />
        ) : null}
        <Segmented style={{ marginTop: sp.lg }} value={tab} onChange={setTab}
          options={[{ key: 'post', label: 'Discussion' }, { key: 'resource', label: 'Resources' }, { key: 'event', label: 'Events' }] as const} />
        {/* A coach's own board has one channel: there is one coach on it, and
            a staff-only room for an audience of one is a notes app (part
            3370 says the same thing as a check constraint). */}
        {tab !== 'resource' && !onMine ? (
          <Segmented style={{ marginTop: sp.sm }} value={channel} onChange={setChannel}
            options={[{ key: 'members', label: 'Members' }, { key: 'coaches', label: 'Coaches' }] as const} />
        ) : null}
        {/* Resources are for the gym's coaches only (part 3330). */}
        <CommunityFeed key={`${board}-${tab}-${channel}-${key}`} kind={tab}
          channel={onMine ? 'members' : tab === 'resource' ? 'coaches' : channel}
          coachId={onMine ? myId : null} canPost moderator />
        <CommunityReports key={`r-${key}`} />
      </ScrollView>
    </SafeAreaView>
  );
}
