// Owner · Trainers & billing. Live roster of paying trainers: add, re-plan,
// suspend/reactivate, or remove — the platform MRR updates instantly.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional, modal, handler and route
// from the previous version is preserved — only the presentation changed:
// platform MRR became the screen's one hero figure, the two stat tiles became a
// hairline-divided KPI row, the bordered roster/plan boxes became hairline
// divided lists, the TRIAL/SUSPENDED status pills became a coloured dot beside
// ink-coloured text (status colour is never text colour), and the Georgia serif
// header is gone. An honest "no trainers yet" line replaces a roster that
// previously rendered as nothing at all when empty.
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { PLANS } from '../../src/lib/ownerMock';
import { usePlatformTrainers, type PlatformTrainerX } from '../../src/ui/trainers';
import { useTrainerInvites } from '../../src/ui/trainerInvites';

const PLAN_NAMES = PLANS.map((p) => p.name);

export default function OwnerTrainers() {
  const t = useTheme();
  const router = useRouter();
  const { trainers, activeMrr, addTrainer, removeTrainer, setPlan, toggleSuspend } = usePlatformTrainers();
  const { sent: sentInvites, sendTrainerInvite, revokeTrainerInvite } = useTrainerInvites();
  const [invOpen, setInvOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [sel, setSel] = useState<PlatformTrainerX | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState('Pro');

  // Keep the manage sheet in sync with the reactive store.
  const current = sel ? trainers.find((x) => x.id === sel.id) ?? null : null;
  const trials = trainers.filter((x) => x.status === 'trial').length;
  const suspended = trainers.filter((x) => x.status === 'suspended').length;

  const pending = sentInvites.filter((i) => i.status === 'pending');
  const G = layout.gutter;
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: 30, ...elevation.e2 };
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };

  const planPicker = (selected: string, onPick: (pn: string) => void) => (
    <View style={{ flexDirection: 'row', gap: sp.sm }}>
      {PLAN_NAMES.map((pn) => { const on = selected === pn; return (
        <Pressable key={pn} onPress={() => onPick(pn)}
          style={{ flex: 1, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
          <Text style={{ ...ty.label, fontWeight: '600', color: on ? t.brandInk : t.ink }}>{pn}</Text>
          <Text style={{ ...ty.caption, ...numeric, color: on ? t.brandInk : t.ink3, marginTop: 2 }}>${PLANS.find((p) => p.name === pn)?.price}</Text>
        </Pressable>); })}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Everyone paying to run Repple</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Trainers &amp; billing</Text>
        </View>

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="Platform MRR"
          figure={'$' + activeMrr.toLocaleString()}
          note={trainers.length
            ? `${trainers.length} trainer${trainers.length === 1 ? '' : 's'} on the platform · suspended trainers don't count`
            : 'Add or invite a trainer and their plan price starts counting here.'}
          onPress={() => router.push('/(owner)/revenue')}
        />

        <Rule />

        <Section>
          <SectionHead title="Roster" note="Revenue" onPress={() => router.push('/(owner)/revenue')} />
          <KpiRow items={[
            { label: 'Trainers', value: String(trainers.length) },
            { label: 'On trial', value: String(trials) },
            { label: 'Suspended', value: String(suspended) },
          ]} />

          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xl }}>
            <View style={{ flex: 1 }}><Ghost label="Invite by email" onPress={() => { setInvEmail(''); setInvOpen(true); }} /></View>
            <View style={{ flex: 1 }}><Cta label="Add trainer" wide onPress={() => { setNewName(''); setNewPlan('Pro'); setAddOpen(true); }} /></View>
          </View>
        </Section>

        {pending.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Pending trainer invites" note={String(pending.length)} />
            {pending.map((i, ix) => (
              <View key={i.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: ix === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{i.email}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Invited to join · awaiting sign-up / accept</Text>
                </View>
                <Ghost label="Cancel" onPress={() => revokeTrainerInvite(i.id)} />
              </View>
            ))}
          </Section>
        </>) : null}

        <Rule />

        <Section>
          <SectionHead title="Trainers" note={trainers.length ? `$${activeMrr.toLocaleString()}/mo active` : undefined} />
          {trainers.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No trainers yet. Add one directly, or invite them by email — they appear here with
              their plan and monthly revenue as soon as they join.
            </Text>
          ) : trainers.map((tr, ix) => {
            const susp = tr.status === 'suspended';
            return (
              <Pressable key={tr.id} onPress={() => setSel(tr)} style={{
                flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: ix === 0 ? 0 : hairline, borderTopColor: t.ring, opacity: susp ? 0.55 : 1,
              }}>
                <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>{tr.name.split(' ').map((x) => x[0]).join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{tr.name}</Text>
                    {tr.status === 'trial' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn }} />
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Trial</Text>
                      </View>
                    ) : null}
                    {susp ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.crit }} />
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Suspended</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{tr.plan} · {tr.clients} clients · since {tr.since}</Text>
                </View>
                <Text style={{ ...value(17), color: susp ? t.ink3 : t.ink }}>
                  ${tr.mrr}<Text style={{ ...ty.caption, color: t.ink3 }}>/mo</Text>
                </Text>
              </Pressable>
            );
          })}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Plans" note="What a trainer pays" />
          {PLANS.map((p, ix) => (
            <View key={p.name} style={{
              paddingVertical: sp.md,
              borderTopWidth: ix === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
                <Text style={{ ...value(17), color: t.ink }}>${p.price}<Text style={{ ...ty.caption, color: t.ink3 }}>/mo</Text></Text>
              </View>
              {p.feats.map((f) => <Text key={f} style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{f}</Text>)}
            </View>
          ))}
        </Section>
      </ScrollView>

      {/* Manage trainer */}
      <Modal visible={!!current} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={sheet}>
          {current && (
            <View>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>{current.name}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.xl }}>{current.clients} clients · ${current.mrr}/mo · since {current.since}</Text>

              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Plan</Text>
              {planPicker(current.plan, (pn) => setPlan(current.id, pn))}
              <View style={{ height: sp.xl }} />

              <Ghost label={current.status === 'suspended' ? 'Reactivate trainer' : 'Suspend trainer'} onPress={() => toggleSuspend(current.id)} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Remove trainer" onPress={() => { const tr = current; Alert.alert('Remove trainer?', `Remove ${tr.name} from the platform?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { removeTrainer(tr.id); setSel(null); } }]); }} />
              <View style={{ height: sp.sm }} />
              <Cta label="Done" wide onPress={() => setSel(null)} />
            </View>
          )}
        </View>
      </Modal>

      {/* Add trainer */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Add trainer</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>They start on a trial and appear in your billing roster.</Text>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Trainer name" placeholderTextColor={t.ink3} style={input} />
          <View style={{ height: sp.lg }} />
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Plan</Text>
          {planPicker(newPlan, setNewPlan)}
          <View style={{ height: sp.xl }} />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setAddOpen(false)} /></View>
            <View style={{ flex: 2 }}>
              <Cta label="Add trainer" wide onPress={() => { if (!newName.trim()) { Alert.alert('Add a name', 'Enter the trainer name.'); return; } addTrainer(newName, newPlan); setAddOpen(false); Alert.alert('Trainer added', `${newName.trim()} is now on your platform.`); }} />
            </View>
          </View>
        </View>
              </KeyboardAvoidingView>
      </Modal>
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setInvOpen(false)} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Invite a trainer</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>They get an invite in the Repple app when they sign in with this email. Accepting joins them to your platform and prompts them to set up their profile.</Text>
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Email</Text>
          <TextInput value={invEmail} onChangeText={setInvEmail} placeholder="trainer@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={input} />
          <View style={{ height: sp.xl }} />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setInvOpen(false)} /></View>
            <View style={{ flex: 2 }}>
              <Cta label="Send invite" wide onPress={() => { const e = invEmail.trim(); if (!e || !e.includes('@')) { Alert.alert('Enter an email', 'Add a valid trainer email address.'); return; } sendTrainerInvite(e); setInvOpen(false); Alert.alert('Invitation sent', e + ' will see your invite when they sign in to Repple.', [{ text: 'Done' }]); }} />
            </View>
          </View>
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
