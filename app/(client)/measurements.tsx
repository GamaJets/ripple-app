// Client · Body Measurements. Log tape measurements over time; see the latest
// value and change since the previous entry, plus full history. Reached from the
// profile hub. Complements the InBody scans (Progress tab).
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: waist is the
// screen's one hero figure, the grid of bordered tiles-inside-a-card became
// hairline metric rows, the Georgia serif header is gone, and a change no longer
// paints itself in a status colour — it carries a mark beside ink text.
//
// TF-37: this screen said "cm" in five places and meant it — the values were
// stored, entered and printed in centimetres with no reference to the unit
// preference, which nothing in the app read anyway. Storage is still
// centimetres; what a client who reads in inches types and sees is converted at
// the edge, in src/lib/units.ts. A change is converted as a SPAN rather than as
// the difference of two converted readings, so "−1.0 cm" is always "−0.4 in"
// and not 0.3 one month and 0.4 the next.
import { useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useMeasurements, METRICS, type MeasureEntry } from '../../src/ui/measurements';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { lengthIn, lengthLabel, lengthToCm, lengthDeltaIn, plain, convertedNote } from '../../src/lib/units';

function fmtDate(iso: string) {
 return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Measurements() {
 const t = useTheme();
 const router = useRouter();
 const { entries, addEntry } = useMeasurements();
 const [vals, setVals] = useState<Record<string, string>>({});
 // The unit the client reads lengths in — theirs, not this device's. See
 // src/ui/settings.tsx and supabase/parts/61-unit-preference.sql.
 const lu = useSettings().lengthUnit;
 const note = convertedNote(lu);

 const latest = entries[0];
 const prev = entries[1];
 const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));
 // The last figure logged for this part, in the client's unit, as the empty
 // field's grey hint. Undefined when there is none — the hint falls back to the
 // unit rather than to a number nobody measured.
 const lastEntered = (k: (typeof METRICS)[number]['key']) => {
  const v = lengthIn(latest?.[k], lu);
  return v == null ? null : plain(v);
 };
 const save = () => {
 const parsed: Record<string, number> = {};
 // Typed in the client's unit, stored in centimetres. `parseFloat` alone read
 // an inch entry as centimetres, which is only invisible while the preference
 // does nothing — the moment it does, a 32 in waist becomes a 32 cm one.
 for (const { key } of METRICS) { const cm = lengthToCm(vals[key], lu); if (cm != null && cm > 0) parsed[key] = cm; }
 if (Object.keys(parsed).length === 0) { Alert.alert('Nothing to save', 'Enter at least one measurement.'); return; }
 addEntry(parsed);
 setVals({});
 Alert.alert('Saved', 'Your measurements were logged.');
 };

 const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, width: 96, textAlign: 'center' } as const;

 // Presentation-only: waist is the first tape measurement and the one people
 // track, so it leads. With no waist logged there is no hero — not a zero.
 const waistNow = lengthIn(latest?.waist, lu);
 const waistWas = prev?.waist;
 const waistMove = latest?.waist != null && waistWas != null ? lengthDeltaIn(latest.waist - waistWas, lu) : null;
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Tape measurements in {lu}</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Body measurements</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  {/* ── the hero: waist, when there is one ──────────────────────────── */}
  {waistNow != null ? (
   <Hero
    label="Waist"
    figure={fig(waistNow)}
    unit={lu}
    note={waistMove !== null && waistMove !== 0
     ? `${waistMove < 0 ? '−' : '+'}${plain(Math.abs(waistMove))} ${lu} since ${fmtDate(prev!.at)}`
     : waistMove === 0
     ? `Unchanged since ${fmtDate(prev!.at)}`
     : `First entry · ${fmtDate(latest.at)}`}
   />
  ) : null}

  {/* ── latest snapshot with change vs previous ─────────────────────── */}
  {latest ? (<>
   <Rule />
   <Section>
    <SectionHead title={`Latest · ${fmtDate(latest.at)}`} note={prev ? `vs ${fmtDate(prev.at)}` : undefined} />
    {METRICS.map(({ key, label }) => {
     const raw = latest[key]; if (raw == null) return null;
     const pv = prev ? prev[key] : undefined;
     const d = pv != null ? lengthDeltaIn(raw - pv, lu) : null;
     return (
      <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
       <Text style={{ ...ty.label, color: t.ink2 }}>{label}</Text>
       <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink }}>{fig(lengthLabel(raw, lu))}</Text>
        {d != null && d !== 0 ? (
         <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 62, justifyContent: 'flex-end' }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: d < 0 ? t.brand : t.ink3 }} />
          <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{d > 0 ? '+' : '−'}{plain(Math.abs(d))} {lu}</Text>
         </View>
        ) : (
         <Text style={{ ...ty.caption, color: t.ink3, minWidth: 62, textAlign: 'right' }}>—</Text>
        )}
       </View>
      </View>
     );
    })}
   </Section>
  </>) : null}

  <Rule />

  {/* ── new entry ───────────────────────────────────────────────────── */}
  <Section>
   <SectionHead title="Log new measurements" note={lu} />
   {METRICS.map(({ key, label }) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.sm }}>
     <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2 }}>{label}</Text>
     <TextInput value={vals[key] ?? ''} onChangeText={(v) => set(key, v)} keyboardType="numeric"
      accessibilityLabel={`${label} in ${lu === 'cm' ? 'centimetres' : 'inches'}`}
      placeholder={lastEntered(key) ?? lu} placeholderTextColor={t.ink3} style={inp} />
    </View>
   ))}
   {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{note}</Text> : null}
   <View style={{ height: sp.sm }} />
   <Cta label="Save entry" wide onPress={save} />
  </Section>

  <Rule />

  {/* ── history ─────────────────────────────────────────────────────── */}
  <Section>
   <SectionHead title="History" note={entries.length ? `${entries.length} entries` : undefined} />
   {entries.length === 0 ? (
    <Text style={{ ...ty.label, color: t.ink3 }}>No measurements logged yet — save your first entry above and the history builds here.</Text>
   ) : null}
   {entries.map((e: MeasureEntry, i) => (
    <View key={e.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
     <Text style={{ ...ty.caption, color: t.ink3 }}>{new Date(e.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
     <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg, marginTop: 5 }}>
      {METRICS.map(({ key, label }) => e[key] != null ? (
       <Text key={key} style={{ ...ty.caption, color: t.ink3 }}>{label} <Text style={{ ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(lengthIn(e[key], lu))}</Text></Text>
      ) : null)}
     </View>
    </View>
   ))}
  </Section>
 </ScrollView>
 </SafeAreaView>
 );
}
