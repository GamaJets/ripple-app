// Client · Personal training. Sessions your trainer has already delivered, and
// the ones you have confirmed. Mirrors the "sessions delivered → approve" flow
// gyms use.
//
// Approving used to write one flag to AsyncStorage on this device and nothing
// else, and the comment box beside it was never read by anything at all — the
// text went into React state and died there. Both now go to Supabase through
// the `approve_session` RPC, and the trainer sees the confirmation and the
// comment on their calendar.
//
// Still true, and still worth saying on screen: approving does not spend a
// package credit.
//
// WHEN one is spent is no longer a single sentence, and this screen no longer
// pretends otherwise. Since supabase/parts/370 there are three answers — a
// one-off the client books draws at booking, a standing appointment and a
// one-off the coach or the gym books draw at delivery, and a gym-sold PT pass
// always draws at delivery — so the copy here points at the ledger
// (app/(client)/session-credits.tsx) instead of naming a moment that is right
// for one route in three.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero, cards spent only on the sessions you can act
// on, and a coloured dot beside ink text where "Approved ✓" used to be painted
// in the reserved `good` colour.
//
// ── The answer that was missing ────────────────────────────────────────────
//
// This screen offered ONE control: Approve Session. There was no decline, no
// query, no "this didn't happen" — and the coach's pay hangs on that approval,
// which made silence the member's only form of objection. Silence is
// unreadable: a client who was never there and a client who has not opened the
// app produce byte-identical records, so the coach could not tell a dispute
// from a forgetful client and the member could not say the thing they meant.
//
// A dispute is now its own answer (supabase/parts/241, src/lib/sessionDispute).
// THE LOAD-BEARING PART IS WHAT IT DOES NOT DO. It writes to
// `session_approvals` and to nothing else: it does not set `sessions.outcome`,
// which is what payroll reads, so it changes nothing about what the coach is
// paid and it returns no pack credit — the credit came off when the session was
// booked. Every screen here says so before and after the tap, because the gap
// between what a member thinks "Dispute" does and what it does is where the
// next complaint comes from.
//
// A session is in exactly one of three lists, decided by `verdictOf` and never
// by `!approvedAt`. A dispute has NO approval timestamp, so the old branch
// would have put one straight back into "Awaiting Your Approval", which is the
// one place it must never appear.
import { useMemo, useState, useEffect, useCallback } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, TextInput, Alert, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Card, Cta, Ghost, ListRow, Hero, Flag, PartialRead, fig } from '../../src/ui/kit';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, radius, hairline, elevation, type as ty, numeric } from '../../src/theme/scale';
import {
  verdictOf, actionsFor, disputeConfirm, disputeFiledLine, disputedSummary,
  DISPUTE_OPTIONS, DISPUTE_MONEY_NOTE, type DisputeKind,
} from '../../src/lib/sessionDispute';
import { useSessions } from '../../src/ui/sessions';
import { useClientData } from '../../src/ui/clientData';
import { sessionPacks } from '../../src/lib/connect';
// The record of what became of each session, as opposed to what the member said
// about it. See the note on the "What Already Happened" section below for why
// those are two different lists and not one.
import {
  pastSessions, pastVerdict, readBoundary, emptyHistoryLine,
  PAST_STATE_LABEL, PAST_STATE_NOTE, CLIENT_CANCELLED_GAP_NOTE,
  type PastState,
} from '../../src/lib/sessionHistory';
import { appLocale } from '../../src/lib/locale';
import type { Theme } from '../../src/theme/tokens';

/**
 * The date and time beside Approve and Dispute.
 *
 * Two things were wrong with the line this replaces, and they were on the one
 * screen where the member is being asked to agree that an hour was delivered.
 *
 *   · `d.toLocaleDateString()` with no locale and `toLocaleTimeString([], …)`
 *     with an empty one. Both are the device's, which is right today — but the
 *     `dayLabel` twelve lines down already goes through `appLocale()` and says
 *     why in its own comment, so the same screen was formatting two dates two
 *     ways, and `check:locale` exists because that is how "14 Aug" and
 *     "Aug 14" came to sit in the same view.
 *   · No NaN guard. `new Date('')` is an Invalid Date and every one of those
 *     calls returns the literal "Invalid Date", so a session whose start time
 *     did not parse rendered "Invalid Date · Invalid Date" over an Approve
 *     button — and a member cannot approve an hour they cannot identify. A dash
 *     is the honest version: it says nothing rather than saying nonsense, and
 *     `dayLabel` already answers this shape the same way.
 */
