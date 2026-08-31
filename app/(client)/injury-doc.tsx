// Client · Read an injury off a document.
//
// A physio report, a scan result or a doctor's note goes in; PROPOSALS come
// out. The client reads each one, changes what is wrong with it, and confirms
// the ones they mean. Only then is anything written, and what is written is an
// ordinary entry in the same `clients.injuries` array the manual screen has
// always used — so the plan, the Train tab's swaps, the coach's roster and the
// acknowledgement gate pick it up with nothing else to change.
//
// ── WHY IT PROPOSES AND NEVER APPLIES ─────────────────────────────────────
//
// OCR misreads. The extractor guesses. And this is a person's own body: a
// disclosure they did not make, sitting in their profile under their name,
// changing what their coach is shown and which exercises their plan hides, is
// not a convenience — it is the app putting words in their mouth about a
// medical matter. So every candidate below is a question with three answers,
// one of which is "no", and none of them happens on its own.
//
// The extractor's argument for the same rule, and what it does when it cannot
// tell, is in src/lib/injuryExtract.ts.
//
// ── WHY THE COACH IS TOLD ABOUT THE INJURY AND NOT THE FILE ───────────────
//
// The document goes into a private bucket only its owner can read
// (supabase/parts/91-injury-documents.sql). "Left knee, moderate" is a
// training instruction. The report it was read off carries a diagnosis, a
// clinician, a hospital number and findings about things that have nothing to
// do with training, and nobody consented to that by disclosing an injury. The
// screen says so out loud, because a promise the user cannot see is not one.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Card, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { INJURY_AREAS, areaLabel, newInjuryId, type InjurySeverity } from '../../src/lib/injuries';
import {
  candidateNote, candidateToInjury, outcomeMessage,
  type Extraction, type InjuryCandidate,
} from '../../src/lib/injuryExtract';
import {
  readInjuryDocument, listInjuryDocs, deleteInjuryDoc,
  type InjuryDocFile, type InjuryDocRead,
} from '../../src/ui/injuryDocs';
import type { LoadStatus } from '../../src/ui/loadStatus';

const SEVS: { id: InjurySeverity; label: string }[] = [
  { id: 'mild', label: 'Mild' }, { id: 'moderate', label: 'Moderate' }, { id: 'severe', label: 'Severe' },
];

/** What the client has done with one proposal. 'open' is the only state in
 *  which anything is still being asked of them. */
type Verdict = 'open' | 'added' | 'rejected';

/** The client's edits to a proposal. `severity: null` is carried through from
 *  the extractor and means the DOCUMENT did not grade it — it is never
 *  defaulted to something plausible, and Add stays disabled until a person
 *  picks one. */
interface Draft { area: string; severity: InjurySeverity | null; note: string; verdict: Verdict }

const dayLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
};

