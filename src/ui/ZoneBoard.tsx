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
import { sp, radius, hairline, type as ty, numeric, value, grown } from '../theme/scale';
import { readableInkOn } from '../lib/a11y';
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
 * The same duration, said rather than drawn.
 *
 * `dur` is written for a 54pt column — "12:30", "1h 04m", and an em dash for
 * nothing at all. Read out, "12:30" is a clock time and "—" is silence, so the
 * spoken form spells the units and names the empty case.
 */
const spokenDur = (sec: number): string => {
  const s = Math.round(sec);
  if (s <= 0) return 'no time';
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}${rs ? ` ${rs} second${rs === 1 ? '' : 's'}` : ''}`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${rm ? ` ${rm} minute${rm === 1 ? '' : 's'}` : ''}`;
};

/**
 * The live readout: a big zone numeral, its name, and the current bpm.
 * `bpm` null → shows that nothing is being received rather than a zero.
 */
export function ZoneNow({ zone, bpm, compact }: { zone: ZoneNo | null; bpm?: number | null; compact?: boolean }) {
  const t = useTheme();
  const col = zone ? zoneColor(zone) : t.ink3;
  // "Zone 4" / "Push" / "162 bpm" are one fact and were three stops. One
  // element, the sentence a person would say — the kit's ONE CONTROL, ONE
  // SENTENCE rule, which this component was outside of.
  const spoken = zone
    ? [`Zone ${zone}`, zoneName(zone), bpm ? `${bpm} beats per minute` : ''].filter(Boolean).join(', ')
    : 'No heart rate — wear your watch';
  return (
    <View accessible accessibilityLabel={spoken}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
      <View style={{
        width: compact ? 44 : 56, height: compact ? 44 : 56, borderRadius: radius.md,
        backgroundColor: col, alignItems: 'center', justifyContent: 'center',
      }}>
        {/* ── the numeral is the primary channel, and it was 2.28:1 ────────
            This file's own header says the hues are too close to carry meaning
            — "every row leads with its numeral and its name; the coloured bar
            is confirmation, not information" — and then drew that numeral in
            hardcoded white on all five hues. Measured against src/lib/a11y.ts:

              zone 2  Light      #3B82F6   white 3.68:1   black 5.08:1
              zone 3  Base       #22C55E   white 2.28:1   black 8.20:1
              zone 4  Push       #F97316   white 2.80:1   black 6.66:1

            Zones 3 and 4 are below even the 3:1 a MARK needs, on the two zones
            a session is actually aimed at, on a tile a member glances at
            mid-effort. `readableInkOn` is the function the app already uses to
            decide ink on a white-label brand colour; it picks by measurement
            rather than by feel, and it takes every one of these to 5:1 or
            better. Zones 1 and 5 keep white — it is what it already chose. */}
        <Text style={{ ...value(compact ? 22 : 28), color: readableInkOn(col), letterSpacing: -0.5 }}>
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
        <View accessible
          accessibilityLabel={`${splat} splat point${splat === 1 ? '' : 's'}, ${spokenDur(total)} in total`}
          style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: sp.lg }}>
          <Text style={{ ...value(30), color: t.ink }}>{splat}</Text>
          <Text style={{ ...ty.label, color: t.ink2, marginStart: 7 }}>
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
        const lit = secs > 0 || on;
        // Five rows of three Texts is fifteen stops, and the one thing that
        // distinguishes the row you are in RIGHT NOW was a 5pt dot in the
        // zone's own colour at the end of the line — colour and position, the
        // two channels a screen reader has neither of and a phone in the sun
        // gives up first. Said instead, as one sentence per row.
        const spokenRow = [
          `Zone ${z.no}`, z.name, spokenDur(secs), on ? 'the zone you are in now' : '',
        ].filter(Boolean).join(', ');
        return (
          <View key={z.no} accessible accessibilityLabel={spokenRow}
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 7 }}>
            {/* numeral first — the primary channel. `readableInkOn` rather than
                a hardcoded white: see the measurement in ZoneNow above. This is
                the smaller of the two numerals and the one repeated five times
                down the board. */}
            <View style={{
              width: 26, height: 26, borderRadius: radius.sm,
              backgroundColor: lit ? z.color : t.surface3,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ ...ty.caption, fontWeight: '600', color: lit ? readableInkOn(z.color) : t.ink3 }}>{z.no}</Text>
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
        // `grown(17)` and not a raw 17. `ty.caption` already carries a line
        // height that scales with the reader's text; overriding it with a
        // pinned number here put the defect src/lib/typeScale.ts exists to end
        // straight back into this paragraph — at 235% text, 28pt glyphs laid
        // out in a 17pt line, which is the two-sentence explanation of what a
        // splat point IS rendered as overlapping strips.
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, lineHeight: grown(17) }}>
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
  const used = ZONES.filter((z) => (seconds[zoneKey(z.no)] || 0) > 0);
  // The strip is a row of coloured segments and nothing else — proportion
  // carried entirely by width and hue — and the legend under it reads out as
  // "3, 12:30" per item, which is a pair of numbers rather than a fact. The
  // whole component is one sentence: the segments are the drawing of it.
  const spoken = `Time in zone: ${used
    .map((z) => `zone ${z.no} ${z.name}, ${spokenDur(seconds[zoneKey(z.no)] || 0)}`)
    .join('; ')}`;
  return (
    <View accessible accessibilityLabel={spoken}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: t.surface3 }}>
        {used.map((z) => (
          <View key={z.no} style={{ flex: seconds[zoneKey(z.no)] || 0, backgroundColor: z.color }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm }}>
        {used.map((z) => (
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
