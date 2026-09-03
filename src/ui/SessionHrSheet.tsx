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
import { fmtDay, fmtTime } from '../lib/format';

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
      // No invented curve. If HealthKit has nothing for this window the chart says so,
      // rather than showing a fabricated session as if it were the user's own.
      if (!cancelled) setState({ samples: [], live: false });
    })();
    return () => { cancelled = true; };
  }, [visible, startISO, durationMin, age]);

  // The line under the title, and all three parts of it were this file's own
  // and all three were wrong for most readers:
  //
  //   · a hardcoded English weekday array, so "Wed" for somebody whose phone is
  //     in German;
  //   · `${d.getDate()}/${d.getMonth() + 1}` — "9/12" is 9 December in Britain
  //     and 12 September in the United States, over a session the member is
  //     looking at their own heart rate for;
  //   · a 12-hour clock hand-built in English, with no 24-hour form at all, so
  //     a member in Berlin read "7pm".
  //
  // All three are the reader's now. `fmtDay` and `fmtTime` in src/lib/format.ts
  // are the shared answers — `fmtClock` inside `fmtTime` asks Intl whether this
  // reader's locale is a 12- or 24-hour one rather than assuming, which is the
  // distinction en-GB and en-AU disagree on.
  const when = (() => {
    const d = new Date(startISO);
    if (isNaN(d.getTime())) return '';
    return `${fmtDay(startISO)} · ${fmtTime(startISO)} · ${Math.max(10, Math.round(durationMin) || 45)} min`;
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} accessibilityLabel="Close heart-rate detail" />
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: sp.lg, paddingBottom: 34, ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
          <View style={{ flex: 1, paddingEnd: sp.sm }}>
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
