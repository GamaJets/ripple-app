// The coach's Today inbox: form checks waiting on an answer.
//
// Renders nothing while loading and nothing when nobody is waiting: a heading
// over an empty space is noise on the first screen a coach opens. A failed
// read says so, because "no form checks" over a read that did not land is a
// coach who stops looking. Tapping a row opens that client's training, where
// the clip plays and the answer is written (app/(trainer)/client-training.tsx).
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from './components';
import { Section, SectionHead, ListRow } from './kit';
import { type as ty } from '../theme/scale';
import { fetchWaitingFormClips, type WaitingClip } from './formClips';
import { fmtRelativeDay } from '../lib/format';

export function FormCheckInbox({ coachId }: { coachId: string | null }) {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<WaitingClip[] | null | undefined>(undefined);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!coachId) return () => { live = false; };
    void fetchWaitingFormClips(coachId).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [coachId]));

  if (rows === undefined) return null;
  if (rows !== null && rows.length === 0) return null;

  return (
    <Section>
      <SectionHead title="Form Checks" note={rows ? `${rows.length} waiting` : undefined} />
      {rows === null ? (
        <Text style={{ ...ty.label, color: t.ink2 }}>
          Form checks could not be read just now. This is not a statement that nobody has sent one.
        </Text>
      ) : rows.map((w) => (
        <ListRow key={w.clip.id} icon="video"
          title={w.memberName ?? 'A client'}
          note={w.clip.note ? `“${w.clip.note}”` : 'Filmed a set for you to watch'}
          meta={`Sent ${fmtRelativeDay(w.clip.createdAt)} · not answered yet`}
          onPress={() => router.push({ pathname: '/(trainer)/client-training', params: { clientId: w.memberId, name: w.memberName ?? '' } } as never)} />
      ))}
    </Section>
  );
}
