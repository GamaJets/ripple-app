// InBody Progress — one view, two readers. The member sees it from the
// Progress tab (app/(client)/inbody.tsx) and the coach sees the same thing for
// a client (app/(trainer)/client-inbody.tsx). Every figure and verdict comes
// from src/lib/inbodyProgress.ts; this file only draws.
import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, Spark, Cta, Ghost, Notice, fig } from './kit';
import { MuscleBody } from './MuscleBody';
import { layerNames } from './muscleArt';
import { sp, radius, font, type as ty } from '../theme/scale';
import {
  scanSummary, trendSeries, segmentalOf, segmentOfLayer, compareScans, signed,
  type ProgressScan, type Verdict, type DeltaCell, type ProgressDef,
} from '../lib/inbodyProgress';
import { weightIn, type WeightUnit } from '../lib/units';
import { dayLabel } from '../lib/bodyFigures';
import type { Goal } from '../lib/types';

export function InBodyProgress({ scans, goal, unit, who, status, onUpload }: {
  scans: readonly ProgressScan[];
  goal?: Goal | null;
  unit: WeightUnit;
  /** "You" on the member's screen, the client's first name on the coach's. */
  who: string;
  status: 'loading' | 'ready' | 'partial' | 'error';
  /** Member only. The coach cannot upload a client's scan from here. */
  onUpload?: () => void;
}) {
  const t = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const keyOf = (s: ProgressScan) => s.id ?? s.takenAt;

  const sum = useMemo(() => scanSummary(scans, goal), [scans, goal]);
  const trends = useMemo(() => trendSeries(scans), [scans]);
  const seg = useMemo(() => segmentalOf(scans), [scans]);
  const newestFirst = useMemo(() => [...scans].sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1)), [scans]);

  // Body map: each segment's layers lit by its lean share.
  const intensity = useMemo(() => {
    const out: Record<string, number> = {};
    if (!seg) return out;
    for (const l of layerNames('front')) { const s = segmentOfLayer(l); if (s && seg.shade[s] != null) out[l] = Math.max(0.15, seg.shade[s]!); }
    return out;
  }, [seg]);

  const tone = (v: Verdict) => (v === 'good' ? t.good : v === 'bad' ? t.crit : t.ink3);
  const shown = (def: Pick<ProgressDef, 'mass'>, v: number | null) => (v == null ? null : def.mass ? weightIn(v, unit) : v);
  const unitOf = (def: Pick<ProgressDef, 'mass' | 'unit'>) => (def.mass ? unit : def.unit);
  const word = (v: Verdict) => (v === 'good' ? 'better' : v === 'bad' ? 'worse' : 'no change in direction');

  if (status === 'loading') return <Section><Text style={{ ...ty.label, color: t.ink3 }}>Reading the scans…</Text></Section>;
  if (status === 'error') {
    return (
      <Notice tone={t.warn} kicker="InBody" title="Scans Could Not Be Read"
        note="Nothing is shown because the scans did not come back, not because there are none." />
    );
  }
  if (!scans.length) {
    return (
      <Section>
        <SectionHead title="InBody Progress" />
        <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>
          {onUpload
            ? 'No InBody scans yet. Upload your printout and your muscle, fat, visceral fat, BMR and segmental lean are tracked here, scan by scan.'
            : `${who} has no InBody scans yet. Their scans appear here as soon as they upload one.`}
        </Text>
        {onUpload ? <Cta label="Upload InBody Scan" wide onPress={onUpload} /> : null}
      </Section>
    );
  }

  const Delta = ({ c, def, label }: { c: DeltaCell; def: ProgressDef; label: string }) => (
    <View style={{ flex: 1, alignItems: 'flex-end' }}
      accessibilityLabel={c.delta == null ? `${label}: none` : `${label}: ${signed(c.delta, def.decimals)} ${unitOf(def)}, ${word(c.verdict)}`}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.label, ...font('600'), color: tone(c.verdict) }}>
        {c.delta == null ? '—' : signed(def.mass ? (weightIn(c.delta, unit) ?? 0) : c.delta, def.decimals)}
      </Text>
    </View>
  );


  const pair = picked.length === 2
    ? (() => { const [x, y] = picked.map((k) => scans.find((s) => keyOf(s) === k)!); return x && y ? compareScans(x, y, goal) : null; })()
    : null;

  return (
    <View>
      {/* ── latest vs previous vs first ─────────────────────────────── */}
      <Section>
        <SectionHead title="Latest InBody Scan" note={sum.latest ? dayLabel(sum.latest.takenAt) : undefined} />
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
          {sum.previous ? `Against ${dayLabel(sum.previous.takenAt)}` : 'One scan so far: changes appear after the next one.'}
          {sum.first ? ` and the first scan, ${dayLabel(sum.first.takenAt)}` : ''}. Green is progress, red is the wrong way.
        </Text>
        {sum.rows.map((r) => (
          <View key={r.def.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: sp.sm, borderTopWidth: 1, borderTopColor: t.ring }}>
            <View style={{ flex: 1.6 }}>
              <Text style={{ ...ty.label, color: t.ink2 }}>{r.def.label}</Text>
              <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>{fig(shown(r.def, r.latest))} <Text style={{ ...ty.caption, color: t.ink3 }}>{unitOf(r.def)}</Text></Text>
            </View>
            <Delta c={r.vsPrevious} def={r.def} label="vs last" />
            {sum.first ? <Delta c={r.vsFirst} def={r.def} label="vs first" /> : null}
          </View>
        ))}
        {onUpload ? <View style={{ marginTop: sp.md }}><Cta label="Upload InBody Scan" wide onPress={onUpload} /></View> : null}
      </Section>

      {/* ── trends ─────────────────────────────────────────────────── */}
      <Section>
        <SectionHead title="Trends" note={`${scans.length} scan${scans.length === 1 ? '' : 's'}${status === 'partial' ? ', most recent only' : ''}`} />
        {trends.map((x) => (
          <View key={x.def.key} style={{ marginBottom: sp.lg }}>
            <Text style={{ ...ty.label, ...font('500'), color: t.ink2, marginBottom: 4 }}>{x.def.label} · {unitOf(x.def)}</Text>
            {x.values.length > 1
              ? <Spark data={x.values.map((v) => shown(x.def, v))} labels={x.dates} unit={unitOf(x.def)} area />
              : <Text style={{ ...ty.caption, color: t.ink3 }}>One reading. A line needs two.</Text>}
          </View>
        ))}
      </Section>

      {/* ── segmental lean ─────────────────────────────────────────── */}
      {seg ? (
        <Section>
          <SectionHead title="Segmental Lean" note={dayLabel(seg.at)} />
          <View style={{ flexDirection: 'row', gap: sp.lg, alignItems: 'center' }}>
            <MuscleBody side="front" intensity={intensity} status="ready" height={190} legend={false} captions={false} />
            <View style={{ flex: 1 }}>
              {seg.segments.map((s) => (
                <View key={s.seg} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{s.label}</Text>
                  <Text style={{ ...ty.label, ...font('600'), color: t.ink }}>
                    {fig(weightIn(s.kg, unit))}{' '}
                    <Text style={{ color: tone(s.verdict) }}>{s.delta == null ? '' : signed(weightIn(s.delta, unit) ?? 0, 2)}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
          {seg.imbalances.map((b) => (
            <Text key={b.pair} style={{ ...ty.caption, color: t.warn, marginTop: sp.sm }}>
              {b.pair === 'arms' ? 'Arms' : 'Legs'}: the {b.heavier} side carries {b.pct}% more lean mass.
            </Text>
          ))}
        </Section>
      ) : null}

      {/* ── history, detail and compare ─────────────────────────────── */}
      <Section>
        <SectionHead title="Scan History" note={picked.length ? `${picked.length} of 2 picked to compare` : 'Tap to open · Compare picks two'} />
        {newestFirst.map((s) => {
          const k = keyOf(s); const open = openId === k; const on = picked.includes(k);
          return (
            <View key={k} style={{ borderTopWidth: 1, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: sp.sm }}>
                <Pressable style={{ flex: 1 }} onPress={() => setOpenId(open ? null : k)} accessibilityRole="button"
                  accessibilityLabel={`Scan ${dayLabel(s.takenAt)}. ${open ? 'Close' : 'Open'} its figures`}>
                  <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>{dayLabel(s.takenAt)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {fig(weightIn(s.weightKg, unit))} {unit} · {fig(s.bodyFatPct)}% · {s.source ?? 'InBody'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setPicked((p) => (on ? p.filter((x) => x !== k) : [...p.slice(-1), k]))}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Compare the ${dayLabel(s.takenAt)} scan`}
                  style={{ paddingHorizontal: sp.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.caption, ...font('600'), color: on ? t.brandInk : t.ink2 }}>{on ? 'Picked' : 'Compare'}</Text>
                </Pressable>
              </View>
              {open ? (
                <View style={{ paddingBottom: sp.sm }}>
                  {compareScans(s, s, goal).rows.map((r) => (
                    <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{r.label}</Text>
                      <Text style={{ ...ty.caption, color: t.ink }}>{fig(r.b)} {r.unit}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        {pair ? (
          <View style={{ marginTop: sp.md, padding: sp.md, borderRadius: radius.md, backgroundColor: t.surface2 }}>
            <View style={{ flexDirection: 'row', marginBottom: sp.sm }}>
              <Text style={{ flex: 1.4, ...ty.micro, color: t.ink3 }}>Side by side</Text>
              <Text style={{ flex: 1, ...ty.micro, color: t.ink3, textAlign: 'right' }}>{dayLabel(pair.a.takenAt)}</Text>
              <Text style={{ flex: 1, ...ty.micro, color: t.ink3, textAlign: 'right' }}>{dayLabel(pair.b.takenAt)}</Text>
              <Text style={{ flex: 0.8, ...ty.micro, color: t.ink3, textAlign: 'right' }}>Change</Text>
            </View>
            {pair.rows.map((r) => (
              <View key={r.label} style={{ flexDirection: 'row', paddingVertical: 3 }}>
                <Text style={{ flex: 1.4, ...ty.caption, color: t.ink2 }}>{r.label}</Text>
                <Text style={{ flex: 1, ...ty.caption, color: t.ink, textAlign: 'right' }}>{fig(r.a)}</Text>
                <Text style={{ flex: 1, ...ty.caption, color: t.ink, textAlign: 'right' }}>{fig(r.b)}</Text>
                <Text style={{ flex: 0.8, ...ty.caption, ...font('600'), color: tone(r.verdict), textAlign: 'right' }}>
                  {r.delta == null ? '—' : signed(r.delta, 2)}
                </Text>
              </View>
            ))}
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>Figures as printed on the scan (kg).</Text>
            <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}><Ghost label="Clear" onPress={() => setPicked([])} /></View>
          </View>
        ) : null}
      </Section>
    </View>
  );
}
