// Client · Blood sugar. Readings a CGM wrote into the phone's health store —
// Apple Health on iOS, Health Connect on Android — shown against the meals
// they surround, plus the one switch that decides whether the coach sees any
// of it.
//
// There is no `Platform.OS` on this screen. `glucoseSource()` picks the store
// once and hands back the sentences and the reader for it, so the Android half
// of this feature cannot drift into being a different screen from the iOS
// half. It nearly was: while Android had no reader, the copy, the hook and the
// provider row each apologised for it in their own wording, and two of the
// three went on apologising after the third was fixed.
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
//
// The same rule governs the import, which has four outcomes and four different
// sentences. A store this build cannot read is a fact about the app and is
// permanent until a new version; a decline is the person's own decision and
// the fix is in the system's settings, not here; a failed read is worth trying
// again in a minute; and an empty window is a real answer. `importNote` below
// is the one place that maps them, so no two of them can end up sharing a
// wording.
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
  type GlucoseUnit, type GlucoseBand, type GlucoseReadStatus,
} from '../../src/lib/glucose';
import { glucoseSource } from '../../src/lib/wearables/glucoseSource';

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

  // The store this phone reads from, and every sentence that names it. Called
  // on render because it is a handful of property lookups and no native call.
  const src = glucoseSource();

  // What the last import found, kept on screen rather than living and dying
  // inside an alert. Somebody who declined Health Connect and then dismissed
  // the alert would otherwise be looking at an empty list with no explanation
  // and a button offering to fetch readings that cannot arrive.
  const [importNote, setImportNote] = useState<{ status: GlucoseReadStatus; text: string } | null>(null);

  /** The alert's title. Four outcomes, four titles, never one shared word. */
  const importTitle = (status: GlucoseReadStatus, added: number): string => {
    if (status === 'unsupported') return 'Nothing to read from';
    if (status === 'denied') return 'Repple has not been given access';
    if (status === 'error') return 'Could not be read';
    return added > 0 ? 'Imported' : 'Up to date';
  };

  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    const r = await g.importFromHealth();
    setBusy(false);

    const text = r.reason
      ?? (r.added === 0
        ? `${src.storeName} has nothing newer than what is already here.`
        : `${r.added} reading${r.added === 1 ? '' : 's'} added.`);
    // Only the outcomes worth still reading about in a minute are kept. A
    // successful import is evident from the list itself, and a note saying so
    // would still be sitting there tomorrow.
    setImportNote(r.status === 'ready' && r.added > 0 ? null : { status: r.status, text });

    // A decline is the one outcome Repple cannot do anything about from here:
    // once Health Connect has been answered, only Health Connect can change
    // it. So that alert offers the way there instead of an OK that does
    // nothing. `openStore` is null on iOS, where there is nowhere to send them.
    if (r.status === 'denied' && src.openStore) {
      Alert.alert(importTitle(r.status, r.added), text, [
        { text: 'Not now', style: 'cancel' },
        { text: `Open ${src.storeName}`, onPress: src.openStore },
      ]);
      return;
    }
    Alert.alert(importTitle(r.status, r.added), text);
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
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{src.whereFrom}</Text>
          {/* The build cannot read this phone's store at all, which is neither
              a failure nor the person's doing. Said here, once, rather than
              behind a button — the reconnect loop on Watch & devices was built
              out of exactly that button, offered to somebody it could only ever
              produce an apology for. */}
          {src.absentReason ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{src.absentReason}</Text>
          ) : null}
          {/* What the last import found, for the three outcomes that are not
              simply "it worked". Each carries its own sentence from the reader
              that produced it. */}
          {importNote ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{importNote.text}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
            {src.present ? <Cta label={busy ? 'Reading…' : `Import from ${src.storeName}`} onPress={doImport} disabled={busy} /> : null}
            {/* Offered only where there is somewhere to go, and only once the
                person has actually been refused — before that it is a route
                into a settings screen about a question nobody has been asked. */}
            {src.openStore && importNote?.status === 'denied' ? (
              <Ghost label={`Open ${src.storeName}`} onPress={src.openStore} />
            ) : null}
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
              {/* 'partial' is a read that FINISHED, so telling the member it
                  is still loading is a screen misreporting its own state. */}
              {g.pairedStatus === 'ready' ? 'No meals logged in the last 14 days.'
                : g.pairedStatus === 'loading' ? 'Still loading.'
                : 'More on record than we can read at once, so we can’t say what is around your meals.'}
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
              {known ? 'Nothing recorded in the last 14 days.'
                : g.status === 'loading' ? 'Still loading.'
                : 'More on record than we can read at once, so this is not a statement that nothing was recorded.'}
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
