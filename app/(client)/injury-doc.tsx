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
// No `Linking`. It used to be here, for the Open button, and handing a signed
// URL to a medical document to whatever app owns http on this device is the
// defect src/lib/injuryDocView.ts was written to close. `Image` and `Modal` are
// what replaced it for a photographed report; a PDF goes through
// `openInAppBrowser`. React Native's own <Image> rather than expo-image's:
// this is a still photograph, there is nothing to animate, and RN's is in every
// binary ever built so no guard is needed and no install can be without it.
import { View, Text, Image, Modal, Pressable, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Card, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { fmtFullDay } from '../../src/lib/format';
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
// Not `import * as DocumentPicker from 'expo-document-picker'`. That package's
// entry point is a bare requireNativeModule call at module scope, so on an
// install made before the dependency landed the import threw and this screen
// would not render at all — camera route included, which does not need the
// picker. See src/ui/nativeModules.ts.
import {
  HAS_NATIVE_DOCUMENT_PICKER, DOCUMENT_PICKER_UNAVAILABLE_NOTE, pickDocument,
  openInAppBrowser, IN_APP_BROWSER_UNAVAILABLE_NOTE,
} from '../../src/ui/nativeModules';
import { injuryDocKind, injuryDocRoute, OPENS_IN_APP_NOTE } from '../../src/lib/injuryDocView';

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

// Twelve English month names written out by hand, on a screen a member in
// Berlin reads. `fmtFullDay` is the app's own resolver (src/lib/locale.ts) and
// carries the same null-for-unparseable guard this had.
const dayLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return fmtFullDay(new Date(ms).toISOString());
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
  // The document currently being read, full-screen, inside this app. Null is
  // the ordinary state; there is no route out of this screen to a browser.
  const [viewing, setViewing] = useState<InjuryDocFile | null>(null);

  const refreshDocs = useCallback(async () => {
    const r = await listInjuryDocs();
    setDocs(r.docs);
    setDocsStatus(r.status);
  }, []);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);
  // A failed read used to strand this screen for the whole session — the only
  // way to ask again was to leave and come back. Pull to refresh is the gesture
  // people already try; see src/ui/pullToRefresh.tsx.
  const pull = usePullToRefresh(useCallback(() => { void refreshDocs(); }, [refreshDocs]));

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
    const res = await pickDocument({ type: ['application/pdf', 'image/jpeg', 'image/png'] });
    // The button is not offered on a build with no picker, so this branch is
    // the second lock on that door — and it says which of the two silences it
    // is rather than leaving the screen looking as though the tap missed.
    if (res.outcome === 'unavailable') {
      Alert.alert('This version cannot open your files', `${DOCUMENT_PICKER_UNAVAILABLE_NOTE} A photo of the page works in the meantime and is read the same way.`);
      return;
    }
    if (res.outcome === 'error') {
      Alert.alert('That file could not be opened', 'Nothing was read and nothing was saved. Try it again, or photograph the page instead.');
      return;
    }
    if (res.outcome === 'cancelled') return;
    const a = res.file;
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

  /**
   * Open a stored document, and never outside this app.
   *
   * The route is decided by src/lib/injuryDocView.ts rather than here, so the
   * rule is assertable without a device — see injuryDocView.test.ts. A
   * photographed report is drawn by this screen and the signed URL reaches
   * nothing but the image decoder; anything else goes to the browser sheet this
   * app presents over itself, which is dismissed back into it.
   *
   * The old branch was `Linking.openURL(doc.url)`, which handed the URL to
   * Safari or Chrome. That URL stays live for an hour, so it sat in another
   * app's history — and, with iCloud tabs or a signed-in Chrome, on every other
   * device on the account — for that hour. A private bucket with own-folder
   * policies behind an Open button that does that is not a private bucket.
   */
  const openDoc = async (doc: InjuryDocFile) => {
    if (!doc.url) return;
    if (injuryDocRoute(injuryDocKind(doc.name)) === 'in-app-viewer') {
      setViewing(doc);
      return;
    }
    const opened = await openInAppBrowser(doc.url);
    // Only the open's own answer decides what we say happened, and the two
    // silences are different sentences: a build with no in-app browser cannot
    // be fixed by tapping again, and must not fall through to the system one.
    if (!opened) {
      Alert.alert('Could not open it privately', IN_APP_BROWSER_UNAVAILABLE_NOTE);
    }
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

        {/* Empty, and deliberately. `candidateNote` used to seed this with the
            line quoted above, so one tap on "Add This" sent the report's own
            sentence to the coach as though the member had written it — under a
            notice at the top of this screen promising the opposite. The
            evidence is still on the card, four rows up; putting any of it here
            is now something the member does. */}
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Note</Text>
        <TextInput value={d.note} onChangeText={(v) => setDraft(cand.key, { note: v })}
          placeholder="In your own words" placeholderTextColor={t.ink3} multiline
          style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64, textAlignVertical: 'top' }} />
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
          Your coach reads this note. Nothing else off the document reaches them, so it starts empty.
        </Text>

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
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>
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

        {/* The second sentence is new and it is not decoration. The screen has
            always promised the file is private, and the Open button used to
            break that promise by handing the document to the phone's web
            browser. It now opens in the app, so the promise and the button
            agree — and the member is told which, because a privacy property
            nobody can see is one they have no reason to believe. */}
        <Notice tone={t.brand} kicker="Private" title="Your coach never sees the file"
          note={`The document stays in your account and only you can open it. ${OPENS_IN_APP_NOTE} What your coach sees is the injury you confirm below — the area, how bad it is and your note — the same as if you had typed it in yourself.`} />

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
              {/* Files is dropped rather than offered dead on a build that has
                  no picker. Every other way in still works, so the screen loses
                  one route and none of its purpose — and the sentence below
                  says which route and why, so nobody reads it as the app
                  forgetting a feature it used to have. */}
              {HAS_NATIVE_DOCUMENT_PICKER ? (
                <View style={{ flex: 1 }}><Ghost label="Choose a File" onPress={pickFile} /></View>
              ) : null}
              <View style={{ flex: 1 }}><Ghost label="Choose an Image" onPress={() => pick(false)} /></View>
            </View>
            {!HAS_NATIVE_DOCUMENT_PICKER ? (
              <Flag tone={t.warn}>{DOCUMENT_PICKER_UNAVAILABLE_NOTE} A photo of the page is read the same way.</Flag>
            ) : null}
          </View>
        )}

        {/* ── what came back ──────────────────────────────────────────────
            Four outcomes, four different sentences. An empty list under a
            failed read would say "your report mentions no injuries", which is
            the one thing a failure must never be allowed to claim.

            The fourth is 'unsupported-script': a report in Greek, Cyrillic,
            Hebrew or CJK that OCR read perfectly. It used to score zero
            "readable letters" — the counter looked for `[a-z]` and called it
            letters — and be reported as a photograph we could not make out, so
            the member was told to re-photograph a page that had been read fine.
            The sentence comes from `outcomeMessage` like the other three. */}
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
                    {HAS_NATIVE_DOCUMENT_PICKER ? <Ghost label="Try a File Instead" onPress={pickFile} /> : null}
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
                  <Ghost label="Open" onPress={() => { void openDoc(doc); }} />
                ) : null}
                <Ghost label="Delete" onPress={() => removeDoc(doc)} />
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>

      {/* ── the document, full-screen, still inside this app ───────────────
          The whole point of item 46. A photographed report is drawn here by
          React Native's own <Image>, so the signed URL is fetched by this
          process and reaches nothing else: no browser history, no other app's
          recently-closed tabs, and nothing to sync to a laptop.

          `transparent={false}` and a solid backdrop rather than a dimmed sheet,
          because a medical document behind a translucent overlay is still a
          medical document somebody can read over your shoulder — and because
          the screen underneath lists the member's other reports by name.

          `onRequestClose` is not optional: on Android the hardware back button
          is how most people will close this, and without it the gesture goes to
          the router and leaves the modal up over a different screen. */}
      <Modal visible={viewing != null} animationType="fade" onRequestClose={() => setViewing(null)}
        supportedOrientations={['portrait', 'landscape']}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: layout.gutter, paddingVertical: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: '#fff' }} numberOfLines={1}>
                {viewing?.name ?? ''}
              </Text>
              {/* Repeated here rather than assumed from the screen behind it.
                  This is the moment the member is actually looking at their own
                  report, and it is the moment the sentence is worth reading. */}
              <Text style={{ ...ty.caption, color: '#999', marginTop: 2 }}>
                Open in the app · not in your browser
              </Text>
            </View>
            <Pressable onPress={() => setViewing(null)} hitSlop={12}
              accessibilityRole="button" accessibilityLabel="Close this document"
              style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: '#fff' }}>Close</Text>
            </Pressable>
          </View>
          {viewing?.url ? (
            <Image
              source={{ uri: viewing.url }}
              // Contain, never cover. A report cropped to fill the screen has
              // lost the edge of the page, which on a scan is where the dates
              // and the clinician's name are.
              resizeMode="contain"
              style={{ flex: 1, width: '100%' }}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Your document, ${viewing.name}`}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