export default function InjuryDoc() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();

  const [busy, setBusy] = useState<null | 'preparing' | 'reading'>(null);
  const [result, setResult] = useState<InjuryDocRead | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [docs, setDocs] = useState<InjuryDocFile[]>([]);
  const [docsStatus, setDocsStatus] = useState<LoadStatus>('loading');

  const refreshDocs = useCallback(async () => {
    const r = await listInjuryDocs();
    setDocs(r.docs);
    setDocsStatus(r.status);
  }, []);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm,
    backgroundColor: on ? t.brand : t.surface2,
  });
  const chipText = (on: boolean) => ({
    ...ty.label, fontWeight: (on ? '600' : '500') as '600' | '500', color: on ? t.brandInk : t.ink2,
  });

  // Shared by all three ways in, so a PDF chosen from Files and a photo taken
  // of the same page land in exactly the same state machine.
  const readFrom = async (file: { uri: string; name?: string | null; mimeType?: string | null }) => {
    setBusy('preparing');
    setResult(null);
    setDrafts({});
    setBusy('reading');
    const r = await readInjuryDocument(file);
    setBusy(null);
    setResult(r);
    const seeded: Record<string, Draft> = {};
    for (const cand of r.extraction?.candidates ?? []) {
      seeded[cand.key] = { area: cand.area, severity: cand.severity, note: candidateNote(cand), verdict: 'open' };
    }
    setDrafts(seeded);
    if (r.stored === 'ready') refreshDocs();
  };

  // A report is usually emailed as a PDF rather than photographed, so Files is
  // a first-class way in rather than a fallback. The reader takes both.
  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await readFrom({ uri: a.uri, name: a.name, mimeType: a.mimeType });
  };

  const pick = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'read an injury off a document'))) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
    if (res.canceled || !res.assets?.[0]) return;

    await readFrom({ uri: res.assets[0].uri, name: res.assets[0].fileName, mimeType: res.assets[0].mimeType });
  };

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const confirm = (cand: InjuryCandidate) => {
    const d = drafts[cand.key];
    // Guarded rather than defaulted. The button is disabled without a severity
    // for exactly this reason, and this is the second lock on the same door.
    if (!d || d.severity == null) return;
    c.addInjury(candidateToInjury(cand, {
      id: newInjuryId(),
      area: d.area,
      severity: d.severity,
      note: d.note,
      at: new Date().toISOString(),
    }));
    setDraft(cand.key, { verdict: 'added' });
  };

  const removeDoc = (doc: InjuryDocFile) => {
    Alert.alert(
      'Delete this document?',
      'The file is removed from your account. Any injuries you already confirmed from it stay — they are yours now, not the document\'s.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            const gone = await deleteInjuryDoc(doc.path);
            // Only the delete's own answer decides what we say happened.
            if (!gone) { Alert.alert('It is still there', 'That document could not be deleted just now, so it has not been. Try again in a moment.'); return; }
            refreshDocs();
          },
        },
      ],
    );
  };

  const extraction: Extraction | null = result?.read === 'ready' ? result.extraction : null;
  const msg = extraction ? outcomeMessage(extraction.outcome) : null;
  const openCount = Object.values(drafts).filter((d) => d.verdict === 'open').length;
  const addedCount = Object.values(drafts).filter((d) => d.verdict === 'added').length;

  /* ── one proposal ────────────────────────────────────────────────────── */
  const Proposal = ({ cand }: { cand: InjuryCandidate }) => {
    const d = drafts[cand.key];
    if (!d) return null;

    if (d.verdict !== 'open') {
      return (
        <View style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring, flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <Icon name={d.verdict === 'added' ? 'check' : 'minus'} size={16} color={t.ink3} />
          <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>
            {areaLabel(d.area)} — {d.verdict === 'added' ? 'added to your injuries' : 'not added'}
          </Text>
          {d.verdict === 'rejected'
            ? <Ghost label="Undo" onPress={() => setDraft(cand.key, { verdict: 'open' })} />
            : null}
        </View>
      );
    }

    return (
      <Card style={{ marginTop: sp.md }}>
        {/* What we matched on and the line it came from. The client is being
            asked to agree with a reading of their own document, so they get to
            see the reading. */}
        <Text style={{ ...ty.micro, color: t.ink3 }}>Found “{cand.matched}”</Text>
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm, fontStyle: 'italic' }}>“{cand.evidence}”</Text>

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Area</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {INJURY_AREAS.map((a) => {
            const on = d.area === a.id;
            return (
              <Pressable key={a.id} onPress={() => setDraft(cand.key, { area: a.id })} style={chip(on)}>
                <Text style={chipText(on)}>{a.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Severity</Text>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          {SEVS.map((sv) => {
            const on = d.severity === sv.id;
            return (
              <Pressable key={sv.id} onPress={() => setDraft(cand.key, { severity: sv.id })}
                style={{ ...chip(on), flex: 1, alignItems: 'center', paddingHorizontal: 0 }}>
                <Text style={chipText(on)}>{sv.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {/* An ungraded document is shown as ungraded. Pre-selecting "moderate"
            here would put a severity in their profile that nothing and nobody
            ever said, and it would look exactly like one they chose. */}
        {d.severity == null ? (
          <Flag tone={t.s3} style={{ marginTop: sp.md }}>
            Your document did not say how bad this is, so nothing is picked. Choose the one that matches how it feels.
          </Flag>
        ) : null}

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Note</Text>
        <TextInput value={d.note} onChangeText={(v) => setDraft(cand.key, { note: v })}
          placeholder="In your own words" placeholderTextColor={t.ink3} multiline
          style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64, textAlignVertical: 'top' }} />

        {cand.movements.length ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Your plan will watch: {cand.movements.slice(0, 5).join(', ')}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, alignItems: 'center' }}>
          <Cta label="Add This" onPress={() => confirm(cand)} disabled={d.severity == null} />
          <Ghost label="Not This" onPress={() => setDraft(cand.key, { verdict: 'rejected' })} />
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Injuries</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Read a Document</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>
          Photograph a physio report, a scan result or a doctor's note. We suggest what to disclose; you decide what goes in.
        </Text>

        <Notice tone={t.s3} kicker="Guidance only" title="Not medical advice"
          note="Nothing here reads, checks or corrects a diagnosis. For pain, a new injury, or a diagnosis, see a doctor or physio before training." />

        <Notice tone={t.brand} kicker="Private" title="Your coach never sees the file"
          note="The document stays in your account and only you can open it. What your coach sees is the injury you confirm below — the area, how bad it is and your note — the same as if you had typed it in yourself." />

        {busy ? (
          <Card style={{ marginTop: sp.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <ActivityIndicator color={t.brand} />
              <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>
                {busy === 'preparing' ? 'Preparing your document…' : 'Saving it privately, then reading it…'}
              </Text>
            </View>
          </Card>
        ) : (
          <View style={{ marginTop: sp.md, gap: sp.sm }}>
            <Cta label="Take a Photo" onPress={() => pick(true)} wide />
            {/* Files sits beside the camera rather than under it, because a
                report is more often something a clinic emailed than something
                on the page in front of you. The reader takes a PDF whole and
                reads every page of it, not just the first. */}
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <View style={{ flex: 1 }}><Ghost label="Choose a File" onPress={pickFile} /></View>
              <View style={{ flex: 1 }}><Ghost label="Choose an Image" onPress={() => pick(false)} /></View>
            </View>
          </View>
        )}

        {/* ── what came back ──────────────────────────────────────────────
            Three outcomes, three different sentences. An empty list under a
            failed read would say "your report mentions no injuries", which is
            the one thing a failure must never be allowed to claim. */}
        {result && result.read === 'error' ? (
          <View>
            <Rule />
            <Section>
              <Notice tone={t.warn} kicker={result.stored === 'ready' ? 'Saved, not read' : 'Nothing saved'}
                title="We could not read that"
                note={result.error ?? 'Something went wrong reading that document.'}>
                <View style={{ marginTop: sp.md, flexDirection: 'row', gap: sp.sm }}>
                  <Ghost label="Try Another Photo" onPress={() => pick(true)} />
                  <Ghost label="Add It Myself" onPress={() => router.replace('/(client)/injuries')} />
                </View>
              </Notice>
            </Section>
          </View>
        ) : null}

        {extraction && msg ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title={extraction.outcome === 'candidates' ? 'Suggested' : 'Result'}
                note={extraction.outcome === 'candidates' ? String(extraction.candidates.length) : undefined} />
              <Text style={{ ...ty.head, color: t.ink }}>{msg.title}</Text>
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{msg.note}</Text>

              {extraction.outcome === 'candidates'
                ? extraction.candidates.map((cand) => <Proposal key={cand.key} cand={cand} />)
                : (
                  // Not an empty list. An empty list on this screen reads as
                  // "you have no injuries", and the app has no idea whether
                  // that is true — it only knows it could not find one here.
                  <View style={{ marginTop: sp.lg, flexDirection: 'row', gap: sp.sm }}>
                    <Cta label="Add It Myself" onPress={() => router.replace('/(client)/injuries')} />
                    <Ghost label="Try a File Instead" onPress={pickFile} />
                    <Ghost label="Try Another Photo" onPress={() => pick(true)} />
                  </View>
                )}

              {addedCount > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  {/* Said plainly, and only about the list — the profile push
                      is a separate thing and gets its own sentence below. */}
                  <Text style={{ ...ty.label, color: t.ink2 }}>
                    {addedCount === 1 ? '1 injury added.' : `${addedCount} injuries added.`}
                    {openCount > 0 ? ` ${openCount} still waiting on you.` : ''}
                  </Text>
                  {c.saveFailed ? (
                    <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
                      Your last profile change has not reached the server yet, so your coach may not see this one. It will retry — check the list before you rely on it.
                    </Flag>
                  ) : null}
                  <View style={{ marginTop: sp.md }}>
                    <Cta label="See My Injuries" onPress={() => router.replace('/(client)/injuries')} wide />
                  </View>
                </View>
              ) : null}
            </Section>
          </View>
        ) : null}

        {/* ── the documents themselves ────────────────────────────────────
            Shown because they are being kept. A medical document stored out of
            sight is the kind of thing people are right to object to, so it is
            listed, openable and deletable by the only person who can read it. */}
        <Rule />
        <Section>
          <SectionHead title="Your Documents"
            note={docsStatus === 'ready' ? String(docs.length) : undefined} />
          {docsStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Checking…</Text>
          ) : docsStatus === 'error' ? (
            <Flag tone={t.warn}>
              We could not check what you have stored, so this is not a list of nothing — it is a list we could not read. Pull back in a moment.
            </Flag>
          ) : docs.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Nothing stored yet. Anything you add here stays private to you.</Text>
          ) : docs.map((doc, idx) => (
            <View key={doc.path} style={{ paddingVertical: sp.md, borderTopWidth: idx === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{doc.name}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {dayLabel(doc.createdAt) ?? 'Date unknown'}
                {doc.url === null ? ' · cannot be opened right now' : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                {doc.url ? (
                  <Ghost label="Open" onPress={() => { Linking.openURL(doc.url!).catch(() => Alert.alert('Could not open it', 'Your device would not open that document.')); }} />
                ) : null}
                <Ghost label="Delete" onPress={() => removeDoc(doc)} />
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
