// Trainer · Broadcast. Message a whole segment of clients at once — everyone, a
// tag, or one of the states the app computes for itself. Writes one real
// message into each client's own thread and sends a push. OTA-safe.
//
// ── It is N messages, and it is the coach's words ──────────────────────────
//
// There is no broadcast object anywhere behind this screen and there will not
// be one. Each client gets an ordinary `messages` row they can reply to, in the
// thread that already holds everything else their coach has said to them, and
// nothing is added to the words the coach typed. Both halves are the same rule:
// a message must never be composed under somebody else's name, which is written
// out in src/lib/nudge.ts and supabase/parts/140 and was earned — `messages
// .sender` once came from the caller's own request, so a client could post into
// their own thread as 'coach'. The fan-out lives in `sendCoachMessages`
// (src/ui/messaging.ts); what the coach is told before they send is
// `bulkThreadNote` (src/lib/bulkActions.ts), which explains why nothing is
// appended rather than appending it.
//
// ── The segments were a tag somebody typed, and nothing the app knows ──────
//
// This screen offered two kinds of recipient list: everybody, or a tag typed by
// hand. Meanwhile the app computes, for other screens, exactly the categories a
// coach would want to write to — who has drifted off their own pattern
// (src/lib/clientDrift.ts), who has nothing on record, whose session pack has
// run out or is nearly out (`packLeft` in src/lib/coachMoney.ts), who has never
// checked in. None of it was reachable from the one screen that sends.
//
// A tag is a note the coach has to maintain; a computed segment is true this
// morning. src/lib/segments.ts holds the definitions and the membership rules,
// and the thing it is most careful about is the one that makes a computed
// segment harder than a tag: a tag that fails to load matches nobody and the
// coach sees a zero, whereas a drift read that comes back at its row ceiling
// produces a plausible smaller segment and a coach writing "I haven't seen you
// in a while" to somebody who trained yesterday. So every computed segment
// names the READ it is built from, this screen keeps a LoadStatus per source,
// and that status — not the roster's — is what `guardRecipients` refuses on.
//
// The two source reads are lazy: they cost four queries and five queries
// respectively and a coach writing to everybody needs neither. Selecting a
// computed segment starts its read, and until it lands the guard says "Reading
// who that is…" and the send is held, which is what that status has always
// meant here.
//
// ── "Everyone" over a roster that came back short ──────────────────────────
//
// This screen already refused to send over a FAILED roster read and merely
// warned about a TRUNCATED one — it sent, and reported "Partly sent" with a
// note. That was the wrong side of the line. A segment is a claim about a
// category: the number on the button was the size of the page rather than the
// size of the segment, the message read as complete to everyone who got it, and
// nothing afterwards said which of the coach's clients had been left out.
// `guardRecipients` refuses both now, for the same reason `guardOverwrite`
// refuses rather than annotating: a banner does not stop a thumb.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero — a composer has no live number to lead with, so
// the segment, the recipient list and the message are three hairline-separated
// sections and the Georgia serif title is gone. Same segment logic, same insert,
// same push, same route.
//
// One claim removed: the confirmation said "Message delivered to N clients"
// while the insert's error was swallowed and the push is a best-effort no-op on
// builds without notifications — a delivery receipt the app never receives. It
// now reports what it can actually see (the rows written to the threads) and
// says so plainly when the write fails.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useTenant } from '../../src/ui/tenant';
import { useClientTags } from '../../src/ui/clientTags';
import { sendCoachMessages } from '../../src/ui/messaging';
import { guardRecipients, bulkReport, bulkThreadNote, type WriteOutcome } from '../../src/lib/bulkActions';
import { listNames } from '../../src/lib/groupProgram';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';
import type { StatusLevel } from '../../src/lib/status';
import { rankClients, readClientActivity, type DriftInput } from '../../src/lib/clientDrift';
import { packLeft } from '../../src/lib/coachMoney';
import { fetchClientPurchases } from '../../src/lib/connect';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import {
  COMPUTED_SEGMENTS, segmentDef, segmentMembers, unassessed, unassessedNote,
  type ClientFacts, type SegmentKey,
} from '../../src/lib/segments';
import { BACK_ICON } from '../../src/ui/direction';

