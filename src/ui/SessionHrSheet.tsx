// Per-session heart-rate sheet — opened from a logged workout entry. Shows the
// HR zone chart scoped to that session's time window: live Apple-Watch samples
// when HealthKit has them for the window, else a sample curve of the same
// duration (so the feature is visible on Android / without a watch).
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useTheme } from './components';
import { HrZoneChart } from './HrZoneChart';
import { demoHrSeries, type HrSample } from '../lib/hr';
import { PROVIDERS } from '../lib/wearables/registry';

export function SessionHrSheet({ visible, onClose, title, startISO, durationMin, age }: {
  visible: boolean; onClose: () => void; title: string; startISO: string; durationMin: number; age?: number | null;
}) {
  const t = useTheme();
  const [state, setState] = useState<{ samples: HrSample[]; live: boolean } | null>(null);

  useEffect(() => {
    if (!visible) { setState(null); return; }
    let cancelled = false;
    (async () => {
      const startMs = Date.parse(startISO);
      const mins = Math.max(10, Math.round(durationMin) || 45);
      const endMs = startMs + mins * 60 * 1000;
      const apple = PROVIDERS.find((p) => p.meta.id === 'apple');
      const fetchHr = apple?.fetchHeartRateSeries;
      if (fetchHr && apple && apple.isAvailable() && isFinite(startMs)) {
        try {
          const s = await fetchHr(new Date(startMs).toISOString(), new Date(endMs).toISOString());
          if (!cancelled && s && s.length >= 2) { setState({ samples: s, live: true }); return; }
        } catch { /* fall through to sample */ }
      }
      if (!cancelled) setState({ samples: demoHrSeries(age, isFinite(endMs) ? endMs : Date.now(), mins), live: false });
    })();
    return () => { cancelled = true; };
  }, [visible, startISO, durationMin, age]);

  const when = (() => {
    const d = new Date(startISO);
    if (isNaN(d.getTime())) return '';
    let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap} · ${Math.max(10, Math.round(durationMin) || 45)} min`;
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} accessibilityLabel="Close heart-rate detail" />
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 18, paddingBottom: 34 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800', textTransform: 'capitalize' }} numberOfLines={1}>{title}</Text>
            <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 1 }}>{when}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Close</Text></Pressable>
        </View>
        {state == null ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
        ) : (
          <>
            <HrZoneChart samples={state.samples} age={age} title="Heart-rate zones" subtitle={state.live ? 'From your Apple Watch' : 'Sample data — wear your watch during workouts for your real zones'} />
          </>
        )}
      </View>
    </Modal>
  );
}
