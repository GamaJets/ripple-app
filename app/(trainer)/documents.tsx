// Coach · your own paperwork.
//
// ── What this screen is for ───────────────────────────────────────────────
//
// A working trainer has documents of their own: a studio waiver, a par-form,
// house rules for the unit they rent, a photography consent. Until now Repple
// held the bookings, the injuries, the plan and the money for a coach, and held
// no record at all that a client had agreed to anything the COACH asked them to
// agree to. The waiver in the app was Repple's, part 84's, and is deliberately
// unreadable to the coach — correctly, because it is the client's legal record
// and not roster data.
//
// This is the other thing, and it is entirely separate: the coach uploads their
// own document, marks it required or not, and the acceptance is recorded the
// way part 84 records Repple's — insert-only, no UPDATE policy, no DELETE
// policy, no un-accept for either party.
//
// ── What cannot happen here, and why the screen says so ───────────────────
//
// A document cannot be edited once it is uploaded. Not the title, not the file:
// `coach_documents_immutable_guard` (supabase/parts/135) refuses the update, and
// there is no UPDATE grant to reach it with anyway. That is not caution, it is
// the whole point — an acceptance points at a document, so a coach who could
// swap the file behind an accepted one would be holding a signed acceptance of
// something nobody read. Re-issuing amended paperwork is a NEW document plus a
// retirement of the old one, which is part 84's "add a row rather than edit what
// somebody agreed to" in the shape this feature needs.
//
// Every sentence on this screen comes from src/lib/coachDocs.ts, which holds
// those rules and has a test that fails if the wording drifts from what the
// database will actually keep.
import { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { fmtDay } from '../../src/lib/format';
import {
  COACH_DOC_IMMUTABLE_NOTE, COACH_DOC_REACH_NOTE, DOC_MIME_TYPES, checkUpload,
  coachDocPath, shapeDocs, sizeLabel, standingLine, STANDING_ROW_CAP, STANDING_TRUNCATED_NOTE,
  uploadRefusalLine,
  type CoachDoc, type RawCoachDoc,
} from '../../src/lib/coachDocs';
import {
  AUDIENCE_ROW_CAP, SEND_IS_ONE_WAY, audienceLine, isAddressed, memberLine, sendBlock, sendBlockLine,
  sendFailure, sendFailureLine, sendWarning, shapeAudience,
  type AudienceMember, type RawAudienceRow,
} from '../../src/lib/coachDocAudience';
// Not `import * as DocumentPicker from 'expo-document-picker'`, which is what
// this file used to do. That package's entry point is a bare
// requireNativeModule call at module scope, so the import THREW on any install
// made before the dependency landed and took this whole screen with it. The
// guard answers the same question without the throw — see
// src/ui/nativeModules.ts.
import {
  HAS_NATIVE_DOCUMENT_PICKER, DOCUMENT_PICKER_UNAVAILABLE_NOTE, pickDocument,
} from '../../src/ui/nativeModules';

const BUCKET = 'coach-docs';
/** Long enough to read a waiver, short enough that a leaked link is stale. */
const SIGNED_TTL_S = 300;

interface Standing { clientId: string; name: string; acceptedAt: string | null }

const newToken = () => Math.random().toString(36).slice(2, 10);

export default function CoachDocumentsScreen() {
  const t = useTheme();
  const router = useRouter();

  const [docs, setDocs] = useState<CoachDoc[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which document's acceptance list is open. One identifier, one expandable
  // panel — there is no modal on this screen at all, so there is nothing for
  // two of them to fight over.
  const [openId, setOpenId] = useState<string | null>(null);
  const [standing, setStanding] = useState<Standing[] | null>(null);
  const [standingStatus, setStandingStatus] = useState<LoadStatus>('ready');
  // Which document's SEND panel is open. Separate from `openId` above on
  // purpose: "who has accepted it" and "who is it even in front of" are two
  // questions, and a coach opening the second one has not stopped wanting the
  // answer to the first.
  const [sendId, setSendId] = useState<string | null>(null);
  /* The document each panel's answer is allowed to land for. Both panels are
   * single-slot — one `standing` list, one `audience` list — and a coach checks
   * two documents in a row without waiting for the first. Closing a panel sets
   * these to null, so a response that arrives after the close is dropped rather
   * than re-populating a panel the coach has dismissed. */
  const wantStanding = useRef<string | null>(null);
  const wantAudience = useRef<string | null>(null);
  const [audience, setAudience] = useState<AudienceMember[] | null>(null);
  const [audienceStatus, setAudienceStatus] = useState<LoadStatus>('ready');
  /** True when `coach_document_audience` is not on this server — part 156 has
   *  not been run. A different sentence from a read that failed on the wire,
   *  and a different thing to do about it. */
  const [sendOff, setSendOff] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // Both of these used to be 'ready', and 'ready' is the one status this
      // screen's render treats as a licence to say "You haven't added any
      // paperwork yet." A coach whose session has dropped while they are on
      // this screen — app/(trainer)/_layout.tsx checks the group and does not
      // redirect, so nothing evicts them — was told their waivers and
      // agreements were not on file. They are; we simply had nobody to ask as.
      // 'error' means UNKNOWN (src/ui/loadStatus.ts), which is exactly what
      // this is, and the render already draws it as "could not be read".
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setStatus('error'); return; }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) { setStatus('error'); return; }
      const id = auth?.user?.id ?? null;
      if (!id) { setStatus('error'); return; }
      setUid(id);
      const { data, error } = await supabase.from('coach_documents')
        .select('id, coach_id, title, path, mime, bytes, required, retired_at, created_at')
        .eq('coach_id', id)
        .order('created_at', { ascending: false })
        .limit(capLimit());
      // An empty list under a failed read means "we could not ask", and a coach
      // told they have no paperwork on file would upload it a second time.
      if (error) { setStatus('error'); return; }
      const page = capped(data);
      setDocs(shapeDocs(page.rows.map((r: any): RawCoachDoc => ({
        id: r.id, coach_id: r.coach_id, title: r.title, path: r.path, mime: r.mime,
        bytes: r.bytes, required: r.required, retired: r.retired_at != null,
        created_at: r.created_at, accepted_at: null,
      }))));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) { reportError('coachDocs.load', e); setStatus('error'); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // The one read on this screen, and the same one focus runs. A refused read
  // draws "could not be read" over the coach's whole paperwork list, and a
  // coach who cannot get past that sentence uploads everything a second time.
  const pull = usePullToRefresh(load);

  /* ── Adding one ────────────────────────────────────────────────────────── */

  async function addDocument() {
    if (!uid) {
      Alert.alert('Not signed in', 'Sign in again and your paperwork will be here.');
      return;
    }
    const picked = await pickDocument({ type: DOC_MIME_TYPES });
    // Four answers, and three of them are not "a file". `unavailable` is the
    // one that used to be impossible to reach because the import crashed first:
    // this build has no picker at all, and saying so is the only honest thing —
    // the button is already disabled for it, and this is the second lock.
    if (picked.outcome === 'unavailable') {
      Alert.alert('This build cannot open your files', DOCUMENT_PICKER_UNAVAILABLE_NOTE);
      return;
    }
    if (picked.outcome === 'error') {
      reportError('coachDocs.pick', picked.error);
      Alert.alert('That file could not be opened.');
      return;
    }
    // Cancelled is the coach changing their mind and is not a failure.
    if (picked.outcome === 'cancelled') return;
    const a = picked.file;

    // Checked here, before any bytes move. A 413 from storage arrives as an
    // opaque failure, and "that file is too large" is a sentence somebody can
    // act on.
    const verdict = checkUpload({ filename: a.name, mime: a.mimeType, bytes: a.size ?? 0 });
    if (!verdict.ok) { Alert.alert('Can’t use that file', uploadRefusalLine(verdict.reason)); return; }

    const path = coachDocPath({
      coachId: uid, filename: a.name, mime: a.mimeType as string, millis: Date.now(), token: newToken(),
    });
    if (!path) { Alert.alert('Can’t use that file', uploadRefusalLine('type')); return; }

    setBusy(true);
    try {
      let bytes: ArrayBuffer;
      try {
        const res = await fetch(a.uri);
        if (!res.ok) throw new Error('unreadable');
        bytes = await res.arrayBuffer();
      } catch (e) {
        reportError('coachDocs.read-file', e);
        Alert.alert('Couldn’t read that file', 'It could not be read off this device, so nothing was uploaded.');
        return;
      }
      if (bytes.byteLength === 0) { Alert.alert('Can’t use that file', uploadRefusalLine('empty')); return; }

      const { error: upErr } = await supabase.storage
        .from(BUCKET).upload(path, bytes, { contentType: a.mimeType as string, upsert: false });
      if (upErr) {
        reportError('coachDocs.upload', upErr, { path });
        Alert.alert('Not uploaded', 'That document was not saved, so nothing has been added and nobody has been asked to accept anything.');
        return;
      }

      // The row is what makes the file a DOCUMENT. If this fails the object is
      // orphaned rather than half-published — a file nobody is pointed at is
      // invisible, which is the safe side of this particular failure.
      const title = (a.name || 'Document').replace(/\.[^./\\]+$/, '').slice(0, 120) || 'Document';
      const { error: rowErr } = await supabase.from('coach_documents').insert({
        coach_id: uid, title, path, mime: a.mimeType, bytes: bytes.byteLength, required: false,
      });
      if (rowErr) {
        reportError('coachDocs.insert', rowErr, { path });
        // Take the bytes back out. Nobody has accepted it — it did not exist a
        // second ago — so the storage delete policy allows this.
        // no-error-ok: the row insert already failed and is what the coach is told about; a leftover object is invisible to everybody and is the operator's purge queue's problem, not a second alert
        await supabase.storage.from(BUCKET).remove([path]);
        Alert.alert('Not added', 'The file uploaded but could not be filed, so it has been removed. Nothing has been asked of anybody.');
        return;
      }
      await load();
    } finally { setBusy(false); }
  }

  /* ── Opening one ───────────────────────────────────────────────────────── */

  async function open(d: CoachDoc) {
    // Private bucket: a signed URL, never getPublicUrl(), which hands back a
    // working-looking string for a private object that then 400s.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.path, SIGNED_TTL_S);
    if (error || !data?.signedUrl) {
      reportError('coachDocs.sign', error, { path: d.path });
      Alert.alert('Couldn’t open it', 'The link to that document could not be created just now. Try again in a moment.');
      return;
    }
    try { await WebBrowser.openBrowserAsync(data.signedUrl); }
    catch (e) { reportError('coachDocs.open', e); Alert.alert('Couldn’t open it', 'This device would not open that document.'); }
  }

  /* ── Who has accepted ──────────────────────────────────────────────────── */

  async function showStanding(d: CoachDoc) {
    if (openId === d.id) { setOpenId(null); wantStanding.current = null; return; }
    setOpenId(d.id);
    wantStanding.current = d.id;
    setStanding(null);
    setStandingStatus('loading');
    // `.limit(capLimit())` and `capped()`, exactly as the document list on this
    // screen does at `load` above and as src/ui/coachThreads.ts does for the
    // sibling RPC. PostgREST stops at 1000 rows and says nothing, and the
    // sentence this read feeds is not a figure on a dashboard — it is "All 12
    // of your clients have accepted this", a claim about a signed waiver. A
    // read that stopped at the cap can produce it out of twelve rows of
    // nineteen, and the coach then trains the other seven believing they are
    // covered.
    const { data, error } = await supabase.rpc('coach_document_standing', { p_document: d.id })
      .limit(capLimit());
    // The coach has closed this panel or opened another document's. There is
    // one `standing` list on this screen and one `standingStatus` beside it, so
    // without this check a slower answer for the waiver lands under the
    // agreement and states, by name and date, who has accepted a document they
    // have never been shown.
    if (wantStanding.current !== d.id) return;
    if (error) { setStandingStatus('error'); return; }
    const page = capped(Array.isArray(data) ? data : []);
    setStanding(page.rows.map((r: any) => ({
      clientId: String(r.client_id),
      name: (r.client_name && String(r.client_name).trim()) || 'A client',
      acceptedAt: r.accepted_at ? String(r.accepted_at) : null,
    })));
    // 'partial' is not 'ready' (src/ui/loadStatus.ts): the names may be shown,
    // the count over them may not.
    //
    // Two ceilings, and only one of them was ever visible. `capped()` catches
    // PostgREST's silent 1000-row stop. STANDING_ROW_CAP catches the `limit
    // 500` written INSIDE `coach_document_standing()`, which is the lower of
    // the two and therefore the only one that has ever actually bitten — and
    // which rowCap.ts is structurally unable to see, because it detects a cut
    // by asking for one row more than the server is willing to give.
    setStandingStatus(page.truncated || page.rows.length >= STANDING_ROW_CAP ? 'partial' : 'ready');
  }

  /* ── Sending one to a particular client ────────────────────────────────── */
  //
  // The half part 135 did not build. Uploading a document made it readable by
  // the WHOLE roster and there was no way to put one in front of one person —
  // which is most of what a coach actually sends: a training agreement, a rehab
  // protocol written after one consultation, a plan somebody paid for.
  //
  // `coach_document_audience` and `send_coach_document` are supabase/parts/156.
  // Until that file has been run they do not exist, and PostgREST answers a call
  // to a missing function with PGRST202 — which arrives here as an ordinary
  // error and would draw as "try again in a moment" forever. `sendFailure` picks
  // that case out so the sentence says what is actually true: nothing was sent,
  // and every document is still readable by everyone this coach coaches.

  async function openSend(d: CoachDoc) {
    if (sendId === d.id) { setSendId(null); wantAudience.current = null; return; }
    setSendId(d.id);
    wantAudience.current = d.id;
    setAudience(null);
    setSendOff(false);
    setAudienceStatus('loading');
    const { data, error } = await supabase.rpc('coach_document_audience', { p_document: d.id })
      .limit(capLimit());
    // As in `showStanding`: one audience list, one status, and the panel above
    // is headed by whichever document is open now. A stale answer landing here
    // would show who has and has not been sent the OTHER document, and every
    // name in that list is a live Send control — so acting on it would put the
    // wrong paperwork in front of somebody, irreversibly (SEND_IS_ONE_WAY).
    if (wantAudience.current !== d.id) return;
    if (error) {
      // `returned: true` because this is a READ — there is no boolean to judge,
      // only whether the function is there at all and whether the wire held.
      const why = sendFailure({ error, returned: true });
      setSendOff(why === 'unavailable');
      if (why !== 'unavailable') reportError('coachDocs.audience', error, { id: d.id });
      setAudienceStatus('error');
      return;
    }
    // Capped for the same reason as the standing read, and with more at stake:
    // the sentence under this panel says who can open the document, and the
    // picker under THAT performs a send that cannot be undone. See the
    // 'part-read' arm of `sendBlock`.
    const page = capped(Array.isArray(data) ? data : []);
    setAudience(shapeAudience(page.rows as RawAudienceRow[]));
    setAudienceStatus(page.truncated || page.rows.length >= AUDIENCE_ROW_CAP ? 'partial' : 'ready');
  }

  function sendTo(d: CoachDoc, m: AudienceMember, addressed: boolean) {
    const who = m.name ?? 'this client';
    Alert.alert(
      `Send “${d.title}” to ${who}?`,
      `${sendWarning(addressed)}\n\n${SEND_IS_ONE_WAY}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSendingTo(m.clientId);
            try {
              const { data, error } = await supabase.rpc('send_coach_document', {
                p_document: d.id, p_client: m.clientId,
              });
              // A PostgREST call that a policy refused and one that matched
              // nothing both come back as a success, so the RETURN VALUE is
              // what decides this — never the absence of an error.
              const why = sendFailure({ error, returned: data });
              if (why) {
                if (why !== 'unavailable') reportError('coachDocs.send', error, { id: d.id });
                setSendOff(why === 'unavailable');
                Alert.alert('Not sent', sendFailureLine(why));
                return;
              }
              // Re-read rather than patching the row in place: the send may have
              // been the one that narrowed this document, and the line above the
              // list changes meaning when it does.
              await openSendRefresh(d);
            } finally { setSendingTo(null); }
          },
        },
      ],
    );
  }

  /** Re-read the audience for a document whose panel is already open. */
  async function openSendRefresh(d: CoachDoc) {
    const { data, error } = await supabase.rpc('coach_document_audience', { p_document: d.id })
      .limit(capLimit());
    // The same guard `openSend` makes, for the same reason and with the send
    // already behind it. This is called from inside `sendTo`, so the coach has
    // just tapped Send and is free to close this panel and open another
    // document's while the re-read is in flight — at which point this answer
    // landed under the OTHER document's heading, and every name in it is a
    // live Send control. One tap on it puts the wrong paperwork in front of a
    // client, and SEND_IS_ONE_WAY means there is no taking it back.
    if (wantAudience.current !== d.id) return;
    if (error) {
      // And the same three-way reading of the failure. Without it a build
      // running against a database that has not had part 156 applied showed a
      // generic error here and the correct "this needs an update" sentence in
      // `openSend`, from the same RPC, seconds apart.
      const why = sendFailure({ error, returned: true });
      setSendOff(why === 'unavailable');
      if (why !== 'unavailable') reportError('coachDocs.audience', error, { id: d.id });
      setAudienceStatus('error');
      return;
    }
    // Capped for the same reason as the standing read, and with more at stake:
    // the sentence under this panel says who can open the document, and the
    // picker under THAT performs a send that cannot be undone. See the
    // 'part-read' arm of `sendBlock`.
    const page = capped(Array.isArray(data) ? data : []);
    setAudience(shapeAudience(page.rows as RawAudienceRow[]));
    setAudienceStatus(page.truncated || page.rows.length >= AUDIENCE_ROW_CAP ? 'partial' : 'ready');
  }

  /* ── The two things a coach may change ─────────────────────────────────── */

  async function setRequired(d: CoachDoc, required: boolean) {
    const { data, error } = await supabase.rpc('set_coach_document_required', {
      p_document: d.id, p_required: required,
    });
    // Zero rows is not an error in PostgREST, and the RPC returns false for it
    // rather than letting this screen say "saved" over a write that matched
    // nothing.
    if (error || data !== true) {
      reportError('coachDocs.required', error, { id: d.id });
      Alert.alert('Not changed', 'That could not be changed just now, so it is still as it was.');
      return;
    }
    await load();
  }

  function retire(d: CoachDoc) {
    Alert.alert(
      `Retire “${d.title}”?`,
      'It stops being shown to clients who have not accepted it, and stops being something you can require. '
      + 'Everyone who has already accepted it keeps that record and can still read what they agreed to. '
      + 'This cannot be undone — issue a new version instead of bringing this one back.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Retire',
          style: 'destructive',
          onPress: async () => {
            const { data, error } = await supabase.rpc('retire_coach_document', { p_document: d.id });
            if (error || data !== true) {
              reportError('coachDocs.retire', error, { id: d.id });
              Alert.alert('Not retired', 'That could not be retired just now, so it is still in circulation.');
              return;
            }
            await load();
          },
        },
      ],
    );
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  const live = docs.filter((d) => !d.retired);
  const retired = docs.filter((d) => d.retired);
  const accepted = standing?.filter((s) => s.acceptedAt).length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your paperwork</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Documents</Text>
          </View>
        </View>

        {!USE_SUPABASE ? (
          <Section>
            <Flag tone={t.ink3}>
              This build is running without the server. Paperwork and the record of who accepted it both live
              on it, so there is nothing here to show.
            </Flag>
          </Section>
        ) : (
          <>
            {/* The failed read is a Flag, not warn-coloured ink: warn as text is
                3.87–4.08:1 on the three light palettes, below AA. */}
            {status === 'error' ? (
              <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
                Your documents could not be read just now, so this list is not what is on file. Nothing here has changed.
              </Flag>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
                {/* `live` counts documents in CIRCULATION, and the sentence for
                    an empty one claimed nothing had ever been added — while the
                    RETIRED section below listed the documents that had. A
                    document cannot be edited here, so retiring one and issuing
                    a replacement is the documented way to change anything: the
                    coach who followed that route was told, on the same screen
                    that was showing them their own retired waiver, that they
                    had added no paperwork. The two cases are separated now, and
                    only the genuinely empty one says nothing was ever added. */}
                {status === 'loading' ? 'Reading your documents.'
                  : status === 'partial' ? 'Showing the most recent of your documents — there are more than fit in one read.'
                    : live.length === 0 && retired.length === 0 ? 'You haven’t added any paperwork yet.'
                      : live.length === 0 ? `Nothing is in circulation — the ${retired.length === 1 ? 'document you have added has' : `${retired.length} documents you have added have`} all been retired.`
                        : `${live.length} document${live.length === 1 ? '' : 's'} in circulation.`}
              </Text>
            )}

            <Section>
              <Cta label={busy ? 'Uploading…' : 'Add a document'} onPress={addDocument} disabled={busy || !HAS_NATIVE_DOCUMENT_PICKER} wide />
              {/* Disabled with the reason beside it rather than live and inert.
                  A button that opens nothing reads as a broken screen, and the
                  coach's next move is to try it again. */}
              {!HAS_NATIVE_DOCUMENT_PICKER ? (
                <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{DOCUMENT_PICKER_UNAVAILABLE_NOTE}</Flag>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                A PDF, or a photograph of the page. Up to {sizeLabel(10485760)}.
              </Text>
              {/* Said at the point of upload, because it is the thing a coach
                  gets wrong: what you add here is readable by your whole
                  roster. Addressing it to one person is a separate act, on the
                  document itself, and it takes the document away from everybody
                  else — see sendWarning in src/lib/coachDocAudience.ts. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Everyone you coach can read what you add. To put one in front of a single client, use Send
                to a Client on the document once it is here.
              </Text>
            </Section>

            {live.length ? (
              <Section>
                <SectionHead title="IN CIRCULATION" />
                {live.map((d, i) => (
                  <View key={d.id}>
                    {i ? <Rule /> : null}
                    <View style={{ paddingVertical: sp.md }}>
                      <Pressable onPress={() => open(d)} accessibilityRole="button" accessibilityLabel={`Open ${d.title}`}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{d.title}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {sizeLabel(d.bytes)} · added {fmtDay(d.createdAt)}
                        </Text>
                      </Pressable>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
                        <Switch
                          value={d.required}
                          onValueChange={(v) => setRequired(d, v)}
                          accessibilityLabel={`Require clients to accept ${d.title}`}
                        />
                        <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
                          {d.required
                            ? 'Clients are asked to read and accept this'
                            : 'Clients can read this; they aren’t asked to accept it'}
                        </Text>
                      </View>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
                        <Ghost label={openId === d.id ? 'Hide' : 'Who’s accepted'} onPress={() => showStanding(d)} />
                        <Ghost label={sendId === d.id ? 'Hide' : 'Send to a Client'} onPress={() => openSend(d)} />
                        <Ghost label="Retire" onPress={() => retire(d)} />
                      </View>

                      {/* ── Who this is in front of, and sending it to one more
                          person. The panel is the whole roster rather than only
                          the people it has been sent to, because the thing a
                          coach came here to do is pick somebody who has NOT had
                          it — see the sort in src/lib/coachDocAudience.ts. */}
                      {sendId === d.id ? (
                        <View style={{ marginTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
                          {(() => {
                            const block = sendBlock({
                              retired: d.retired,
                              members: audience,
                              read: audienceStatus === 'error' ? 'failed'
                                : audienceStatus === 'partial' ? 'truncated' : 'ok',
                            });
                            if (audienceStatus === 'loading') {
                              return <Text style={{ ...ty.caption, color: t.ink3 }}>Reading who this is in front of.</Text>;
                            }
                            if (block) {
                              // An empty list under a failed read is "we could
                              // not ask", never "you have nobody" — a coach with
                              // twelve clients told the second would go and
                              // re-add them.
                              return (
                                <Flag tone={sendOff || block === 'unread' || block === 'part-read' ? t.warn : t.ink3}>
                                  {sendOff ? sendFailureLine('unavailable') : sendBlockLine(block)}
                                </Flag>
                              );
                            }
                            const members = audience ?? [];
                            const addressed = isAddressed(members);
                            return (<>
                              <Text style={{ ...ty.caption, color: t.ink2 }}>{audienceLine(members)}</Text>
                              {members.map((m) => (
                                <Pressable key={m.clientId}
                                  onPress={() => { if (m.sentAt == null) sendTo(d, m, addressed); }}
                                  disabled={m.sentAt != null || sendingTo != null}
                                  accessibilityRole="button"
                                  /* Two reasons this can be refused and only
                                     one of them was ever said: the label
                                     covers "already has it", and a send in
                                     flight to somebody else looked identical
                                     to a live control. */
                                  accessibilityState={{ disabled: m.sentAt != null || sendingTo != null, busy: sendingTo === m.clientId }}
                                  accessibilityLabel={m.sentAt != null
                                    ? `${m.name ?? 'A client'} already has ${d.title}`
                                    : `Send ${d.title} to ${m.name ?? 'this client'}`}
                                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.sm }}>
                                  <View style={{ flex: 1 }}>
                                    {/* An unreadable name is said to be one, and
                                        never replaced by somebody else's — the
                                        whole lesson of TF-32. */}
                                    <Text style={{ ...ty.caption, color: m.name ? t.ink : t.ink3 }}>
                                      {m.name ?? 'A client whose name could not be read'}
                                    </Text>
                                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{memberLine(m, fmtDay)}</Text>
                                  </View>
                                  {m.sentAt == null ? (
                                    <Text style={{ ...ty.caption, fontWeight: '600', color: sendingTo === m.clientId ? t.ink3 : t.brand }}>
                                      {sendingTo === m.clientId ? 'Sending…' : 'Send'}
                                    </Text>
                                  ) : null}
                                </Pressable>
                              ))}
                            </>);
                          })()}
                        </View>
                      ) : null}

                      {openId === d.id ? (
                        <View style={{ marginTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
                          {standingStatus === 'error' ? (
                            <Flag tone={t.warn}>
                              That could not be read just now. Nobody’s acceptance has changed — this list simply isn’t it.
                            </Flag>
                          ) : standingStatus === 'partial' ? (
                            /* A mark, not coloured words: a truncated read is the
                               one state on this panel where a coach must NOT take
                               the sentence at a glance. */
                            <Flag tone={t.warn}>{STANDING_TRUNCATED_NOTE}</Flag>
                          ) : (
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {standingStatus === 'loading' ? 'Reading who has accepted it.'
                                : standingLine(accepted, standing?.length ?? 0) ?? 'You have no clients to ask yet.'}
                            </Text>
                          )}
                          {/* The names are real under 'partial' and are still
                              worth showing — it is the COUNT over them that
                              cannot be stated. See src/ui/loadStatus.ts. */}
                          {standingStatus === 'ready' || standingStatus === 'partial' ? (standing ?? []).map((s) => (
                            <View key={s.clientId} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
                              <Text style={{ ...ty.caption, color: t.ink }}>{s.name}</Text>
                              {/* "Not yet" is the words; warn is the dot beside them.
                                  As ink it was 3.87–4.08:1 on the light palettes. */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {s.acceptedAt ? null : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />}
                                <Text style={{ ...ty.caption, color: s.acceptedAt ? t.ink3 : t.ink2 }}>
                                  {s.acceptedAt ? fmtDay(s.acceptedAt) : 'Not yet'}
                                </Text>
                              </View>
                            </View>
                          )) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}

            {retired.length ? (
              <Section>
                <SectionHead title="RETIRED" note="still readable to whoever accepted them" />
                {retired.map((d, i) => (
                  <View key={d.id}>
                    {i ? <Rule /> : null}
                    <Pressable onPress={() => open(d)} accessibilityRole="button" accessibilityLabel={`Open ${d.title}`}
                      style={{ paddingVertical: sp.md }}>
                      <Text style={{ ...ty.body, color: t.ink2 }}>{d.title}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        Withdrawn · added {fmtDay(d.createdAt)}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </Section>
            ) : null}

            <Section>
              <Notice kicker="EDITING" title="A document can’t be changed once it’s here" note={COACH_DOC_IMMUTABLE_NOTE} />
            </Section>
            <Section>
              <Notice kicker="WHO SEES THEM" title="You and the clients you coach" note={COACH_DOC_REACH_NOTE} />
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
