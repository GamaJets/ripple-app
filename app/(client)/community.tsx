// Client · Community. Two boards, and the second is the point of this file
// changing: the gym's members board (private to that gym, moderated by its
// owner and coaches) and — part 3370 — the board belonging to their own coach,
// which exists whether or not there is a gym at all.
//
// A member coached online by somebody independent had no community anywhere
// in this app: `community_posts.tenant_id` was `not null`, so a board was a
// building and a person with no building had none. The feed, the rules gate,
// reporting, blocking and hiding are identical on both — src/ui/CommunityFeed.tsx
// — because a cohort needs moderating exactly as much as a gym does.
import { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { PageHead, Segmented } from '../../src/ui/kit';
import { layout, sp, type as ty } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { CommunityFeed, UpcomingEvents } from '../../src/ui/CommunityFeed';
import { useAuth } from '../../src/ui/auth';
import { useTenant } from '../../src/ui/tenant';
import { useLoggingCoach } from '../../src/ui/coachLogQueries';

type Board = 'gym' | 'coach';

export default function Community() {
  const t = useTheme();
  // Remounting the feed is the refresh: every read inside it runs again.
  const [key, setKey] = useState(0);
  const pull = usePullToRefresh(useCallback(() => setKey((k) => k + 1), []));
  const { user } = useAuth();
  const { tenant } = useTenant();
  const coach = useLoggingCoach(user?.id ?? null);

  const hasGym = !!tenant?.id;
  const hasCoach = !!coach?.id;
  /* Opens on the gym when there is one, because that is where this screen has
     always opened and a member who has used it should not find it moved. A
     member with only a coach opens on their coach; one with neither sees the
     gym's empty state, which already says what it means. */
  const [board, setBoard] = useState<Board>(hasGym ? 'gym' : 'coach');
  const onCoach = (!hasGym || board === 'coach') && hasCoach;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} refreshControl={pull} keyboardShouldPersistTaps="handled">
        <PageHead title="Community"
          subtitle={hasGym && hasCoach ? 'Your Gym, and Your Coach\u2019s Group' : hasCoach && !hasGym ? 'Your Coach\u2019s Group' : 'Your Gym, and Only Your Gym'} />
        {/* Only when there are two. One board and a control offering one
            choice is a control that teaches people tapping does nothing. */}
        {hasGym && hasCoach ? (
          <Segmented style={{ marginTop: sp.md }} value={board} onChange={setBoard}
            options={[{ key: 'gym', label: 'Your Gym' }, { key: 'coach', label: coach?.name ? `${coach.name.split(' ')[0]}\u2019s Group` : 'Your Coach' }] as const} />
        ) : null}
        {onCoach ? (
          <>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Everybody your coach works with can read this. Your gym cannot, and neither can anybody who is not one of their clients.
            </Text>
            <CommunityFeed key={`c-${key}`} channel="members" coachId={coach?.id ?? null} canPost moderator={false} />
          </>
        ) : (
          <>
            <UpcomingEvents key={`e-${key}`} />
            <CommunityFeed key={key} channel="members" canPost moderator={false} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
