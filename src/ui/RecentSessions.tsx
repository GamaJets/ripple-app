// History's most recent sessions, each one shareable as the same branded card
// the finish screen makes (src/lib/postCard.ts workoutPost → SharePostSheet,
// SVG rendered to PNG through react-native-svg's toDataURL and handed to the
// system share sheet by expo-sharing — both already in the binary).
import { useMemo, useState } from 'react';
import { Section, SectionHead, ListRow } from './kit';
import { SharePostSheet } from './SharePost';
import { useBrand } from './brand';
import { sessionsOf, type LoggedSession } from '../lib/clientTraining';
import { workoutPost, type PostBuild } from '../lib/postCard';
import { topMovements } from '../lib/workoutShare';
import { fmtDay } from '../lib/format';
import { volumeHeadline, liftLabel, type WeightUnit } from '../lib/units';
import { sessionRecords } from '../lib/sessionRecords';
import type { WorkoutEntry } from '../lib/mockData';
import type { BodyweightHistory } from '../lib/bodyweightSets';

const SHOWN = 8;

function volumeText(kg: number | null, unit: WeightUnit): string | null {
  if (kg == null || !(kg > 0)) return null;
  const v = volumeHeadline(kg, unit);
  return v ? `${v.figure.toLocaleString()} ${unit === 'kg' ? 't' : 'lb'}` : null;
}

export function sessionPost(s: LoggedSession, unit: WeightUnit, brand: string, prs: string[] = []): PostBuild {
  return workoutPost({
    focus: 'Workout', sets: s.sets, minutes: s.mins != null && s.mins > 0 ? Math.round(s.mins) : null,
    volume: volumeText(s.volumeKg, unit), prs, brand,
    date: s.day ? fmtDay(s.at) : null,
    top: topMovements(s.entries.map((e) => ({
      name: e.exercise,
      sets: (e.sets ?? []).filter((_, i) => !e.timed?.[i]).map((st, i) => [st[0], e.bw?.[i] ? null : st[1]] as const),
    }))),
  });
}

export function RecentSessions({ log, unit, weightSeries, whole = true }: {
  log: readonly WorkoutEntry[]; unit: WeightUnit; weightSeries?: BodyweightHistory;
  /** False when the log is not known whole: a record needs everything before it. */
  whole?: boolean;
}) {
  const { appName } = useBrand();
  const [build, setBuild] = useState<PostBuild | null>(null);
  const sessions = useMemo(
    () => sessionsOf(log, weightSeries ?? []).filter((s) => !s.cardio && s.sets > 0).slice(0, SHOWN),
    [log, weightSeries],
  );
  if (!sessions.length) return null;
  return (
    <Section>
      <SectionHead title="Recent Sessions" note="Tap to Share" />
      {sessions.map((s) => {
        const prs = whole ? sessionRecords(log, s.at).map((r) => `${r.exercise} ${liftLabel(r.kg, unit) ?? ''}`.trim()) : [];
        const vol = volumeText(s.volumeKg, unit);
        return (
          <ListRow key={s.at} icon={prs.length ? 'trophy' : 'share'}
            title={s.day ? fmtDay(s.at) : 'Undated session'}
            note={prs.length ? `PR · ${prs.slice(0, 2).join(' · ')}` : topMovements(s.entries.map((e) => ({ name: e.exercise, sets: (e.sets ?? []).map((x) => [x[0], x[1]] as const) })), 3).join(' · ')}
            meta={[`${s.sets} ${s.sets === 1 ? 'set' : 'sets'}`, vol, prs.length ? `${prs.length} PR${prs.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
            onPress={() => setBuild(sessionPost(s, unit, appName, prs))} />
        );
      })}
      <SharePostSheet build={build} onClose={() => setBuild(null)} invite />
    </Section>
  );
}
