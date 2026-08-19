// ── Zone board ───────────────────────────────────────────────────────────────
// The studio-wall view of heart-rate effort: which zone you are in right now,
// how long you have spent in each, and your splat points.
//
// Colour NEVER carries meaning on its own here — see the accessibility note in
// `src/lib/hr.ts`. Zone 3 green and zone 4 orange are only ΔE 6.2 apart under
// deuteranopia, and zone 4 orange and zone 5 red are only ΔE 14.9 apart under
// normal vision. So every row leads with its numeral and its name; the coloured
// bar is confirmation, not information.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { sp, radius, hairline, type as ty, numeric, value } from '../theme/scale';
import {
  ZONES, type ZoneNo, type ZoneSeconds, zoneKey, zoneSecondsTotal, splatPoints, zoneName, zoneColor,
} from '../lib/hr';

const dur = (sec: number): string => {
  const s = Math.round(sec);
  if (s <= 0) return '—';
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/**
 * The live readout: a big zone numeral, its name, and the current bpm.
 * `bpm` null → shows that nothing is being received rather than a zero.
 */
export function ZoneNow({ zone, bpm, compact }: { zone: ZoneNo | null; bpm?: number | null; compact?: boolean }) {
  const t = useTheme();
  const col = zone ? zoneColor(zone) : t.ink3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
      <View style={{
        width: compact ? 44 : 56, height: compact ? 44 : 56, borderRadius: radius.md,
        backgroundColor: col, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ ...value(compact ? 22 : 28), color: '#FFFFFF', letterSpacing: -0.5 }}>
          {zone ?? '–'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>{zone ? `Zone ${zone}` : 'No heart rate'}</Text>
        <Text style={{ ...ty.head, color: t.ink, marginTop: 2 }}>
          {zone ? zoneName(zone) : 'Wear your watch'}
        </Text>
        {bpm ? (
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{bpm} bpm</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Five rows, one per zone: numeral, name, a proportional bar, and time in it.
 * The row you are currently in is marked with a dot, not by colour alone.
 */
export function ZoneBoard({ seconds, current, showSplat = true }: {
  seconds: ZoneSeconds; current?: ZoneNo | null; showSplat?: boolean;
}) {
  const t = useTheme();
  const total = zoneSecondsTotal(seconds);
  const splat = splatPoints(seconds);
  const peak = Math.max(1, ...ZONES.map((z) => seconds[zoneKey(z.no)] || 0));

  return (
    <View>
      {showSplat ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: sp.lg }}>
          <Text style={{ ...value(30), color: t.ink }}>{splat}</Text>
          <Text style={{ ...ty.label, color: t.ink2, marginLeft: 7 }}>
            splat point{splat === 1 ? '' : 's'}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{dur(total)} total</Text>
        </View>
      ) : null}

      {[...ZONES].reverse().map((z) => {
        const secs = seconds[zoneKey(z.no)] || 0;
        const on = current === z.no;
        const pct = Math.round((secs / peak) * 100);
        return (
          <View key={z.no} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 7 }}>
            {/* numeral first — the primary channel */}
            <View style={{
              width: 26, height: 26, borderRadius: radius.sm,
              backgroundColor: secs > 0 || on ? z.color : t.surface3,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ ...ty.caption, fontWeight: '600', color: secs > 0 || on ? '#FFFFFF' : t.ink3 }}>{z.no}</Text>
            </View>

            <View style={{ width: 62 }}>
              <Text style={{ ...ty.caption, color: on ? t.ink : t.ink2 }} numberOfLines={1}>{z.name}</Text>
            </View>

            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden' }}>
              <View style={{ height: 6, borderRadius: 3, width: `${pct}%`, backgroundColor: z.color }} />
            </View>

            <View style={{ width: 54, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 5 }}>
              {on ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: z.color }} /> : null}
              <Text style={{ ...ty.caption, ...numeric, color: secs > 0 ? t.ink : t.ink3 }}>{dur(secs)}</Text>
            </View>
          </View>
        );
      })}

      {showSplat ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, lineHeight: 17 }}>
          A splat point is one minute at zone 4 or above. Zones are set from an estimated
          max heart rate of 220 minus your age.
        </Text>
      ) : null}
    </View>
  );
}

/** A single compact strip — proportional segments, for a session summary row. */
export function ZoneStrip({ seconds }: { seconds: ZoneSeconds }) {
  const t = useTheme();
  const total = zoneSecondsTotal(seconds);
  if (total <= 0) return null;
  return (
    <View>
      <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: t.surface3 }}>
        {ZONES.map((z) => {
          const secs = seconds[zoneKey(z.no)] || 0;
          if (secs <= 0) return null;
          return <View key={z.no} style={{ flex: secs, backgroundColor: z.color }} />;
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm }}>
        {ZONES.filter((z) => (seconds[zoneKey(z.no)] || 0) > 0).map((z) => (
          <View key={z.no} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: z.color }} />
            <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>
              {z.no} · {dur(seconds[zoneKey(z.no)])}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
