// Per-session heart-rate sheet — opened from a logged workout entry. Shows the
// HR zone chart scoped to that session's time window: live Apple-Watch samples
// when HealthKit has them for the window, else a sample curve of the same
// duration (so the feature is visible on Android / without a watch).
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useTheme } from './components';
import { HrZoneChart } from './HrZoneChart';
import { sp, radius, hairline, elevation, type as ty } from '../theme/scale';
import type { HrSample } from '../lib/hr';
import { PROVIDERS } from '../lib/wearables/registry';
import { reportError } from '../lib/reportError';

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
        } catch (e) { reportError('sessionHrSheet.appleHrSeries', e); }
      }
      // No demo curve. If HealthKit has nothing for this window the chart says so,
      // rather than showing a fabricated session as if it were the user's own.
      if (!cancelled) setState({ samples: [], live: false });
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
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: sp.lg, paddingBottom: 34, ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
          <View style={{ flex: 1, paddingRight: sp.sm }}>
            <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }} numberOfLines={1}>{title}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 1 }}>{when}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}><Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Close</Text></Pressable>
        </View>
        {state == null ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={t.brand} /></View>
        ) : (
          <>
            <HrZoneChart samples={state.samples} age={age} title="Heart-rate Zones" subtitle={state.live ? 'From your Apple Watch' : 'No heart rate recorded for this session'} />
          </>
        )}
      </View>
    </Modal>
  );
}
