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
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { fmtDay } from '../../src/lib/format';
import {
  COACH_DOC_IMMUTABLE_NOTE, COACH_DOC_REACH_NOTE, DOC_MIME_TYPES, checkUpload,
  coachDocPath, shapeDocs, sizeLabel, standingLine, uploadRefusalLine,
  type CoachDoc, type RawCoachDoc,
} from '../../src/lib/coachDocs';

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

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setStatus('ready'); return; }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) { setStatus('error'); return; }
      const id = auth?.user?.id ?? null;
      if (!id) { setStatus('ready'); return; }
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

  /* ── Adding one ────────────────────────────────────────────────────────── */

  async function addDocument() {
    if (!uid) {
      Alert.alert('Not signed in', 'Sign in again and your paperwork will be here.');
      return;
    }
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: DOC_MIME_TYPES, copyToCacheDirectory: true });
    } catch (e) { reportError('coachDocs.pick', e); Alert.alert('That file could not be opened.'); return; }
    if (picked.canceled || !picked.assets?.length) return;
    const a = picked.assets[0];

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
    if (openId === d.id) { setOpenId(null); return; }
    setOpenId(d.id);
    setStanding(null);
    setStandingStatus('loading');
    const { data, error } = await supabase.rpc('coach_document_standing', { p_document: d.id });
    if (error) { setStandingStatus('error'); return; }
    setStanding((data ?? []).map((r: any) => ({
      clientId: String(r.client_id),
      name: (r.client_name && String(r.client_name).trim()) || 'A client',
      acceptedAt: r.accepted_at ? String(r.accepted_at) : null,
    })));
    setStandingStatus('ready');
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

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
                {status === 'loading' ? 'Reading your documents.'
                  : status === 'partial' ? 'Showing the most recent of your documents — there are more than fit in one read.'
                    : live.length === 0 ? 'You haven’t added any paperwork yet.'
                      : `${live.length} document${live.length === 1 ? '' : 's'} in circulation.`}
              </Text>
            )}

            <Section>
              <Cta label={busy ? 'Uploading…' : 'Add a document'} onPress={addDocument} disabled={busy} wide />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                A PDF, or a photograph of the page. Up to {sizeLabel(10485760)}.
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

                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                        <Ghost label={openId === d.id ? 'Hide' : 'Who’s accepted'} onPress={() => showStanding(d)} />
                        <Ghost label="Retire" onPress={() => retire(d)} />
                      </View>

                      {openId === d.id ? (
                        <View style={{ marginTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
                          {standingStatus === 'error' ? (
                            <Flag tone={t.warn}>
                              That could not be read just now. Nobody’s acceptance has changed — this list simply isn’t it.
                            </Flag>
                          ) : (
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {standingStatus === 'loading' ? 'Reading who has accepted it.'
                                : standingLine(accepted, standing?.length ?? 0) ?? 'You have no clients to ask yet.'}
                            </Text>
                          )}
                          {standingStatus === 'ready' ? (standing ?? []).map((s) => (
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