export default function Broadcast() {
  const t = useTheme();
  const router = useRouter();
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  const { allTags, tagsFor, status: tagStatus, reload: reloadTags } = useClientTags();
  const { tenant, refresh: refreshTenant } = useTenant();
  /**
   * What the coach has chosen to write to.
   *
   * Three kinds rather than a nullable string, because they answer to three
   * different reads and the guard has to be handed the right one. A tag is only
   * as good as `tagStatus`; a computed segment is only as good as the read its
   * definition names; "everybody" is only as good as the roster, which is
   * checked separately in every case.
   */
  type Selection =
    | { kind: 'all' }
    | { kind: 'tag'; tag: string }
    | { kind: 'seg'; key: SegmentKey };
  const [sel, setSel] = useState<Selection>({ kind: 'all' });
  const def = sel.kind === 'seg' ? segmentDef(sel.key) : null;
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * `busy`, held where a second tap in the same frame can actually see it.
   *
   * `if (… || busy) return` below is React state read inside a handler that
   * then awaits, so the guard only holds if a re-render lands BETWEEN two taps.
   * It does not on a double tap, and what gets through is not a wasted request:
   * `sendCoachMessages` is a per-client `messages` insert plus a push, so the
   * second run puts the coach's words in every thread a second time and rings
   * every handset again. There is nothing on the server that would collapse
   * them — this screen's own retry note says why that matters: it "would look,
   * from their side, like their coach repeating themselves".
   */
  const sending = useRef(false);
  // The clients this screen tried to write to and could not. Held so the
  // recipient list can name them and the retry can go to exactly them — a coach
  // told "8 of 12 went through" and nothing else has no way to reach the four.
  const [failed, setFailed] = useState<string[]>([]);

  /* ── the two source reads, and why they are lazy ──────────────────────────
   *
   * Drift costs four queries and packs costs five (see readClientActivity and
   * fetchClientPurchases). A coach writing to everybody, or to a tag, needs
   * neither, and this is a composer — the screen has to be usable the instant
   * it opens. So a source is read the first time a segment built on it is
   * selected, and never again in that sitting.
   *
   * Null is NOT 'ready'. A source that has not been asked for holds no answer,
   * and the moment a segment on it is chosen the status becomes 'loading' — so
   * the guard says "Reading who that is…" and the send is held, which is
   * exactly what a segment whose membership is unknown deserves.
   */
  const [drift, setDrift] = useState<{ status: LoadStatus; byId: Map<string, StatusLevel | null> } | null>(null);
  const [packs, setPacks] = useState<{ status: LoadStatus; byId: Map<string, { left: number | null; runOut: boolean }> } | null>(null);
  // Started, so an effect that fires twice does not read twice. A ref rather
  // than the state above: the state is set asynchronously and two renders in
  // the same tick would both see null.
  const asked = useRef<{ drift: boolean; packs: boolean }>({ drift: false, packs: false });
  // Bumped by the pull below, and in the selection effect's dependency array.
  // Clearing `asked` on its own would not be enough: it is a ref, so nothing
  // re-runs on the strength of it, and whether the effect fired again would
  // depend on the roster provider happening to hand back a new array.
  const [sourceNonce, setSourceNonce] = useState(0);

  const readDrift = useCallback(async (ids: string[], tenantId: string | undefined) => {
    setDrift({ status: 'loading', byId: new Map() });
    try {
      const read = await readClientActivity(supabase, ids, { tenantId });
      const notAsked = new Set(read.notAsked);
      const inputs: DriftInput[] = ids.map((id) => ({ clientId: id, events: read.byClient[id] ?? [] }));
      const byId = new Map<string, StatusLevel | null>();
      for (const d of rankClients(inputs)) {
        // A client the database was never asked about holds NO assessment. Their
        // empty event list is the absence of a question, not the absence of
        // activity, and letting it fall through as 'idle' would put every
        // hand-added client at the top of a list of people to chase — people who
        // have no thread to be chased in.
        byId.set(d.clientId, notAsked.has(d.clientId) ? null : d.status);
      }
      // Truncated is 'partial' and 'partial' holds the send. The rows past the
      // ceiling are exactly the ones that would disprove somebody's silence.
      setDrift({ status: read.truncated ? 'partial' : 'ready', byId });
    } catch (e) {
      reportError('broadcast.drift', e);
      setDrift({ status: 'error', byId: new Map() });
    }
  }, []);

  const readPacks = useCallback(async () => {
    setPacks({ status: 'loading', byId: new Map() });
    try {
      const { rows, status } = await fetchClientPurchases();
      const byId = new Map<string, { left: number | null; runOut: boolean }>();
      for (const r of rows) {
        const cid = r.client_id;
        if (!cid) continue;
        // `packLeft` per ROW, summed per PERSON — and deliberately not
        // `packRunOut` per row. `packRunOut` asks whether one pack is spent,
        // which is the right question on a payments screen listing packs. Here
        // the question is whether the CLIENT has a session to draw on, and a
        // client with one exhausted pack and one they bought yesterday has
        // plenty. Addressing them as "your pack has run out" would be wrong
        // about the person on the strength of a fact about a row.
        const left = packLeft({ sessions_total: r.sessions_total, sessions_used: r.sessions_used, status: r.status });
        if (r.status !== 'paid' || left === null) continue;
        const cur = byId.get(cid) ?? { left: null, runOut: false };
        byId.set(cid, { left: (cur.left ?? 0) + left, runOut: false });
      }
      // Run out only once every paid pack they hold is counted. Done after the
      // loop for that reason: mid-loop the total is a prefix of their packs.
      for (const [cid, v] of byId) byId.set(cid, { left: v.left, runOut: v.left === 0 });
      setPacks({ status, byId });
    } catch (e) {
      reportError('broadcast.packs', e);
      setPacks({ status: 'error', byId: new Map() });
    }
  }, []);

  useEffect(() => {
    if (!def) return;
    // Nothing is read until the roster is whole. Assessing a page of a coach's
    // book would produce a segment sized by the read, which is the defect this
    // whole screen is built against.
    if (rosterStatus !== 'ready') return;
    if (def.source === 'drift' && !asked.current.drift) {
      asked.current.drift = true;
      void readDrift(roster.map((c) => c.id), tenant?.id);
    }
    if (def.source === 'packs' && !asked.current.packs) {
      asked.current.packs = true;
      void readPacks();
    }
  }, [def, rosterStatus, roster, tenant?.id, readDrift, readPacks, sourceNonce]);

  /* ── pull to refresh ─────────────────────────────────────────────────────
   *
   * This screen decides who a message goes to, and every input to that decision
   * is a read that can be refused: the roster, the tag map the segment chips
   * are built from, the gym the activity query is scoped by, and — for the two
   * computed segments — the drift or the packs read behind them.
   *
   * The segment read is asked for again only if it has already been asked once.
   * `asked` exists to stop the effect firing the same expensive read on every
   * render, and clearing it here rather than calling the reads directly means
   * the refresh goes back through the same 'roster must be whole' gate: a
   * refresh that ran the drift read against a partial roster would assess a
   * page of the coach's book and size a segment by the read, which is the
   * defect this whole screen is built against. */
  const pull = usePullToRefresh(useCallback(() => {
    asked.current = { drift: false, packs: false };
    setSourceNonce((n) => n + 1);
    return Promise.all([refreshRoster(), Promise.resolve(reloadTags()), Promise.resolve(refreshTenant())]);
  }, [refreshRoster, reloadTags, refreshTenant]));

  /** Everything a segment asks about one client, in the roster's own order. */
  const facts: ClientFacts[] = useMemo(() => roster.map((c) => {
    const p = packs?.byId.get(c.id);
    return {
      clientId: c.id,
      drift: drift ? drift.byId.get(c.id) ?? null : null,
      packLeft: p?.left ?? null,
      packRunOut: p?.runOut ?? false,
      adherence: c.adherence,
    };
  }), [roster, drift, packs]);

  const recipients = useMemo(() => {
    if (sel.kind === 'all') return roster;
    if (sel.kind === 'tag') return roster.filter((c) => tagsFor(c.id).includes(sel.tag));
    if (!def) return [];
    const ids = new Set(segmentMembers(def, facts));
    return roster.filter((c) => ids.has(c.id));
  }, [roster, sel, def, tagsFor, facts]);

  /** How many people the chosen segment's source could not answer for. Only
   *  ever non-zero for a drift segment; see `unassessed`. */
  const notAssessed = useMemo(
    () => (def ? unassessed(def, facts).length : 0), [def, facts]);

  // Reads as the object of a sentence, because it is one: the guard writes
  // "Only part of … came back". "all of your clients" turns that into "part of
  // all of your clients", which is a sentence nobody would say out loud. A
  // computed segment brings its own noun phrase for the same reason — "part of
  // the Drifting segment" says less than "part of who has drifted".
  const segmentLabel = sel.kind === 'tag'
    ? `the “${sel.tag}” segment`
    : def ? def.object : 'your client list';

  /* Whether the LIST is trustworthy, as distinct from whether the send worked.
   *
   * Two reads, and both are load-bearing. The roster says who exists; the second
   * says who is in the segment. For a tag that is `tagStatus` — with tags unread
   * every `tagsFor()` comes back empty so a chosen tag matches nobody, which
   * renders identically to a tag that genuinely has nobody in it. For a computed
   * segment it is the status of the read its definition names, and that one
   * matters MORE: an unread tag matches nobody and the coach sees a zero, but a
   * part-read activity table produces a plausible smaller group and the coach
   * sees a number they have no reason to doubt.
   *
   * A source that has not been asked for yet is 'loading' rather than 'ready'.
   * A segment nobody has computed has no members, and "0 recipients" is not the
   * answer to a question that has not been put. */
  const sourceStatus: LoadStatus = !def
    ? (sel.kind === 'tag' ? tagStatus : 'ready')
    : def.source === 'roster' ? 'ready'
    : def.source === 'drift' ? (drift?.status ?? 'loading')
    : (packs?.status ?? 'loading');
  const claim = guardRecipients(rosterStatus, sourceStatus, segmentLabel);
  // The count the coach reads on the button. It is only a count when the read
  // behind it was whole — under any other status the button is withheld anyway,
  // and this is what stops the number being rendered as a fact in the meantime.
  const countable = claim.allowed;
  const bookUnread = rosterStatus === 'error';
  const bookShort = rosterStatus === 'partial';
  const segUnreliable = sel.kind !== 'all' && (sourceStatus === 'error' || sourceStatus === 'partial');
  const nameOf = (id: string) => roster.find((c) => c.id === id)?.name.split(' ')[0] ?? 'A client';

  /**
   * Write the message into every recipient's own thread.
   *
   * `ids` is passed in rather than read from `recipients` so that RETRY sends to
   * exactly the threads that failed, and not to the segment all over again —
   * re-sending to the eight who already got it would put the same words in
   * their thread twice and look, from their side, like their coach repeating
   * themselves.
   */
  const deliver = async (ids: string[]) => {
    const b = body.trim();
    // Synchronous, before anything awaits — see `sending`. `busy` is kept in
    // the test beside it so the control still refuses while a re-render is
    // pending for any other reason.
    if (!b || !ids.length || busy || sending.current) return;
    sending.current = true;
    try {
      await deliverOnce(ids, b);
    } finally {
      sending.current = false;
    }
  };

  const deliverOnce = async (ids: string[], b: string) => {
    // Refuse rather than warn. A message cannot be taken back, and "send to
    // everybody" written against a list we could not read whole is not a
    // smaller version of the thing the coach asked for.
    if (!claim.allowed) { Alert.alert(claim.label as string, claim.reason as string); return; }
    setBusy(true);
    try {
      const results = await sendCoachMessages(ids, b);
      const outcomes: WriteOutcome[] = results.map((r) => ({
        clientId: r.clientId, name: nameOf(r.clientId), ok: r.ok, why: r.why,
      }));
      const report = bulkReport('message', outcomes);
      setFailed(report.retry);
      // The composer is only cleared when there is nothing left to send. A
      // coach whose message half-landed needs the words still in the box —
      // retyping them is how the second attempt ends up differently worded from
      // the first, in the threads of the people who got both.
      if (!report.retry.length) setBody('');
      Alert.alert(report.title, report.body);
    } catch {
      Alert.alert('Not Sent', 'The message could not be written to your clients’ threads. Nothing was sent. Check your connection and try again.');
    } finally { setBusy(false); }
  };
  const send = () => deliver(recipients.map((c) => c.id));

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: sp.md + 2, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your clients</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Broadcast</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Send one message to a whole segment of your clients.</Text>

        {/* ── the segment ──────────────────────────────────────────────────
            Two rows, because they are two different kinds of claim. The top row
            is what somebody wrote down: everybody, or a tag a coach has to keep
            up to date by hand. The bottom row is what the app worked out this
            morning, and each of those carries a read that can fail — which is
            why selecting one can hold the send while the read lands, and why
            the meaning of the band is spelled out under the recipient list
            rather than left to the two words on the chip. */}
        <Section>
          <SectionHead title="Send To" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
            {chip('All clients', sel.kind === 'all', () => setSel({ kind: 'all' }))}
            {allTags.map((tg) => chip(tg, sel.kind === 'tag' && sel.tag === tg,
              () => setSel(sel.kind === 'tag' && sel.tag === tg ? { kind: 'all' } : { kind: 'tag', tag: tg })))}
          </ScrollView>

          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>
            Worked out from their record, not from a tag you keep up to date
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
            {COMPUTED_SEGMENTS.map((d) => chip(d.title, sel.kind === 'seg' && sel.key === d.key,
              () => setSel(sel.kind === 'seg' && sel.key === d.key ? { kind: 'all' } : { kind: 'seg', key: d.key })))}
          </ScrollView>
        </Section>

        <Rule />

        {/* ── who that is ────────────────────────────────────────────────── */}
        <Section>
          {/* The count is a count, so it waits for a whole read of both the
              roster and the tags. Under anything else it is the size of what
              loaded, and printing it beside the word "Recipients" is what made
              a send to two thirds of a segment look complete. */}
          <SectionHead title="Recipients" note={countable && recipients.length ? `${recipients.length}` : undefined} />
          {bookUnread ? (
            <Notice tone={t.warn} kicker="Roster" title="Your client list could not be read"
              note="Nobody is listed below because the roster did not come back. This is not an empty book, and nothing can be sent until it loads." />
          ) : bookShort ? (
            <Notice tone={t.warn} kicker="Roster" title="This is part of your book"
              note="Your roster came back at its row limit, so anyone past the point it stopped is not in this list and would not receive the message. The send is held rather than going to the part that loaded — a message cannot be taken back, and nothing afterwards would say who had been left out." />
          ) : segUnreliable ? (
            <Notice tone={t.warn} kicker={sel.kind === 'tag' ? 'Tags' : 'Segment'}
              title="This segment could not be read in full"
              note={sel.kind === 'tag'
                ? 'Your client tags did not all come back, so somebody in this segment may be missing from the list below and the send is held until they load.'
                : `What decides ${segmentLabel} did not all come back, so this list is the size of the read rather than the size of the segment — and there is nothing on it to say which. The send is held until it loads.`} />
          ) : null}

          {/* What the band actually means, said before the names rather than
              after them. "Drifting" is a threshold this app chose and a coach
              about to write to the people under it is entitled to know which.
              A tag needs no such sentence: the coach wrote it. */}
          {def ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{def.note}</Text>
          ) : null}

          {/* The people the segment's source could not answer for. Said out
              loud because otherwise the count is quietly smaller than the
              coach's book with nothing anywhere explaining the gap. */}
          {def && unassessedNote(def, notAssessed) ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{unassessedNote(def, notAssessed)}</Text>
          ) : null}
          {/* Every name, not the first two. This list is the last thing between
              the coach and N irreversible writes, and the `numberOfLines={2}`
              that used to be on it cut the list off at exactly the point where
              the count and the visible names stop agreeing — which is where
              somebody checks whether a specific person is in it. */}
          {recipients.length === 0 && claim.allowed ? (
            /* Only over a whole read of both. An empty recipient list while the
               activity or purchase read is still in flight is not an empty
               segment, and "No clients in this segment" is the app answering a
               question nobody has finished putting. Under anything but 'ready'
               the guard's own sentence is already on screen, further down. */
            <Text style={{ ...ty.label, color: t.ink3 }}>No clients in this segment.</Text>
          ) : recipients.length === 0 ? null : (
            <Text style={{ ...ty.body, color: t.ink2 }}>{recipients.map((c) => c.name).join(', ')}</Text>
          )}

          {/* Who it did not reach last time. Named, and still here, so the retry
              below is about people rather than about a number. */}
          {failed.length ? (
            <Notice tone={t.warn} kicker="Not delivered" title={`${failed.length} did not get the last one`}
              note={`${listNames(failed.map(nameOf))} — nothing was written to their thread. Clients you added by hand have no account to message until they join.`} />
          ) : null}
        </Section>

        <Rule />

        {/* ── the message ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Message" />
          <TextInput value={body} onChangeText={setBody} placeholder="Your message…" placeholderTextColor={t.ink3} multiline
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 120, textAlignVertical: 'top', marginBottom: sp.md }} />

          {/* What the client will actually see, said to the coach and not added
              to the message. The full argument is on `bulkThreadNote`: appending
              "sent to 12 clients" to the body would put words the coach did not
              write into a message signed by the coach, and a badge outside it
              would need a column this app cannot keep honest — a coach pasting
              the same words into twelve threads by hand produces twelve
              unbadged messages, so an absent badge would come to mean "written
              for you". The coach is the only person who can decide whether
              these words should say they went to everyone, and the box above is
              where they say it. */}
          {claim.allowed && bulkThreadNote(recipients.length) ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{bulkThreadNote(recipients.length)}</Text>
          ) : null}
          {!claim.allowed && claim.reason ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{claim.reason}</Text>
          ) : null}

          {/* Withheld, not warned about. The count on this button is the whole
              of what the coach is consenting to, so it is only allowed to be a
              number when the reads behind it came back whole. */}
          <View style={{ opacity: claim.allowed ? 1 : 0.4 }} pointerEvents={claim.allowed ? 'auto' : 'none'}>
            <Cta label={busy ? 'Sending…' : claim.label ?? `Send to ${recipients.length}`} wide
              disabled={!body.trim() || !recipients.length || busy || !claim.allowed} onPress={send} />
          </View>

          {/* Retry goes to the threads that failed and to no others. Sending to
              the segment again would put the same words a second time in the
              thread of everybody it already reached. */}
          {failed.length && !busy ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost label={`Try the ${failed.length} That Failed Again`} onPress={() => deliver(failed)} />
            </View>
          ) : null}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
