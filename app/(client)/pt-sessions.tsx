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
import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Card, Cta, Ghost, ListRow } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useSessions } from '../../src/ui/sessions';
import { useClientData } from '../../src/ui/clientData';

const fmt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

export default function PtSessions() {
  const t = useTheme();
  const router = useRouter();
  const { sessions, approveSession } = useSessions();
  const c = useClientData();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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
    Alert.alert('Approved', 'Your trainer can see this. Package credits are drawn when a session is booked, not here.');
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Personal training</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Sessions your trainer has delivered. Approving confirms it with them, and any comment you add goes with it.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {/* ── awaiting approval: the only actionable thing here ───────────── */}
        <Section>
          <SectionHead title="Awaiting your approval" note={pending.length > 0 ? String(pending.length) : undefined} />
          {pending.map((s) => (
            <Card key={s.id} style={{ marginBottom: sp.md }}>
              <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{fmt(s.startsAt)}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.durationMin} min personal training session</Text>
              <TextInput value={note[s.id] || ''} onChangeText={(v) => setNote((p) => ({ ...p, [s.id]: v }))}
                placeholder="Add a comment for your trainer (optional)…" placeholderTextColor={t.ink3}
                editable={busy !== s.id} multiline
                style={{ ...ty.label, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginTop: sp.md, marginBottom: sp.md }} />
              <Cta label={busy === s.id ? 'Approving…' : 'Approve session'} wide disabled={busy === s.id} onPress={() => approve(s.id)} />
            </Card>
          ))}
          {pending.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>Nothing to approve right now.</Text> : null}
        </Section>

        {/* ── history ────────────────────────────────────────────────────── */}
        {done.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Approved" note={String(done.length)} />
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
          <ListRow icon="trophy" title="My packages & sessions" note="What you have bought and what is left"
            onPress={() => router.push('/(client)/packages')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
