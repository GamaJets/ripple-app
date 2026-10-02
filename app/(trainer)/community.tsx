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
  /* Computed per render rather than seeded into useState: on the first render
     the tenant provider is still 'loading' and `tenant` is null, so a seeded
     default is always the no-gym one. See the same note on the member's copy
     of this screen. */
  const hasGym = !!tenant?.id;
  const [picked, setPicked] = useState<Board | null>(null);
  const board: Board = picked ?? (hasGym ? 'gym' : 'mine');
  const setBoard = setPicked;
  const onMine = board === 'mine';
  /* What the tabs actually show. `tab` is the coach's last choice and may name
     a tab this board does not have. */
  const shownTab = onMine && tab === 'resource' ? 'post' : tab;
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
        {/* No Resources tab on a coach's own board, and the tab is clamped
            rather than merely hidden so switching boards while it is open does
            not leave it selected.

            It had nowhere to go. A resource there is forced onto the members
            channel (there is only one), the member's own screen asks for
            `kind: 'post'` and nothing else, and the coach is the only person
            the board has who could read a coaches channel. So a resource
            posted there was written, stored, and seen by one person — the one
            who wrote it — under a note on this screen saying resources are for
            the gym's coaches, which on this board is not true either.

            The argument is the one the comment below already makes about the
            channel switch: a staff-only room for an audience of one is a notes
            app. A coach who wants their cohort to have a document sends it on
            the thread, where it is a file somebody is told about. */}
        {onMine ? null : (
          <Segmented style={{ marginTop: sp.lg }} value={shownTab} onChange={setTab}
            options={[{ key: 'post', label: 'Discussion' }, { key: 'resource', label: 'Resources' }, { key: 'event', label: 'Events' }] as const} />
        )}
        {onMine ? (
          <Segmented style={{ marginTop: sp.lg }} value={shownTab} onChange={setTab}
            options={[{ key: 'post', label: 'Discussion' }, { key: 'event', label: 'Events' }] as const} />
        ) : null}
        {/* A coach's own board has one channel: there is one coach on it, and
            a staff-only room for an audience of one is a notes app (part
            3370 says the same thing as a check constraint). */}
        {shownTab !== 'resource' && !onMine ? (
          <Segmented style={{ marginTop: sp.sm }} value={channel} onChange={setChannel}
            options={[{ key: 'members', label: 'Members' }, { key: 'coaches', label: 'Coaches' }] as const} />
        ) : null}
        {/* Resources are for the gym's coaches only (part 3330). */}
        <CommunityFeed key={`${board}-${shownTab}-${channel}-${key}`} kind={shownTab}
          channel={onMine ? 'members' : shownTab === 'resource' ? 'coaches' : channel}
          coachId={onMine ? myId : null} canPost moderator />
        <CommunityReports key={`r-${key}`} />
      </ScrollView>
    </SafeAreaView>
  );
}
