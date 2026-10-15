// A client's InBody Progress, as the coach sees it — the same view the client
// has (src/ui/InBodyProgress.tsx), read from `scans` under the coach's RLS.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { PageHead } from '../../src/ui/kit';
import { useSettings } from '../../src/ui/settings';
import { InBodyProgress } from '../../src/ui/InBodyProgress';
import { layout } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import type { ProgressScan } from '../../src/lib/inbodyProgress';
import type { Goal } from '../../src/lib/types';

const CAP = 200;

export default function ClientInBody() {
  const t = useTheme();
  const router = useRouter();
  const wu = useSettings().weightUnit;
  const { clientId, name } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const [scans, setScans] = useState<ProgressScan[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading');
  const wanted = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    const id = typeof clientId === 'string' ? clientId : '';
    wanted.current = id;
    if (!id) { setStatus('error'); return; }
    setStatus('loading');
    const [s, c] = await Promise.all([
      supabase.from('scans').select('id, taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg, source, metrics')
        .eq('client_id', id).order('taken_at', { ascending: false }).order('created_at', { ascending: false }).limit(CAP),
      supabase.from('clients').select('goal').eq('id', id).limit(1),
    ]);
    if (wanted.current !== id) return;
    if (s.error) { reportError('clientInBody.scans', s.error); setStatus('error'); return; }
    const rows = (s.data ?? []) as any[];
    // One scan per day, the latest written winning — the client's own app does the same.
    const byDay = new Map<string, ProgressScan>();
    for (const r of [...rows].reverse()) {
      byDay.set(String(r.taken_at).slice(0, 10), {
        id: r.id, takenAt: String(r.taken_at).slice(0, 10), weightKg: r.weight_kg != null ? Number(r.weight_kg) : null,
        bodyFatPct: r.body_fat_pct != null ? Number(r.body_fat_pct) : null,
        skeletalMuscleKg: r.skeletal_muscle_kg != null ? Number(r.skeletal_muscle_kg) : null,
        source: r.source ?? null, metrics: r.metrics ?? null,
      });
    }
    setScans([...byDay.values()]);
    const g = (c.data?.[0] as any)?.goal;
    setGoal(g === 'fatloss' || g === 'tone' || g === 'muscle' ? g : null);
    setStatus(rows.length >= CAP ? 'partial' : 'ready');
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const first = (typeof name === 'string' && name.trim() ? name.trim().split(' ')[0] : 'This client');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 120 }}>
        <PageHead title="InBody Progress" subtitle={typeof name === 'string' && name ? name : undefined} onBack={() => router.back()} />
        <InBodyProgress scans={scans} goal={goal} unit={wu} who={first} status={status} />
      </ScrollView>
    </SafeAreaView>
  );
}
