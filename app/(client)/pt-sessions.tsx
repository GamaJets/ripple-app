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
// package credit. A credit is redeemed when the session is BOOKED, in
// calendar.tsx.
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

const fmt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

export default function PtSessions() {
  const t = useTheme();
  const router = useRouter();
  // The balance below is handled with three states and a written explanation of
  // why; the DELIVERED SESSIONS list beside it read `sessions` and dropped the
  // provider's `status` on the floor. So a refused read printed "Nothing to
  // approve right now." to a client with three sessions waiting on them — and
  // the coach on the other side, whose pay depends on those approvals, has no
  // way of telling that from a client who simply has not looked.
  const { sessions, status: sessionStatus, approveSession, disputeSession } = useSessions();
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
    Alert.alert('Approved', 'Your trainer can see this. Package credits are drawn when a session is booked, not here.');
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

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
