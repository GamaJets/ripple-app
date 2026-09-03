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
// ── Accepting offline still counts ────────────────────────────────────────
//
// The insert used to be bare. It failed, an alert said the acceptance was not
// saved, and the tap was gone — in a basement studio with no signal, which is
// where a coach's own paperwork is most often signed. The member then arrives
// for a session they have paid for and is turned away for a waiver they
// completed on their phone in the doorway.
//
// It is an outbox kind now ('coach-doc-accept', src/lib/outbox.ts), and that
// file argues at length why this one qualifies where a booking does not: it is
// not scarce, it costs nothing, it carries no file, and it says the same thing
// whenever it lands. Only a write nobody ANSWERED is kept — a refusal offered
// again gets the same refusal, so that path still says plainly that nothing was
// recorded.
//
// ── Accepting is permanent, so the screen says it is ──────────────────────
//
// `coach_document_acceptances` has no UPDATE policy, no DELETE policy and no
// grant behind either — the same shape part 84 uses, and for the same reason:
// evidence that can be withdrawn is not evidence. There is no un-accept, so
// nothing here offers one, and the confirmation says so before the tap rather
// than after it.
import { useCallback, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
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
import { classifyWrite } from '../../src/lib/offlineQueue';
import { keptOnPhoneNote, notKeptNote } from '../../src/lib/recordQueue';
import { outboxNote } from '../../src/lib/outbox';
import { useOutbox } from '../../src/ui/outbox';
import type { LoadStatus } from '../../src/ui/loadStatus';
import {
  COACH_DOC_ACCEPT_RULE, COACH_DOC_ACCESS_ENDS_NOTE, COACH_DOC_NOT_REPPLE, docLine, outstanding,
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
  /** Whether the read failed because nobody is signed in. A different sentence
   *  from a read that failed on the wire, and a different thing to do about it. */
  const [signedOut, setSignedOut] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which document the reader has opened at least once this session. Accepting
   *  is gated on it — see the note on `accept`. */
  const [opened, setOpened] = useState<string[]>([]);
  /** The device's queue. Null when there is no provider above this screen,
   *  which is a real state and not an error — see `useOutbox`. */
  const outbox = useOutbox();
  /** How many acceptances are on this phone and not on the server. Said out
   *  loud below, because it is the one thing the list itself cannot show: a
   *  queued acceptance deliberately does NOT mark the document as accepted,
   *  since that mark comes from the server's own row. */
  const waitingToSend = outbox?.countOf('coach-doc-accept') ?? 0;

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // Signed out is not 'ready'.
      //
      // 'ready' with an empty list is the ONE state that entitles this screen
      // to say "Your coach hasn't added any paperwork", and a session that had
      // merely expired landed in exactly it — so somebody with an unsigned
      // waiver was told there was nothing to sign, which is the sentence the
      // comment fifteen lines below says this file exists to prevent.
      // `my_coach_documents` reads as the signed-in user; with no session it
      // was never called at all.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setSignedOut(true); setStatus('error'); return; }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) { setStatus('error'); return; }
      const id = auth?.user?.id ?? null;
      if (!id) { setSignedOut(true); setStatus('error'); return; }
      setSignedOut(false);
      setUid(id);
      // sql-cap-ok: my_coach_documents() ends `limit 200`
      // (supabase/parts/156-a-document-meant-for-one-client.sql) on the
      // paperwork of the ONE coach this client trains under, and it orders
      // `required desc, created_at desc` before it cuts. Both halves matter.
      // The only figure this screen states over the list is
      // `outstandingCount`, which counts documents that are required, in
      // circulation and unaccepted — and required documents sort first, so a
      // cut at two hundred can only ever drop optional ones. The count cannot
      // be made wrong until a single coach is holding more than two hundred
      // REQUIRED documents, at which point the ceiling is the smaller of that
      // gym's problems. What a cut would drop is an old optional handout, from
      // the bottom of a list nobody counts.
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

  // What the coach has sent, and what has been acknowledged. A document sent
  // while this screen was open only appeared on the next focus.
  const pull = usePullToRefresh(load);

  async function open(d: CoachDoc) {
    // Private bucket: a short-lived signed URL, never getPublicUrl(), which
    // hands back a working-looking string for a private object that then 400s.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.path, SIGNED_TTL_S);
    if (error || !data?.signedUrl) {
      reportError('clientCoachDocs.sign', error, { path: d.path });
      Alert.alert('Couldn’t open it', 'The link to that document could not be created just now. Try again in a moment.');
      return;
    }
    // Recorded AFTER the browser has actually opened it, not before.
    //
    // This was on the line above the `try`, so a device that could not open the
    // document at all — the throw below, with its own alert saying exactly that
    // — still counted as having read it, and the Accept button underneath went
    // live. What the member then wrote is the record `COACH_DOC_ACCEPT_RULE`
    // describes: a dated acceptance against their name that "can't be edited or
    // withdrawn afterwards, by you or by them", for a waiver that never
    // appeared on their screen. The gate below is the only place the claim can
    // be true, and it was being told something that had not happened.
    try {
      await WebBrowser.openBrowserAsync(data.signedUrl);
      setOpened((p) => (p.includes(d.id) ? p : [...p, d.id]));
    } catch (e) {
      reportError('clientCoachDocs.open', e);
      Alert.alert('Couldn’t open it', 'This device would not open that document, so it is not marked as read. Try again, or open it on another device.');
    }
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
              // Counted, not merely error-checked. An INSERT that RLS narrows
              // to zero rows does not fail — it succeeds having stored nothing
              // — which on this table would be an acceptance the coach never
              // receives, reported to the member as done.
              let out;
              try {
                const { data, error } = await supabase.from('coach_document_acceptances')
                  .insert({ document_id: d.id, client_id: uid })
                  .select('document_id');
                // A duplicate key is not a refusal of anything. The primary
                // key is (document_id, client_id), so 23505 means this person
                // has already accepted this document — from another handset, or
                // from a queued intent that has since gone up. `classifyWrite`
                // reads it as 'refused', which is right for every other write
                // and wrong here: the row is there and the member's acceptance
                // stands. Reload and show it.
                if ((error as { code?: string } | null)?.code === '23505') { await load(); return; }
                if (error) reportError('clientCoachDocs.accept', error, { id: d.id });
                out = classifyWrite(error as any, data ? data.length : 0);
              } catch (e) { reportError('clientCoachDocs.accept', e, { id: d.id }); out = 'unsent' as const; }

              if (out === 'stored') { await load(); return; }
              // 'refused' is the server having read the row and declined it —
              // the document retired, the coach no longer theirs. Offering the
              // same bytes again gets the same answer, so it is not queued and
              // the sentence does not pretend otherwise.
              if (out === 'refused') {
                Alert.alert(
                  'Not recorded',
                  'That acceptance was not saved, so as far as your coach can see you have not accepted it yet. Try again.',
                );
                return;
              }
              // Nobody answered. The acceptance is kept rather than dropped.
              if (!outbox) {
                Alert.alert('Not recorded', notKeptNote('acceptance', 'unavailable'));
                return;
              }
              const { result } = await outbox.enqueue('coach-doc-accept', { documentId: d.id, title: d.title });
              if (result !== 'queued') {
                Alert.alert('Not recorded', notKeptNote('acceptance', result === 'full' ? 'full' : 'unavailable'));
                return;
              }
              // Deliberately NOT followed by a reload that would mark it
              // accepted. The tick on this list comes from the server's own
              // row, and drawing one now would tell somebody their coach has
              // their signature while it is still on the phone.
              Alert.alert('Saved on this phone', keptOnPhoneNote('acceptance'));
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

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
                {signedOut
                  ? 'Your coach’s paperwork is only readable once you are signed in, so this screen could not look it up. This is not a list of what your coach has asked for.'
                  : 'This could not be read just now, so it isn’t a list of what your coach has asked for. Check again when you have signal.'}
              </Flag>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
                {status === 'loading' ? 'Reading what your coach has asked of you.'
                  : docs.length === 0 ? 'Your coach hasn’t added any paperwork.'
                    : waiting === 0 ? 'Nothing is waiting on you.'
                      : `${waiting} document${waiting === 1 ? '' : 's'} waiting on you.`}
              </Text>
            )}

            {/* An acceptance on this phone that the server has not taken. It
                has to be SAID, because it is the one thing this list cannot
                show: the tick beside a document comes from the server's own
                row, so a queued acceptance looks exactly like one that never
                happened — and the difference is whether the member is turned
                away at the door. */}
            {outboxNote(waitingToSend, 'coach-doc-accept') ? (
              <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
                {outboxNote(waitingToSend, 'coach-doc-accept')} Until then your coach cannot see it, and it is not ticked below.
              </Flag>
            ) : null}

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
                        <Ghost label="Read It" onPress={() => open(d)} />
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
                title={`Your coach’s, not ${BRAND.label}’s`}
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
            {/* The other half of that permanence, and the half only the coach
                was being told. The acceptance is for ever; the ACCESS is not —
                `can_read_coach_doc` follows `clients.trainer_id`, so changing
                coach closes every one of these, accepted or not. Somebody who
                may need a copy has to know that before the day it happens. */}
            <Section>
              <Notice
                kicker="WHILE THIS IS YOUR COACH"
                title="These open for you while you are coached by them"
                note={COACH_DOC_ACCESS_ENDS_NOTE}
              />
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