const fmt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
};
/** A bare day, for the sentence naming how far back the record has been read.
 *  Through `appLocale()` like every other formatted date in this app — a
 *  hardcoded tag is what `check:locale` exists to refuse. */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The mark beside a past session, never the colour of its text.
 *
 * House rule: `t.crit`/`t.warn`/`t.good` are marks, so each of these is a 6pt
 * dot with the label rendered in ink beside it. 'unmarked' takes `warn` because
 * it is the state that asks somebody to look — the same state that blocks a
 * payroll settlement in src/lib/gymSessions.ts — and a plain cancellation takes
 * the neutral ink3, because it is a thing that happened rather than a problem.
 */
const stateTone = (t: Theme, s: PastState): string => {
  switch (s) {
    case 'delivered': return t.good;
    case 'missed': return t.crit;
    case 'late_cancelled': return t.warn;
    case 'cancelled': return t.ink3;
    case 'unmarked': return t.warn;
  }
};

export default function PtSessions() {
  const t = useTheme();
  const router = useRouter();
  // The balance below is handled with three states and a written explanation of
  // why; the DELIVERED SESSIONS list beside it read `sessions` and dropped the
  // provider's `status` on the floor. So a refused read printed "Nothing to
  // approve right now." to a client with three sessions waiting on them — and
  // the coach on the other side, whose pay depends on those approvals, has no
  // way of telling that from a client who simply has not looked.
  const { sessions, status: sessionStatus, approveSession, disputeSession, refresh: refreshSessions } = useSessions();
  const sessionsWhole = isWhole(sessionStatus);
  const c = useClientData();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Which session the "what is wrong with it" sheet is open for, or null.
  const [disputeFor, setDisputeFor] = useState<string | null>(null);

  // ── the balance, on the screen where somebody is thinking about sessions ──
  //
  // This screen has always sent people to /packages to find out what is left,
  // which is the wrong place to make them look: it is the screen where they
  // approve the sessions that were delivered, so it is the screen where "and
  // how many have I got left" is the next thought.
  //
  // Three states, not two. `left` is `number | null`, and `sessionsRemaining`
  // returns null for a count it could not read — never a fabricated zero. That
  // distinction is the whole reason this is not `useState(0)`:
  //
  //   'loading'  first read still in flight — no figure yet.
  //   number     the database's count. 0 is real and is stated plainly.
  //   null       we could not read it. A dash, and a sentence saying so, so a
  //              client holding ten credits is never shown a zero.
  const [left, setLeft] = useState<number | null>(null);
  // Whether any session pack has EVER been bought, which is a different
  // question from how many sessions are left on one and was being answered with
  // the same number. `packBalance` returns a real 0 for a member with no
  // purchases at all, so this screen greeted everybody — including somebody
  // with no coach — with "0 · Nothing left on a pack" and an amber "Buy
  // another". Both sentences describe a pack that never existed.
  const [hasPacks, setHasPacks] = useState(false);
  const [leftRead, setLeftRead] = useState(false);
  const loadLeft = useCallback(async () => {
    const b = await sessionPacks();
    setLeft(b?.left ?? null); setHasPacks((b?.lines.length ?? 0) > 0); setLeftRead(true);
  }, []);
  useEffect(() => { loadLeft(); }, [loadLeft]);

  // Two reads: the sessions themselves — including which of them a coach has
  // marked and this member has yet to approve — and the pack balance above
  // them. A session marked delivered while this screen was open is exactly the
  // thing somebody pulls down to see.
  const pull = usePullToRefresh(useCallback(() => {
    void refreshSessions(); void loadLeft(); c.reload();
  }, [refreshSessions, loadLeft, c.reload]));

  const mine = useMemo(() => sessions
    .filter((s) => s.clientId === c.id && s.status === 'booked' && Date.parse(s.startsAt) <= Date.now())
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)), [sessions, c.id]);
  // `verdictOf`, not `!approvedAt`. A disputed session carries no approval
  // timestamp, so the old test would have shown it as still awaiting approval —
  // telling the member their objection went nowhere, and the coach that nobody
  // had answered.
  const verdict = (s: { approvalState?: string | null; approvedAt?: string | null }) =>
    verdictOf({ state: s.approvalState ?? null, approvedAt: s.approvedAt ?? null });
  const pending = mine.filter((s) => verdict(s) === 'none');
  const done = mine.filter((s) => verdict(s) === 'approved');
  const disputed = mine.filter((s) => verdict(s) === 'disputed');

  /* ── the record, as distinct from the answer the member gave to it ────────
   *
   * The three lists above are sorted by the MEMBER'S verdict: approved,
   * disputed, or not answered. That is the right shape for the thing this
   * screen does, and it is not a history. A session the coach marked as a
   * no-show and a session nobody has marked at all both sit under "Awaiting
   * Your Approval", identically, because `verdictOf` is not asked what
   * happened — only what the member said.
   *
   * `sessions.outcome` is what happened, and it has been readable on these rows
   * since supabase/parts/33 (the row mapper in src/ui/sessions.tsx was throwing
   * it away; it no longer does). So this list is the same sessions ordered by
   * time with the record beside each, and the member's own verdict shown next
   * to it rather than instead of it. Where they disagree — the coach recorded
   * delivered, the member disputed — BOTH are on the row. Neither is edited.
   *
   * `mine` cannot be reused: it filters `status === 'booked'`, which drops any
   * row whose slot state moved after the fact, and dropping a cancellation from
   * a history is precisely what supabase/parts/195 argues against.
   */
  const history = useMemo(
    () => pastSessions(sessions.filter((s) => s.clientId === c.id)),
    [sessions, c.id],
  );
  /* How far back these rows actually reach. The provider reads newest-first and
   * capped (src/lib/rowCap.ts), so under 'partial' the cut is at the OLD end of
   * the member's record — and the screen has to say where, or a member who
   * trained through 2024 reads a list that starts in 2025 as their whole
   * history with the gym. */
  const historyEdge = readBoundary(history, sessionStatus === 'partial');

  const approve = async (id: string) => {
    setBusy(id);
    const r = await approveSession(id, note[id]);
    setBusy(null);
    // Three answers, not two. A queued approval is on this phone and goes on
    // its own — not a failure, and heading it "Not approved" would send
    // somebody back to tap the button again from the same dead spot at
    // reception. The note is cleared either way, because the words are in the
    // queued intent and leaving them in the box would send them twice.
    if (r.queued) {
      setNote((p) => ({ ...p, [id]: '' }));
      Alert.alert('Waiting to send', r.error || 'This is saved on this phone and goes up when you are back online.');
      return;
    }
    if (!r.ok) { Alert.alert('Not approved', r.error || 'Could not save that. Try again in a moment.'); return; }
    setNote((p) => ({ ...p, [id]: '' }));
    // Approving spends nothing — the credit came off when the session was
    // booked. The balance is re-read anyway rather than left stale, because
    // the number beside this button is the one the client is checking.
    loadLeft();
    Alert.alert('Approved', 'Your trainer can see this. Approving spends nothing. Session Credits shows what actually paid for each one.');
  };

  /**
   * Disputing, in two steps: pick what is wrong, then confirm what it does.
   *
   * The confirm is not ceremony. It is the only place the member is told, before
   * they commit, that this returns no credit and moves no money — and it is
   * repeated afterwards, because somebody reads one line and puts the phone
   * down. Both sentences come from `src/lib/sessionDispute` so this screen and
   * its tests cannot come to say different things about the member's money.
   */
  const dispute = (id: string, kind: DisputeKind) => {
    const cf = disputeConfirm(kind);
    Alert.alert(cf.title, cf.body, [
      { text: 'Not Now', style: 'cancel' },
      { text: 'Dispute', style: 'destructive', onPress: async () => {
        setBusy(id); setDisputeFor(null);
        const r = await disputeSession(id, kind, note[id]);
        setBusy(null);
        if (!r.ok) {
          Alert.alert('Not sent', r.error || 'That did not save, so nothing has been recorded and your coach has not been told.');
          return;
        }
        setNote((p) => ({ ...p, [id]: '' }));
        Alert.alert('Disputed', disputeFiledLine(kind));
      } },
    ]);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Personal Training</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Sessions your trainer has delivered. Approving confirms it with them, and any comment you add goes with it.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── what is left on the pack ────────────────────────────────────
            A figure only when one was actually read. `fig` prints a dash for
            null, so a refused count renders as a dash beside a sentence saying
            we could not read it — never as "0 sessions remaining" to somebody
            who has paid for ten. */}
        {leftRead ? (
          <>
            <Hero label="Sessions Remaining" figure={fig(left)}
              note={left == null ? 'We could not read your balance'
                : left === 0 ? (hasPacks ? 'Nothing left on a pack' : 'You have not bought a session pack')
                : 'Across your active session packs'} />
            {left == null ? (
              <Flag tone={t.crit}>
                We couldn&apos;t read how many sessions you have left. This is not a statement that you
                have none — anything you have paid for is still yours.
              </Flag>
            ) : left === 0 && hasPacks ? (
              // Only somebody who HAS bought a pack can be told to buy another
              // one. Shown to everybody, this warned members with no coach that
              // a session they had not booked was not covered by a pack they
              // had never had.
              <Flag tone={t.warn}>
                Your next session is not covered by a pack. Buy another from your coach, or arrange it
                with them directly.
              </Flag>
            ) : null}
          </>
        ) : null}

        {/* The balance says how many. Which hours used the rest, and which of
            the booked ones are due to draw, are the next two questions and
            they live on the ledger. It reads a gym-sold PT pass and a
            coach-sold pack the same way, so a member assigned a coach by their
            gym gets the same answer as one who buys direct. */}
        <ListRow icon="calendar" title="Session Credits"
          note="Which sessions used a credit, and what your bookings are due to draw"
          onPress={() => router.push('/(client)/session-credits')} />

        {/* The second way into asking, because this is the screen somebody is
            on when they realise there is no session to be seen. The Book screen
            has the other one, beside the open slots it could not offer. The
            note says what it is not, in the row itself, because a row headed
            "Ask for a Time" sitting under a list of credits is otherwise read
            as another way to spend one. */}
        <ListRow icon="calendar" title="Ask for a Time"
          note="Ask your coach for an hour they haven’t opened. It asks — it doesn’t book"
          onPress={() => router.push('/(client)/request-session')} />

        <Rule />

        {/* ── awaiting approval: the only actionable thing here ───────────── */}
        <Section>
          <SectionHead title="Awaiting Your Approval" note={sessionsWhole && pending.length > 0 ? String(pending.length) : undefined} />
          {/* `mine`, not `sessions`. The provider holds every session it could
              read — both parties, every status, cancelled and upcoming included
              — and this screen is about the ones delivered to THIS client
              (`mine`, above). Quoting the provider's count said "Showing the
              first 1,000" to a member with eleven sessions on the screen, which
              reads as a truncation of the eleven. */}
          {sessionStatus === 'partial' ? <PartialRead what="delivered sessions" shown={mine.length} /> : null}
          {pending.map((s) => (
            <Card key={s.id} style={{ marginBottom: sp.md }}>
              <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{fmt(s.startsAt)}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.durationMin} min personal training session</Text>
              <TextInput value={note[s.id] || ''} onChangeText={(v) => setNote((p) => ({ ...p, [s.id]: v }))}
                placeholder="Add a comment for your trainer (optional)…" placeholderTextColor={t.ink3}
                editable={busy !== s.id} multiline
                style={{ ...ty.label, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginTop: sp.md, marginBottom: sp.md }} />
              <Cta label={busy === s.id ? 'Approving…' : 'Approve Session'} wide disabled={busy === s.id}
                a11yLabel={`Approve the ${s.durationMin} minute session on ${fmt(s.startsAt)}`}
                onPress={() => approve(s.id)} />
              {/* The other answer, and deliberately NOT a second primary button:
                  approving is the ordinary case and should stay the emphasised
                  one. What matters is that it is here at all, on the same card,
                  in the same moment — a member who has to go and find the
                  objection somewhere else objects by saying nothing. */}
              {actionsFor('none').dispute ? (
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  <Ghost label="Dispute This Session"
                    a11yLabel={`Dispute the ${s.durationMin} minute session on ${fmt(s.startsAt)}`}
                    onPress={() => setDisputeFor(s.id)} />
                </View>
              ) : null}
            </Card>
          ))}
          {/* "Nothing to approve right now" is a claim about the coach's
              record, not about this screen, and only a whole read may make it. */}
          {pending.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {/* 'partial' fell through to the confident sentence, and it is
                  the one status where a pending session may simply not have
                  come back — leaving a client told nobody is waiting on them
                  while their coach's pay waits on those approvals. */}
              {sessionStatus === 'loading' ? 'Reading your sessions…'
                : sessionStatus === 'error' ? 'We couldn’t read your sessions, so we can’t say whether your coach is waiting on you. Nothing has been approved or declined by this.'
                : !sessionsWhole ? 'You have more sessions on record than we can read at once, so we can’t say whether one is waiting on you. Nothing has been approved or declined by this.'
                : 'Nothing to approve right now.'}
            </Text>
          ) : null}
        </Section>

        {/* ── history ────────────────────────────────────────────────────── */}
        {done.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Approved" note={sessionsWhole ? String(done.length) : undefined} />
              {done.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Text style={{ ...ty.body, ...numeric, color: t.ink2, flex: 1 }}>{fmt(s.startsAt)}</Text>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.good }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>Approved</Text>
                    </View>
                    {s.approvalNote ? (
                      <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>“{s.approvalNote}”</Text>
                    ) : null}
                    {/* An approval is not irreversible. Somebody who signs a
                        session off and then checks their diary must be able to
                        say so, and `actionsFor` is the one place that decides
                        which answers each verdict still offers. */}
                    {actionsFor('approved').dispute ? (
                      <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                        <Ghost label="Dispute This Session"
                          a11yLabel={`Dispute the session on ${fmt(s.startsAt)}, which you approved`}
                          onPress={() => setDisputeFor(s.id)} />
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* ── disputed ────────────────────────────────────────────────────
            Its own list, above nothing and below the approvals, because a
            member who has objected wants to see that the objection is still
            standing. Every row says what was disputed, when, and that nothing
            about the money moved — the sentence is the same one the confirm
            used, from the same module. */}
        {disputed.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Disputed" note={sessionsWhole ? String(disputed.length) : undefined} />
              {disputed.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Text style={{ ...ty.body, ...numeric, color: t.ink2, flex: 1 }}>{fmt(s.startsAt)}</Text>
                      {/* The mark carries the status colour; the text does not. */}
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>Disputed</Text>
                    </View>
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                      {disputedSummary((s.disputeKind as DisputeKind) ?? 'other', s.disputedAt ? fmt(s.disputedAt) : null)}
                    </Text>
                    {s.approvalNote ? (
                      <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>“{s.approvalNote}”</Text>
                    ) : null}
                    {actionsFor('disputed').approve ? (
                      <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                        {/* Approving IS how a dispute is withdrawn — the RPC
                            clears the three dispute columns (part 241) — so
                            there is no separate "withdraw" verb to get out of
                            step with it. */}
                        <Ghost label="Approve It After All"
                          a11yLabel={`Withdraw your dispute and approve the session on ${fmt(s.startsAt)}`}
                          onPress={() => approve(s.id)} />
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{DISPUTE_MONEY_NOTE}</Flag>
            </Section>
          </>
        ) : null}

        {/* ── what already happened ───────────────────────────────────────
            Every past session in one place, newest first, each with what the
            record says became of it and when. Not a filtered view of the three
            lists above: those are sorted by the member's answer, and a member
            who has never opened this screen has no answers at all — so before
            this section a client could see that a session was booked and could
            not see whether their coach had recorded it as delivered, as a
            no-show, or as nothing yet. */}
        <Rule />
        <Section>
          <SectionHead title="What Already Happened"
            note={sessionsWhole && history.length > 0 ? String(history.length) : undefined} />

          {/* Said above the list, not below it. `PartialRead` is the existing
              shape for "this is real but it is not all of it", and it is the
              first thing read rather than a footnote under thirty rows. */}
          {sessionStatus === 'partial' ? <PartialRead what="past sessions" shown={history.length} /> : null}

          {/* Rows under 'error' are whatever this device had before the read
              failed — the provider keeps a cached calendar rather than blanking
              the screen, which is right in a basement gym and wrong to present
              as current. The empty case is handled below by
              `emptyHistoryLine`; this is the other half of the same rule. */}
          {sessionStatus === 'error' && history.length > 0 ? (
            <Flag tone={t.crit}>
              We couldn&apos;t reach the server, so this list is the copy already on this phone. Anything
              recorded since is not on it, and nothing here has been confirmed as still current.
            </Flag>
          ) : null}

          {history.length === 0 ? (
            /* Four statuses, four sentences, and only 'ready' may state that
               nothing has happened. `emptyHistoryLine` holds that rule where a
               test can reach it — an empty history under a failed read telling
               a member their own past is empty is the one outcome this whole
               feature exists to prevent. */
            <Text style={{ ...ty.label, color: t.ink3 }}>{emptyHistoryLine(sessionStatus, 'sessions')}</Text>
          ) : history.map((s, i) => {
            const v = pastVerdict(s);
            return (
              <View key={s.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ paddingVertical: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <Text style={{ ...ty.body, ...numeric, color: t.ink2, flex: 1 }}>{fmt(s.startsAt)}</Text>
                    {/* The tone is the dot. The words stay in ink. */}
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stateTone(t, v.state) }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>{PAST_STATE_LABEL[v.state]}</Text>
                  </View>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                    {PAST_STATE_NOTE[v.state]}
                    {v.at ? ` Recorded ${fmt(v.at)}.` : ''}
                  </Text>
                  {/* The member's own answer, beside the record and never
                      instead of it. A session marked delivered that the member
                      disputed is both things at once, and hiding either half is
                      how one side comes to believe the other agreed. */}
                  {v.disputed ? (
                    <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
                      {disputedSummary((s.disputeKind as DisputeKind) ?? 'other', v.disputedAt ? fmt(v.disputedAt) : null)}
                    </Flag>
                  ) : verdict(s) === 'approved' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.good }} />
                      <Text style={{ ...ty.caption, color: t.ink3 }}>You approved this</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}

          {/* Where the record stops, stated rather than left to be inferred
              from a list that simply ends. Only under 'partial' is there a
              boundary to name; a whole read has none and says nothing, which
              keeps this quiet for every member under the row cap. */}
          {historyEdge.bounded && historyEdge.oldestISO ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              This goes back to {dayLabel(historyEdge.oldestISO)} and no further. Anything before that is on
              the server and has not been read onto this screen, so it is missing here rather than absent
              from your record.
            </Flag>
          ) : null}

          {/* The omission that cannot be closed in this app at all, said out
              loud. `cancel_my_session` (supabase/parts/126) hands the hour back
              by clearing `client_id`, so a booking the member cancelled
              themselves stops being theirs and cannot be read back. A list that
              stayed silent about that would be read as complete. */}
          <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{CLIENT_CANCELLED_GAP_NOTE}</Flag>
        </Section>

        <Rule />

        <Section>
          <ListRow icon="trophy" title="My Packages & Sessions" note="What you have bought and what is left"
            onPress={() => router.push('/(client)/packages')} />
        </Section>
      </ScrollView>

      {/* ── what is wrong with it ───────────────────────────────────────────
          A sheet rather than an alert, because each option carries a sentence
          saying what it covers and an alert cannot show one. Choosing here does
          not commit: the confirm that follows is where the member is told what
          disputing does to their money, and it is the last thing before the
          write. */}
      <Modal visible={!!disputeFor} transparent animationType="slide" onRequestClose={() => setDisputeFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setDisputeFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={{ ...ty.title, color: t.ink }}>What is wrong with this session?</Text>
            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm, marginBottom: sp.lg }}>
              Your coach sees your answer and anything you wrote in the comment box.
            </Text>
            {DISPUTE_OPTIONS.map((o, i) => (
              <View key={o.id}>
                {i > 0 ? <Rule /> : null}
                <Pressable onPress={() => { if (disputeFor) dispute(disputeFor, o.id); }}
                  accessibilityRole="button" accessibilityLabel={o.label} accessibilityHint={o.note}
                  style={{ paddingVertical: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{o.label}</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{o.note}</Text>
                </Pressable>
              </View>
            ))}
            <Rule />
            <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{DISPUTE_MONEY_NOTE}</Flag>
            <Pressable onPress={() => setDisputeFor(null)} accessibilityRole="button"
              accessibilityLabel="Close without disputing anything"
              style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
