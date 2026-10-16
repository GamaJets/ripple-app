// The Sunday summary the server wrote (part 3540), at the top of the Weekly
// Report the push opens. Figures are the server's, in kilograms, converted
// here once. Renders nothing until the first Sunday has come round, and says
// so plainly when the read fails rather than showing an empty week.
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from './components';
import { Section, SectionHead, KpiRow } from './kit';
import { type as ty, sp } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fmtDay } from '../lib/format';
import { liftIn, volumeHeadline, type WeightUnit } from '../lib/units';
import { deltaLabel } from '../lib/deltaLabel';

interface Week {
  week_start: string;
  figures: { workouts?: number; sets?: number; volume_kg?: number; prs?: number; streak?: number;
    scan_this_week?: boolean; weight_delta_kg?: number | null; body_fat_delta_pct?: number | null; muscle_delta_kg?: number | null };
}

export function WeeklySummary({ unit }: { unit: WeightUnit }) {
  const t = useTheme();
  const [week, setWeek] = useState<Week | null | undefined>(undefined);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!USE_SUPABASE) { setWeek(undefined); return () => { live = false; }; }
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('my_weekly_reports');
        if (error) { reportError('weeklySummary.read', error); if (live) setWeek(null); return; }
        const rows = (data ?? []) as Week[];
        if (live) setWeek(rows[0] ?? undefined);
      } catch (e) { reportError('weeklySummary.read', e); if (live) setWeek(null); }
    })();
    return () => { live = false; };
  }, []));

  if (week === undefined) return null;
  if (week === null) {
    return (
      <Section>
        <Text style={{ ...ty.label, color: t.ink2 }}>Your Sunday summary could not be read just now. Your training is unaffected.</Text>
      </Section>
    );
  }
  const f = week.figures;
  const vol = f.volume_kg != null && f.volume_kg > 0 ? volumeHeadline(f.volume_kg, unit) : null;
  const w = f.weight_delta_kg != null ? liftIn(f.weight_delta_kg, unit) : null;
  return (
    <Section>
      <SectionHead title="Sunday Summary" note={`Week of ${fmtDay(`${week.week_start}T12:00:00`)}`} />
      <KpiRow items={[
        { label: 'Workouts', value: String(f.workouts ?? 0) },
        { label: 'Sets', value: String(f.sets ?? 0) },
        { label: 'Volume', value: vol ? `${vol.figure.toLocaleString()}${unit === 'kg' ? 't' : ''}` : '0', unit: vol && unit === 'lb' ? 'lb' : undefined },
      ]} />
      <KpiRow items={[
        { label: 'New Bests', value: String(f.prs ?? 0) },
        { label: 'Streak', value: String(f.streak ?? 0), unit: 'days' },
      ]} />
      {f.scan_this_week && (w != null || f.body_fat_delta_pct != null) ? (
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
          {`InBody this week: weight ${deltaLabel(w, { unit, decimals: 1, since: 'your last scan' })}, body fat ${deltaLabel(f.body_fat_delta_pct, { unit: '%', decimals: 1, since: null })}.`}
        </Text>
      ) : null}
    </Section>
  );
}
