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
import { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Card, Cta, Ghost, ListRow, Hero, Flag, PartialRead, fig } from '../../src/ui/kit';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useSessions } from '../../src/ui/sessions';
import { useClientData } from '../../src/ui/clientData';
import { sessionsRemaining } from '../../src/lib/connect';

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
  const { sessions, status: sessionStatus, approveSession } = useSessions();
  const sessionsWhole = isWhole(sessionStatus);
  const c = useClientData();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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
  const [leftRead, setLeftRead] = useState(false);
  const loadLeft = useCallback(async () => {
    const n = await sessionsRemaining();
    setLeft(n); setLeftRead(true);
  }, []);
  useEffect(() => { loadLeft(); }, [loadLeft]);

  const mine = useMemo(() => sessions
    .filter((s) => s.clientId === c.id && s.status === 'booked' && Date.parse(s.startsAt) <= Date.now())
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)), [sessions, c.id]);
  const pending = mine.filter((s) => !s.approvedAt);
  const done = mine.filter((s) => s.approvedAt);

  const approve = async (id: string) => {
    setBusy(id);
    const r = await approveSession(id, note[id]);
    setBusy(null);
    if (!r.ok) { Alert.alert('Not approved', r.error || 'Could not save that. Try again in a moment.'); return; }
    setNote((p) => ({ ...p, [id]: '' }));
    // Approving spends nothing — the credit came off when the session was
    // booked. The balance is re-read anyway rather than left stale, because
    // the number beside this button is the one the client is checking.
    loadLeft();
    Alert.alert('Approved', 'Your trainer can see this. Package credits are drawn when a session is booked, not here.');
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
                : left === 0 ? 'Nothing left on a pack'
                : 'Across your active session packs'} />
            {left == null ? (
              <Flag tone={t.crit}>
                We couldn&apos;t read how many sessions you have left. This is not a statement that you
                have none — anything you have paid for is still yours.
              </Flag>
            ) : left === 0 ? (
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
          {sessionStatus === 'partial' ? <PartialRead what="delivered sessions" shown={sessions.length} /> : null}
          {pending.map((s) => (
            <Card key={s.id} style={{ marginBottom: sp.md }}>
              <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{fmt(s.startsAt)}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.durationMin} min personal training session</Text>
              <TextInput value={note[s.id] || ''} onChangeText={(v) => setNote((p) => ({ ...p, [s.id]: v }))}
                placeholder="Add a comment for your trainer (optional)…" placeholderTextColor={t.ink3}
                editable={busy !== s.id} multiline
                style={{ ...ty.label, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginTop: sp.md, marginBottom: sp.md }} />
              <Cta label={busy === s.id ? 'Approving…' : 'Approve Session'} wide disabled={busy === s.id} onPress={() => approve(s.id)} />
            </Card>
          ))}
          {/* "Nothing to approve right now" is a claim about the coach's
              record, not about this screen, and only a whole read may make it. */}
          {pending.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {sessionStatus === 'loading' ? 'Reading your sessions…'
                : sessionStatus === 'error' ? 'We couldn’t read your sessions, so we can’t say whether your coach is waiting on you. Nothing has been approved or declined by this.'
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
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        <Rule />

        <Section>
          <ListRow icon="trophy" title="My Packages & Sessions" note="What you have bought and what is left"
            onPress={() => router.push('/(client)/packages')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
