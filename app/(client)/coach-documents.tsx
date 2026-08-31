// Client · what your coach asks you to read, and what you have accepted.
//
// ── Which waiver is which ─────────────────────────────────────────────────
//
// There are two, they belong to different people, and this screen has to say
// which one the reader is looking at.
//
// The release signed on joining is REPPLE's (supabase/parts/84). It is the
// client's legal record and the coach cannot read it, on purpose. Nothing on
// this screen touches it.
//
// These are the COACH's own: a studio waiver, a par-form, house rules for the
// unit they rent. Repple does not write them, check them or advise on them, and
// the copy says so — a member who thinks Repple drafted their coach's waiver
// takes a dispute to the wrong party.
//
// ── Accepting is permanent, so the screen says it is ──────────────────────
//
// `coach_document_acceptances` has no UPDATE policy, no DELETE policy and no
// grant behind either — the same shape part 84 uses, and for the same reason:
// evidence that can be withdrawn is not evidence. There is no un-accept, so
// nothing here offers one, and the confirmation says so before the tap rather
// than after it.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';
import {
  COACH_DOC_ACCEPT_RULE, COACH_DOC_NOT_REPPLE, docLine, outstanding,
  outstandingCount, shapeDocs, sizeLabel, type CoachDoc, type RawCoachDoc,
} from '../../src/lib/coachDocs';

const BUCKET = 'coach-docs';
/** Long enough to read a waiver, short enough that a leaked link is stale. */
const SIGNED_TTL_S = 300;

export default function ClientCoachDocumentsScreen() {
  const t = useTheme();
  const router = useRouter();

  const [docs, setDocs] = useState<CoachDoc[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which document the reader has opened at least once this session. Accepting
   *  is gated on it — see the note on `accept`. */
  const [opened, setOpened] = useState<string[]>([]);

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
      const { data, error } = await supabase.rpc('my_coach_documents');
      // An empty list under a failed read means the paperwork could not be
      // READ, not that there is none — and "your coach hasn't asked you for
      // anything" said to somebody with an unsigned waiver is the sentence this
      // whole codebase keeps having to take back.
      if (error) { setStatus('error'); return; }
      setDocs(shapeDocs((data ?? []) as RawCoachDoc[]));
      setStatus('ready');
    } catch (e) { reportError('clientCoachDocs.load', e); setStatus('error'); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function open(d: CoachDoc) {
    // Private bucket: a short-lived signed URL, never getPublicUrl(), which
    // hands back a working-looking string for a private object that then 400s.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.path, SIGNED_TTL_S);
    if (error || !data?.signedUrl) {
      reportError('clientCoachDocs.sign', error, { path: d.path });
      Alert.alert('Couldn’t open it', 'The link to that document could not be created just now. Try again in a moment.');
      return;
    }
    setOpened((p) => (p.includes(d.id) ? p : [...p, d.id]));
    try { await WebBrowser.openBrowserAsync(data.signedUrl); }
    catch (e) { reportError('clientCoachDocs.open', e); Alert.alert('Couldn’t open it', 'This device would not open that document.'); }
  }

  /**
   * Accept it.
   *
   * Gated on having OPENED it at least once, which is a deliberate friction and
   * not a technicality: the row this writes says a person read a document and
   * agreed to it, and an Accept button that works on a document nobody has
   * looked at records something that did not happen. The database cannot check
   * this — nothing about opening a file is visible to it — so the screen is the
   * only place it can be true.
   */
  function accept(d: CoachDoc) {
    if (!uid) { Alert.alert('Not signed in', 'Sign in again and this will be here.'); return; }
    if (!opened.includes(d.id)) {
      Alert.alert('Read it first', 'Open the document and read it — then you can accept it.');
      return;
    }
    Alert.alert(
      `Accept “${d.title}”?`,
      COACH_DOC_ACCEPT_RULE,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setBusyId(d.id);
            try {
              const { error } = await supabase.from('coach_document_acceptances')
                .insert({ document_id: d.id, client_id: uid });
              if (error) {
                reportError('clientCoachDocs.accept', error, { id: d.id });
                Alert.alert(
                  'Not recorded',
                  'That acceptance was not saved, so as far as your coach can see you have not accepted it yet. Try again.',
                );
                return;
              }
              await load();
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  const waiting = outstandingCount(docs);
  const ready = status === 'ready';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>From your coach</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Paperwork</Text>
          </View>
        </View>

        {!USE_SUPABASE ? (
          <Section>
            <Flag tone={t.ink3}>
              This build is running without the server. Your coach’s paperwork lives on it, so there is
              nothing here to show.
            </Flag>
          </Section>
        ) : (
          <>
            {/* Four outcomes a naive screen renders identically. Under 'error'
                an empty list means the read failed, and saying "nothing to sign"
                to somebody with an unsigned waiver is the failure this line
                exists to prevent. */}
            {status === 'error' ? (
              <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
                This could not be read just now, so it isn’t a list of what your coach has asked for. Check again when you have signal.
              </Flag>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
                {status === 'loading' ? 'Reading what your coach has asked of you.'
                  : docs.length === 0 ? 'Your coach hasn’t added any paperwork.'
                    : waiting === 0 ? 'Nothing is waiting on you.'
                      : `${waiting} document${waiting === 1 ? '' : 's'} waiting on you.`}
              </Text>
            )}

            {ready && docs.length ? (
              <Section>
                <SectionHead title="DOCUMENTS" />
                {docs.map((d, i) => (
                  <View key={d.id}>
                    {i ? <Rule /> : null}
                    <View style={{ paddingVertical: sp.md }}>
                      <Pressable onPress={() => open(d)} accessibilityRole="button" accessibilityLabel={`Open ${d.title}`}>
                        <Text style={{
                          ...ty.body,
                          fontWeight: outstanding(d) ? '600' : '500',
                          color: d.retired ? t.ink2 : t.ink,
                        }}>
                          {d.title}
                        </Text>
                        {/* docLine() already says "waiting on you" in words. The
                            tone moves to a dot: warn as caption ink is
                            3.87–4.08:1 on the light palettes, under AA. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          {outstanding(d) ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                          <Text style={{ ...ty.caption, color: outstanding(d) ? t.ink2 : t.ink3, flex: 1 }}>
                            {docLine(d)} · {sizeLabel(d.bytes)}
                          </Text>
                        </View>
                      </Pressable>

                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                        <Ghost label="Read it" onPress={() => open(d)} />
                        {outstanding(d) ? (
                          <Cta
                            label={busyId === d.id ? 'Saving…' : 'Accept'}
                            onPress={() => accept(d)}
                            disabled={busyId === d.id}
                          />
                        ) : null}
                      </View>
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}

            <Section>
              <Notice
                kicker="WHOSE DOCUMENT THIS IS"
                title="Your coach’s, not Repple’s"
                note={COACH_DOC_NOT_REPPLE}
              />
            </Section>
            <Section>
              <Notice
                kicker="ACCEPTING"
                title="It can’t be taken back"
                note={COACH_DOC_ACCEPT_RULE}
              />
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
