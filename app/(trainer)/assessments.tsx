// Coach · Assessments. The four standard tests for one client: record one, see
// the last result and the change since the one before, and the whole history
// per test. What is saved here is the row the client's own app reads under My
// Assessments (app/(client)/assessments.tsx), so both see the same record.
//
// Registered `href: null` inside <Tabs>, so it never unmounts: everything that
// belongs to one client lives in <ClientAssessments key={id}>, which remounts
// when the subject changes rather than carrying one person's form onto another.
import { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ListRow, PageHead, Notice, Cta, Ghost, Field, Segmented, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { isWhole } from '../../src/ui/loadStatus';
import { useSubmitOnce } from '../../src/ui/submitOnce';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { useAssessments } from '../../src/ui/assessments';
import { AssessmentSeries } from '../../src/ui/AssessmentSeries';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { subjectOf } from '../../src/lib/routeSubject';
import { readLift, readNumber, type WeightUnit } from '../../src/lib/units';
import { readReps } from '../../src/lib/repEstimate';
import { fmtDay } from '../../src/lib/format';
import {
  ASSESSMENT_TYPES, MOVEMENT_PATTERNS, MOBILITY_CHECKS, STRENGTH_LIFTS, MOVEMENT_SCORE_MAX,
  buildRecord, groupSeries, totalLabel, slug, type AssessmentKind, type Direction, type Grade, type Series, type RecordRow,
} from '../../src/lib/assessments';

export default function CoachAssessments() {
  const t = useTheme();
  const r = useRoster();
  const { clientId, name } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const fromRoute = subjectOf(clientId);
  // undefined follows the route; null is the picker; a string is a choice made here.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [seen, setSeen] = useState(fromRoute);
  if (seen !== fromRoute) { setSeen(fromRoute); setPicked(undefined); }
  const id = picked === undefined ? fromRoute : picked;
  const client = r.roster.find((c) => c.id === id);
  const who = client?.name ?? (typeof name === 'string' && name ? name : null);
  const askable = clientIsQueryable(id, client?.handAdded);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {id && askable ? (
        <ClientAssessments key={id} clientId={id} who={who} onSwitch={() => setPicked(null)} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}>
          <PageHead title="Assessments" subtitle="Pick a Client" />
          {id && !askable ? (
            <Notice kicker="Not Available" title="Assessments need a client with an account"
              note="This person was added by hand, so there is no record for tests to be kept on or shared to." />
          ) : null}
          <Section>
            <SectionHead title="Client" />
            {r.roster.length === 0 && isWhole(r.status) ? <EmptyRoster lacks="there is nobody to assess" /> : null}
            {r.roster.filter((c) => clientIsQueryable(c.id, c.handAdded)).map((c) => (
              <ListRow key={c.id} icon="target" tone="teal" title={c.name} onPress={() => setPicked(c.id)} />
            ))}
          </Section>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

interface Recording { kind: AssessmentKind; testKey?: string; name?: string; unit?: string; direction?: Direction }

function ClientAssessments({ clientId, who, onSwitch }: { clientId: string; who: string | null; onSwitch: () => void }) {
  const t = useTheme();
  const wu = useSettings().weightUnit;
  const a = useAssessments(clientId);
  const pull = usePullToRefresh(a.reload);
  useRefreshOnFocus(a.reload);
  const series = useMemo(() => groupSeries(a.list), [a.list]);
  const [rec, setRec] = useState<Recording | null>(null);
  const [said, setSaid] = useState<{ tone: string; text: string } | null>(null);

  const latestOfKind = (k: AssessmentKind) => series.find((s) => s.kind === k);
  const startFor = (s: Series) => {
    const last = s.history[s.history.length - 1];
    setSaid(null);
    setRec({
      kind: s.kind, testKey: last.testKey,
      name: typeof last.results.name === 'string' ? last.results.name : undefined,
      unit: last.unit, direction: s.direction,
    });
  };

  const confirmDelete = (row: { id: string; recordedAt: string }) => {
    Alert.alert('Delete This Test?', `The result from ${fmtDay(row.recordedAt)} will be removed from both apps.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const why = await a.remove(row.id);
          setSaid(why ? { tone: t.crit, text: why } : { tone: t.good, text: 'Deleted.' });
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false} refreshControl={pull} keyboardShouldPersistTaps="handled">
      <PageHead title="Assessments" subtitle={who ?? undefined}
        trailing={<Ghost label="Switch" onPress={onSwitch} a11yLabel="Switch client" />} />

      {a.status === 'error' ? (
        <Notice tone={t.crit} kicker="Not Loaded" title="Their tests could not be read"
          note="This is a failed read, not an empty record. Pull down to try again." />
      ) : a.status === 'partial' ? (
        <Notice tone={t.warn} kicker="Partial" title="Only part of their history came back" />
      ) : null}
      {said ? <Text style={{ ...ty.label, color: said.tone, marginBottom: sp.md }}>{said.text}</Text> : null}

      {rec ? (
        <RecordForm key={`${rec.kind}:${rec.testKey ?? ''}`} rec={rec} series={series} wu={wu}
          onCancel={() => setRec(null)}
          onSave={async (row, notes) => {
            const why = await a.record(row, notes);
            if (!why) { setRec(null); setSaid({ tone: t.good, text: 'Saved. It is on their app now too.' }); }
            return why;
          }} />
      ) : (
        <Section>
          <SectionHead title="Record a Test" />
          {ASSESSMENT_TYPES.map((ty_) => {
            const last = latestOfKind(ty_.kind);
            const l = last ? last.history[last.history.length - 1] : null;
            return (
              <ListRow key={ty_.kind} icon="target" tone="teal" title={ty_.label} note={ty_.note}
                meta={l ? `Last: ${last!.label}, ${totalLabel(l, wu) ?? 'not readable'}, ${fmtDay(l.recordedAt)}` : a.status === 'ready' ? 'Not tested yet' : undefined}
                onPress={() => { setSaid(null); setRec({ kind: ty_.kind }); }} />
            );
          })}
        </Section>
      )}

      {a.status === 'loading' && !series.length ? (
        <Text style={{ ...ty.caption, color: t.ink3 }}>Reading their tests…</Text>
      ) : a.status === 'ready' && !series.length ? (
        <Text style={{ ...ty.caption, color: t.ink3 }}>No tests on record yet. The first one you save becomes the baseline both of you compare against.</Text>
      ) : null}

      {series.map((s) => (
        <AssessmentSeries key={s.key} series={s} wu={wu} onRecord={() => startFor(s)} onDelete={confirmDelete} />
      ))}
    </ScrollView>
  );
}

function RecordForm({ rec, series, wu, onCancel, onSave }: {
  rec: Recording;
  series: Series[];
  wu: WeightUnit;
  onCancel: () => void;
  onSave: (row: RecordRow, notes: string) => Promise<string | null>;
}) {
  const t = useTheme();
  const send = useSubmitOnce('assessments.save');
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [grades, setGrades] = useState<Record<string, Grade | null>>({});
  const [lift, setLift] = useState<string>(rec.testKey ?? STRENGTH_LIFTS[0].key);
  const [load, setLoad] = useState('');
  const [reps, setReps] = useState('');
  const [name, setName] = useState(rec.name ?? '');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(rec.unit ?? '');
  const [direction, setDirection] = useState<Direction>(rec.direction ?? 'higher');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const field = {
    ...ty.body, color: t.ink, backgroundColor: t.surface2,
    borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md,
  };
  const label = ASSESSMENT_TYPES.find((x) => x.kind === rec.kind)!.label;

  // The series this recording will join, for "Last time".
  const key = rec.kind === 'movement' ? 'movement:fms'
    : rec.kind === 'mobility' ? 'mobility:standard'
    : rec.kind === 'strength' ? `strength:${lift}` : `custom:${slug(name)}`;
  const prior = series.find((s) => s.key === key);
  const last = prior ? prior.history[prior.history.length - 1] : null;

  const save = async () => {
    setError(null);
    let built;
    if (rec.kind === 'strength') {
      const l = readLift(load, wu);
      if (!l.ok) { setError(l.reason); return; }
      const rp = readReps(reps);
      if (!rp.ok) { setError(rp.reason); return; }
      built = buildRecord({ kind: 'strength', lift, weightKg: l.kg, reps: rp.reps });
    } else if (rec.kind === 'movement') {
      built = buildRecord({ kind: 'movement', scores });
    } else if (rec.kind === 'mobility') {
      built = buildRecord({ kind: 'mobility', grades });
    } else {
      built = buildRecord({ kind: 'custom', name, value: readNumber(value), unit, direction });
    }
    if (!built.ok) { setError(built.reason); return; }
    const why = await onSave(built.row, notes);
    if (why) setError(why);
  };

  const scoreOpts = Array.from({ length: MOVEMENT_SCORE_MAX + 1 }, (_, i) => ({ key: String(i), label: String(i) }));
  const gradeOpts = [
    { key: 'pass' as const, label: 'Pass' }, { key: 'partial' as const, label: 'Partial' }, { key: 'fail' as const, label: 'Fail' },
  ];

  return (
    <Section>
      <SectionHead title={`Record ${label}`} />
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
        {last ? `Last time: ${prior!.label}, ${totalLabel(last, wu) ?? 'not readable'} on ${fmtDay(last.recordedAt)}` : 'No earlier result for this test. This one becomes the baseline.'}
      </Text>

      {rec.kind === 'movement' ? MOVEMENT_PATTERNS.map((p) => (
        <Field key={p.key} label={p.label} style={{ marginBottom: sp.md }}>
          <Segmented options={scoreOpts} value={scores[p.key] == null ? null : String(scores[p.key])}
            onChange={(k) => setScores((s) => ({ ...s, [p.key]: Number(k) }))} />
        </Field>
      )) : null}

      {rec.kind === 'mobility' ? MOBILITY_CHECKS.map((c) => (
        <Field key={c.key} label={c.label} style={{ marginBottom: sp.md }}>
          <Segmented options={gradeOpts} value={grades[c.key] ?? null}
            onChange={(k) => setGrades((g) => ({ ...g, [c.key]: k }))} />
        </Field>
      )) : null}

      {rec.kind === 'strength' ? (
        <>
          <Field label="Lift" style={{ marginBottom: sp.md }}>
            <Segmented options={STRENGTH_LIFTS.map((l) => ({ key: l.key, label: l.label }))} value={lift} onChange={setLift} scroll />
          </Field>
          <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
            <Field label="Load" hint={wu}>
              <TextInput value={load} onChangeText={setLoad} keyboardType="decimal-pad" placeholder={wu} placeholderTextColor={t.ink3}
                accessibilityLabel={wu === 'kg' ? 'Load in kilograms' : 'Load in pounds'} style={{ ...field, ...numeric }} />
            </Field>
            <Field label="Reps">
              <TextInput value={reps} onChangeText={setReps} keyboardType="number-pad" placeholder="5" placeholderTextColor={t.ink3}
                accessibilityLabel="Reps completed" style={{ ...field, ...numeric }} />
            </Field>
          </View>
        </>
      ) : null}

      {rec.kind === 'custom' ? (
        <>
          <Field label="Test Name" style={{ marginBottom: sp.md }}>
            <TextInput value={name} onChangeText={setName} placeholder="2 km Row" placeholderTextColor={t.ink3}
              accessibilityLabel="Test name" style={field} maxLength={60} />
          </Field>
          <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
            <Field label="Result">
              <TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.ink3}
                accessibilityLabel="Result" style={{ ...field, ...numeric }} />
            </Field>
            <Field label="Unit">
              <TextInput value={unit} onChangeText={setUnit} placeholder="min, cm, reps" placeholderTextColor={t.ink3}
                accessibilityLabel="Unit" style={field} maxLength={20} />
            </Field>
          </View>
          <Field label="Better Is" style={{ marginBottom: sp.md }}>
            <Segmented options={[{ key: 'higher' as const, label: 'Higher' }, { key: 'lower' as const, label: 'Lower' }]}
              value={direction} onChange={setDirection} />
          </Field>
        </>
      ) : null}

      <Field label="Notes" hint="Optional, and the client sees them" style={{ marginBottom: sp.md }}>
        <TextInput value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="What you saw" placeholderTextColor={t.ink3}
          accessibilityLabel="Notes" style={{ ...field, minHeight: 72, textAlignVertical: 'top' }} />
      </Field>

      {error ? <Flag tone={t.crit} style={{ marginBottom: sp.md }}>{error}</Flag> : null}
      <Cta wide label={send.busy ? 'Saving…' : 'Save Test'} disabled={send.busy} onPress={() => send.run(save)} />
      <View style={{ marginTop: sp.sm }}>
        <Ghost label="Cancel" onPress={onCancel} />
      </View>
    </Section>
  );
}
