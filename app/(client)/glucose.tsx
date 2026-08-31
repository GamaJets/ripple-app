// Client · Blood sugar. Readings a CGM wrote into Apple Health, shown against
// the meals they surround, plus the one switch that decides whether the coach
// sees any of it.
//
// WHAT THIS SCREEN WILL NOT DO. It does not tell anybody what to eat. Not a
// suggestion, not a score, not a red badge that means "you did badly". Somebody
// wearing a CGM is usually wearing it because of a diagnosis, and software that
// turns their readings into dietary instructions is a regulated medical device
// rather than a fitness feature. The bands are labelled as the commonly quoted
// range and said to be nobody's personal target; the reader and their coach
// draw the conclusions.
//
// The other rule is the house one, and it bites unusually hard here: an empty
// list means "no readings" ONLY under 'ready'. Under 'error' it means the read
// did not answer, and rendering the two the same way would tell somebody
// wearing a sensor that it recorded nothing — which is the one thing on this
// screen they would actually act on.
import { useState } from 'react';
import { View, Text, ScrollView, Modal, TextInput, Switch, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { useGlucose } from '../../src/ui/glucoseData';
import { deltaLabel } from '../../src/lib/deltaLabel';
import {
  band, formatGlucose, parseTyped, TYPICAL_LOW_MMOL, TYPICAL_HIGH_MMOL,
  type GlucoseUnit, type GlucoseBand,
} from '../../src/lib/glucose';

const UNITS: GlucoseUnit[] = ['mmol/L', 'mg/dL'];

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Glucose() {
  const t = useTheme();
  const router = useRouter();
  const g = useGlucose();
  const [unit, setUnit] = useState<GlucoseUnit>('mmol/L');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // A band is a position on a scale, not a verdict, so the colours stay the
  // theme's neutral accents rather than a green/amber/red that reads as marking.
  const bandColor = (b: GlucoseBand) => (b === 'unknown' ? t.ink3 : b === 'typical' ? t.ink : t.s3);
  const bandWord = (b: GlucoseBand) =>
    b === 'below' ? 'below the quoted range' : b === 'above' ? 'above the quoted range' : b === 'typical' ? 'within the quoted range' : '';

  const known = g.status === 'ready';
  const unreadable = g.status === 'error';

  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    const r = await g.importFromHealth();
    setBusy(false);
    if (r.reason) Alert.alert('Nothing imported', r.reason);
    else if (r.added === 0) Alert.alert('Up to date', 'Health has nothing newer than what is already here.');
    else Alert.alert('Imported', `${r.added} reading${r.added === 1 ? '' : 's'} added.`);
  };

  const saveTyped = async () => {
    const mmol = parseTyped(typed, unit);
    if (mmol == null) {
      // Refused rather than rounded — a mg/dL number typed under mmol/L would
      // otherwise land four times too high and sit on every chart forever.
      Alert.alert('That is not a reading', `Enter a value in ${unit}.`);
      return;
    }
    setBusy(true);
    const ok = await g.addManual(mmol);
    setBusy(false);
    if (!ok) { Alert.alert('Not saved', 'That reading could not be saved. Try again in a moment.'); return; }
    setTyped(''); setTyping(false);
  };

  const toggleShare = async (on: boolean) => {
    const ok = await g.setShared(on);
    if (!ok) Alert.alert('Not saved', 'That could not be changed. Try again in a moment.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Blood Sugar</Text>
          </View>
        </View>

        <Notice tone={t.s3} kicker="Not medical advice" title="Readings, not recommendations"
          note={`Repple shows what your monitor recorded. It does not tell you what to eat, and the range shown (${TYPICAL_LOW_MMOL}–${TYPICAL_HIGH_MMOL} mmol/L) is the one commonly quoted for adults, not a target set for you. Your targets come from your clinician.`} />

        {/* ── The window's headline figures ─────────────────────────────── */}
        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Last 14 Days"
            note={unreadable ? 'Could not be read' : known ? undefined : g.status === 'partial' ? 'More readings than shown' : undefined} />
          {unreadable ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Your readings could not be read just now. This is not the same as having none — nothing below is confirmed.
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
            {[
              { label: 'Latest', v: known && g.summary.latest ? formatGlucose(g.summary.latest.mmol, unit) : null },
              { label: 'Average', v: known ? formatGlucose(g.summary.averageMmol, unit) : null },
              { label: 'Highest', v: known ? formatGlucose(g.summary.highestMmol, unit) : null },
              { label: 'In range', v: known && g.summary.inTypicalPct != null ? `${g.summary.inTypicalPct}%` : null },
            ].map((k) => (
              <View key={k.label} style={{ flex: 1 }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>{k.label}</Text>
                <Text style={{ ...ty.head, color: t.ink, marginTop: 2 }}>{fig(k.v)}</Text>
              </View>
            ))}
          </View>
          {/* The percentage is withheld below a floor rather than computed from
              a handful of readings — "100% in range" off two samples is a
              sentence somebody would act on, and it means nothing. */}
          {known && g.summary.count > 0 && g.summary.inTypicalPct == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Too few readings to give a share in range.
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            {UNITS.map((u) => (
              <Ghost key={u} label={u === unit ? `${u} ✓` : u} onPress={() => setUnit(u)} />
            ))}
          </View>
        </Section>

        {/* ── Getting readings in ───────────────────────────────────────── */}
        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Where These Come From" />
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            {Platform.OS === 'ios'
              ? 'A Dexcom, or a Libre through its own app, writes into Apple Health. Repple reads from there — so any monitor that reaches Health reaches Repple.'
              : 'On Android, monitors write into Health Connect. Reading from it needs a build that includes it, which this one does not yet — you can still type readings in below.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
            {Platform.OS === 'ios' ? <Cta label={busy ? 'Reading…' : 'Import from Health'} onPress={doImport} disabled={busy} /> : null}
            <Ghost label="Add One By Hand" onPress={() => setTyping(true)} />
          </View>
        </Section>

        {/* ── Consent ───────────────────────────────────────────────────── */}
        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Your Coach" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, color: t.ink }}>Let my coach see these</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
                Off by default. Turning it off again hides the history as well as the next reading.
              </Text>
            </View>
            <Switch
              value={g.sharedWithCoach === true}
              onValueChange={toggleShare}
              // Null means the flag could not be read. Disabling rather than
              // showing "off" stops somebody turning ON what may already be on,
              // and stops the switch asserting a state nobody has confirmed.
              disabled={g.sharedWithCoach === null}
            />
          </View>
          {g.sharedWithCoach === null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Whether this is on could not be read just now.
            </Text>
          ) : null}
        </Section>

        {/* ── Meals, with whatever the sensor said around them ───────────── */}
        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Around Your Meals" />
          {g.pairedStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Could not be read just now.</Text>
          ) : g.paired.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {g.pairedStatus === 'ready' ? 'No meals logged in the last 14 days.' : 'Still loading.'}
            </Text>
          ) : (
            [...g.paired].reverse().map((p, i) => (
              <View key={p.meal.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{p.meal.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{when(p.meal.loggedAt)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.sm }}>
                  <View>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Before</Text>
                    <Text style={{ ...ty.body, color: t.ink }}>{fig(p.before ? formatGlucose(p.before.mmol, unit) : null)}</Text>
                  </View>
                  <View>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Peak after</Text>
                    <Text style={{ ...ty.body, color: bandColor(band(p.peak?.mmol)) }}>{fig(p.peak ? formatGlucose(p.peak.mmol, unit) : null)}</Text>
                  </View>
                  <View>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Change</Text>
                    {/* Null unless BOTH ends are real readings. A peak with no
                        baseline is a number, not a rise. */}
                    <Text style={{ ...ty.body, color: t.ink }}>
                      {/* Signed from the figure that is actually printed. In
                          mg/dL the rise is rounded to whole units, so a real
                          0.02 mmol/L rise became "+0" — a sign attached to
                          nothing, on the number a member reads a meal by. */}
                      {deltaLabel(unit === 'mg/dL' && p.rise != null ? Math.round(p.rise * 18.0182) : p.rise,
                        { since: null, decimals: unit === 'mg/dL' ? 0 : 1, noChange: 'No change', noBaseline: '—' })}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </Section>

        {/* ── Every reading ─────────────────────────────────────────────── */}
        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Readings" note={known ? `${g.summary.count}` : undefined} />
          {unreadable ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Could not be read just now.</Text>
          ) : g.readings.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {known ? 'Nothing recorded in the last 14 days.' : 'Still loading.'}
            </Text>
          ) : (
            g.readings.slice(0, 60).map((r, i) => (
              <View key={`${r.at}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.sm, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <Text style={{ ...ty.body, color: bandColor(band(r.mmol)), width: 64 }}>{formatGlucose(r.mmol, unit)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{when(r.at)}</Text>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>{bandWord(band(r.mmol))}{r.sourceName ? ` · ${r.sourceName}` : ''}</Text>
                </View>
              </View>
            ))
          )}
          {/* Gated with everything else on this screen, which it was not: it
              sat outside the unreadable/known ternary above, so under 'error'
              it printed a count of stale rows directly beneath "Could not be
              read just now", and under 'partial' it printed the row cap as a
              total. `known` is `status === 'ready'`. */}
          {known && g.readings.length > 60 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Showing the most recent 60 of {g.readings.length}.</Text>
          ) : null}
        </Section>
      </ScrollView>

      <Modal visible={typing} animationType="slide" transparent onRequestClose={() => setTyping(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.surface, padding: layout.gutter, paddingBottom: 40 }}>
            <Text style={{ ...ty.head, color: t.ink }}>Add a Reading</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>In {unit}, as your meter shows it.</Text>
            <TextInput
              value={typed} onChangeText={setTyped} keyboardType="decimal-pad" autoFocus
              placeholder={unit === 'mg/dL' ? '99' : '5.5'} placeholderTextColor={t.ink3}
              style={{ ...ty.head, color: t.ink, borderBottomWidth: hairline, borderBottomColor: t.ring, paddingVertical: sp.md, marginTop: sp.md }}
            />
            <Rule inset={0} />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
              <Cta label={busy ? 'Saving…' : 'Save'} onPress={saveTyped} disabled={busy} />
              <Ghost label="Cancel" onPress={() => { setTyped(''); setTyping(false); }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
