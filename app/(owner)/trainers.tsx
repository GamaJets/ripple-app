// Owner · Trainers. The gym's coaching staff — who they carry and what they
// actually delivered.
//
// This screen used to manage Repple subscriptions: add a trainer, put them on
// Starter/Pro/Studio, suspend them, watch "Platform MRR" update. None of it was
// written anywhere, and none of it is a gym owner's business — those plans are
// what a trainer pays Repple. Now it reads the gym's real roster.
//
// Inviting is kept because it is the one action here that was always real: it
// writes a `trainer_invites` row the invitee accepts in their own app.
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { num } from '../../src/lib/format';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { usePlatformTrainers, type GymTrainer } from '../../src/ui/trainers';
import { useTrainerInvites } from '../../src/ui/trainerInvites';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { parseEmail } from '../../src/lib/csvImport';
import { trainerHealth, gymRollup } from '../../src/lib/ownerAnalytics';

export default function OwnerTrainers() {
  const t = useTheme();
  const router = useRouter();
  const { trainers, loading, status: trainersStatus, sessions30, payroll30, refresh } = usePlatformTrainers();
  // `trainers.length === 0` was read straight off as "the gym has no trainers",
  // and a refused read leaves exactly that. This is the screen where that costs
  // most: an owner with a full roster was shown an empty one and told "No
  // trainers yet. Invite one by email" — an instruction to fix a problem they
  // do not have, on the one screen whose job is to list the staff they employ.
  // Every branch that says something about the roster now asks this first.
  const trainersUnread = trainersStatus === 'error';
  const trainersUnknown = loading || trainersUnread;
  const { tenant } = useTenant();
  // The gym's own currency (`tenants.currency`, part 99), not the operating
  // record's fallback. Null while the tenant is unread, and gymMoney falls back
  // for exactly that window.
  const cur = tenant?.currency ?? null;
  const { sent: sentInvites, sendTrainerInvite, revokeTrainerInvite } = useTrainerInvites();
  const [invOpen, setInvOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  // The invite sheet reports its own outcome rather than closing on hope. See
  // `send` below for what it used to do instead.
  const [invBusy, setInvBusy] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);
  const [sel, setSel] = useState<GymTrainer | null>(null);

  // The sheet closes when the invitation is ON THE SERVER, and not before.
  //
  // This was `await sendTrainerInvite(invEmail); setInvOpen(false);` — the
  // boolean dropped on the floor. Paired with the provider inserting its
  // optimistic row before the network call, a refused invite closed the sheet
  // and left a "Pending" row for somebody who had not been invited: the two
  // halves of one bug, and either half alone would have been survivable. The
  // provider no longer invents the row; this no longer claims it was sent.
  const send = async () => {
    const parsed = parseEmail(invEmail);
    if (!parsed.ok) { setInvErr('Enter the email address they will sign in with.'); return; }
    setInvBusy(true); setInvErr(null);
    const sent = await sendTrainerInvite(parsed.value);
    setInvBusy(false);
    if (!sent) {
      setInvErr(`${parsed.value} has not been invited. Nothing was sent and nothing was saved — check your connection and try again.`);
      return;
    }
    setInvOpen(false); setInvEmail('');
  };

  // Same again: a revoke the server refused used to take the invitation off this
  // screen while leaving it live in the invitee's app, where accepting it still
  // attaches them to the gym.
  const revoke = async (id: string, email: string) => {
    const done = await revokeTrainerInvite(id);
    if (!done) {
      Alert.alert('Not cancelled', `The invitation to ${email} is still open. Nothing changed — try again in a moment.`);
    }
  };

  const current = sel ? trainers.find((x) => x.id === sel.id) ?? null : null;
  const roll = gymRollup(trainers, tenant?.sessionFee ?? null);
  const pending = sentInvites.filter((i) => i.status === 'pending');
  const G = layout.gutter;
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: 30, ...elevation.e2 };
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };

  const riskDot: Record<string, string> = { ok: t.brand, watch: t.warn, high: t.crit, idle: t.ink3 };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coaching staff</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Trainers</Text>
        </View>

        {/* Sessions delivered leads, because it is the number that moves. */}
        <Hero
          label="Sessions Delivered · 30 Days"
          figure={trainersUnknown ? '—' : num(sessions30)}
          note={
            loading ? 'Loading your roster…'
            : trainersUnread ? 'Your roster could not be read'
            : trainers.length === 0 ? 'Invite a trainer and their delivered sessions start counting here.'
            : payroll30 == null
              ? `Across ${trainers.length} trainer${trainers.length === 1 ? '' : 's'} · set a session fee to see what that is worth`
              : `Across ${trainers.length} trainer${trainers.length === 1 ? '' : 's'} · ${gymMoney(payroll30, cur)} at your session fee`
          }
          onPress={() => router.push('/(owner)/revenue')}
        />

        {/* The whole screen is one list and the figures over it, so the reason
            they are all dashes is worth one sentence rather than seven. */}
        {trainersUnread ? (
          <Notice tone={t.warn} kicker="Roster unread"
            title="Your trainers could not be read"
            note="Nothing below is a statement about your staff — an empty roster here means the read failed, not that nobody works for you.">
            <View style={{ marginTop: sp.lg }}>
              <Cta label="Try Again" wide onPress={refresh} />
            </View>
          </Notice>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="Roster" note="Revenue" onPress={() => router.push('/(owner)/revenue')} />
          {/* All three are counts over `trainers`, which is empty under a failed
              read as well as under an empty gym — hence fig() behind the same
              flag rather than String() behind `loading` alone. */}
          <KpiRow items={[
            { label: 'Trainers', value: trainersUnknown ? '—' : fig(roll.trainers) },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(num(roll.clients)) },
            { label: 'Need a Look', value: trainersUnknown ? '—' : fig(roll.atRiskCount) },
          ]} />
          <View style={{ marginTop: sp.xl }}>
            <Cta label="Invite a Trainer by Email" wide onPress={() => { setInvEmail(''); setInvErr(null); setInvOpen(true); }} />
          </View>
        </Section>

        {pending.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Pending Invites" note={String(pending.length)} />
            {pending.map((i, ix) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: ix === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{i.email}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Awaiting sign-up / accept</Text>
                </View>
                <Ghost label="Cancel" onPress={() => { void revoke(i.id, i.email); }} />
              </View>
            ))}
          </Section>
        </>) : null}

        <Rule />

        <Section>
          <SectionHead title="Trainers" note={!trainersUnknown && trainers.length ? `${num(roll.clients)} clients` : undefined} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : trainersUnread ? (
            // Ahead of the empty branch, because they are the same empty array.
            // This one used to fall through to "No trainers yet. Invite one by
            // email", which is the app telling a staffed gym it has no staff.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your roster could not be read, so nobody could be listed. This is a failed read,
              not an empty gym — do not invite anyone on the strength of it.
            </Text>
          ) : trainers.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No trainers yet. Invite one by email — they appear here with their clients and
              delivered sessions as soon as they join.
            </Text>
          ) : trainers.map((tr, ix) => {
            const h = trainerHealth(tr);
            return (
              <Pressable key={tr.id} onPress={() => setSel(tr)} style={{
                flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: ix === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>{tr.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: riskDot[h.risk] }} />
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tr.name}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {tr.clients} client{tr.clients === 1 ? '' : 's'} · {tr.sessions30} session{tr.sessions30 === 1 ? '' : 's'} in 30 days
                  </Text>
                </View>
                <Text style={{ ...value(17), color: t.ink }}>{h.score}</Text>
              </Pressable>
            );
          })}
        </Section>
      </ScrollView>

      {/* ── invite ─────────────────────────────────────────────────────── */}
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={sheet}>
            <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.sm }}>Invite a trainer</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              They join your gym when they accept in their own app.
            </Text>
            <TextInput value={invEmail} onChangeText={(v) => { setInvEmail(v); if (invErr) setInvErr(null); }}
              placeholder="their@email.com" placeholderTextColor={t.ink3}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={input} />
            {invErr ? (
              <Text style={{ ...ty.caption, color: t.warn, marginTop: sp.sm }}>{invErr}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => { setInvErr(null); setInvOpen(false); }} /></View>
              <View style={{ flex: 1 }}><Cta label={invBusy ? 'Sending…' : 'Send Invite'} wide disabled={invBusy} onPress={() => { void send(); }} /></View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── one trainer ────────────────────────────────────────────────── */}
      <Modal visible={!!current} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={sheet}>
            {current ? (() => { const h = trainerHealth(current); return (
              <>
                <Text style={{ ...ty.head, color: t.ink }}>{current.name}</Text>
                <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{h.reason}</Text>
                <KpiRow items={[
                  { label: 'Clients', value: fig(current.clients) },
                  { label: 'Delivered · 30d', value: fig(current.delivered30) },
                  { label: 'Health', value: fig(h.score) },
                ]} />
                {/* Value the confirmed work only. This used to multiply the fee
                    by every booking whose start time had passed, which priced
                    no-shows and slots nobody had cancelled. */}
                {current.unmarked30 > 0 ? (
                  <Notice
                    kicker="Awaiting outcomes"
                    title={`${current.unmarked30} session${current.unmarked30 === 1 ? '' : 's'} need marking before this can be valued.`}
                  />
                ) : tenant?.sessionFee != null ? (
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.lg }}>
                    {gymMoney(current.delivered30 * tenant.sessionFee, cur)} at your {gymMoney(tenant.sessionFee, cur)}/session fee
                  </Text>
                ) : (
                  <Notice kicker="No session fee" title="Set a session fee in Ops to value delivered sessions." />
                )}
                <View style={{ marginTop: sp.xl }}><Ghost label="Close" onPress={() => setSel(null)} /></View>
              </>
            ); })() : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
