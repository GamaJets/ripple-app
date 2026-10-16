// The coach's Today inbox: clients with no logged workout in 3+ days.
//
// Read from coach_quiet_clients() (part 3530), the same flags the daily push
// is written from, so the screen and the banner agree on who is quiet. A flag
// drops off by itself the moment the client logs anything. Renders nothing
// while loading or when nobody is quiet; a failed read says so.
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from './components';
import { Section, SectionHead, ListRow } from './kit';
import { type as ty } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fmtRelativeDay } from '../lib/format';

interface QuietClient { clientId: string; name: string | null; lastWorkoutAt: string }

async function fetchQuietClients(): Promise<QuietClient[] | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('coach_quiet_clients');
    if (error) { reportError('quietClients.read', error); return null; }
    return ((data ?? []) as { client_id: string; full_name: string | null; last_workout_at: string }[])
      .map((r) => ({ clientId: String(r.client_id), name: r.full_name, lastWorkoutAt: String(r.last_workout_at) }));
  } catch (e) { reportError('quietClients.read', e); return null; }
}

export function QuietClientsInbox({ coachId }: { coachId: string | null }) {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<QuietClient[] | null | undefined>(undefined);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!coachId) return () => { live = false; };
    void fetchQuietClients().then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [coachId]));

  if (rows === undefined) return null;
  if (rows !== null && rows.length === 0) return null;

  return (
    <Section>
      <SectionHead title="Gone Quiet" note={rows ? `${rows.length} · 3+ days without a workout` : undefined} />
      {rows === null ? (
        <Text style={{ ...ty.label, color: t.ink2 }}>
          Quiet clients could not be read just now. This is not a statement that everyone is training.
        </Text>
      ) : rows.map((q) => (
        <ListRow key={q.clientId} icon="heart"
          title={q.name ?? 'A client'}
          note="No workout logged in 3+ days"
          meta={`Last trained ${fmtRelativeDay(q.lastWorkoutAt)}`}
          onPress={() => router.push({ pathname: '/(trainer)/client-training', params: { clientId: q.clientId, name: q.name ?? '' } } as never)} />
      ))}
    </Section>
  );
}
