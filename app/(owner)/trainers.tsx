// Owner · Trainers & billing. Live roster of paying trainers: add, re-plan,
// suspend/reactivate, or remove — the platform MRR updates instantly.
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { PLANS } from '../../src/lib/ownerMock';
import { usePlatformTrainers, type PlatformTrainerX } from '../../src/ui/trainers';

const PLAN_NAMES = PLANS.map((p) => p.name);

export default function OwnerTrainers() {
  const t = useTheme();
  const { trainers, activeMrr, addTrainer, removeTrainer, setPlan, toggleSuspend } = usePlatformTrainers();
  const [sel, setSel] = useState<PlatformTrainerX | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState('Pro');

  // Keep the manage sheet in sync with the reactive store.
  const current = sel ? trainers.find((x) => x.id === sel.id) ?? null : null;
  const trials = trainers.filter((x) => x.status === 'trial').length;
  const suspended = trainers.filter((x) => x.status === 'suspended').length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Trainers &amp; billing</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Everyone paying to run Repple</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.brand, borderRadius: 16, padding: 15 }}>
            <Text style={{ color: t.brandInk, fontSize: 12, fontWeight: '700', opacity: 0.85 }}>Platform MRR</Text>
            <Text style={{ color: t.brandInk, fontSize: 24, fontWeight: '800', marginTop: 4 }}>${activeMrr.toLocaleString()}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Trainers</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{trainers.length}</Text>
            <Text style={{ color: t.ink3, fontSize: 11, marginTop: 2 }}>{trials} trial · {suspended} suspended</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Roster</Text>
          <Pressable onPress={() => { setNewName(''); setNewPlan('Pro'); setAddOpen(true); }} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>＋ Add Trainer</Text></Pressable>
        </View>

        {trainers.map((tr) => {
          const susp = tr.status === 'suspended';
          return (
            <Pressable key={tr.id} onPress={() => setSel(tr)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: susp ? 0.55 : 1 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.brand, fontWeight: '800' }}>{tr.name.split(' ').map((x) => x[0]).join('')}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{tr.name}</Text>
                  {tr.status === 'trial' && <View style={{ backgroundColor: 'rgba(250,178,25,0.18)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: t.warn, fontSize: 10, fontWeight: '800' }}>TRIAL</Text></View>}
                  {susp && <View style={{ backgroundColor: 'rgba(208,59,59,0.18)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: t.crit, fontSize: 10, fontWeight: '800' }}>SUSPENDED</Text></View>}
                </View>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{tr.plan} · {tr.clients} clients · since {tr.since}</Text>
              </View>
              <Text style={{ color: susp ? t.ink3 : t.brand, fontWeight: '800', fontSize: 15 }}>${tr.mrr}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>/mo</Text></Text>
            </Pressable>
          );
        })}

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginTop: 8, marginBottom: 10 }}>Plans</Text>
        {PLANS.map((p) => (
          <View key={p.name} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{p.name}</Text><Text style={{ color: t.brand, fontWeight: '800', fontSize: 16 }}>${p.price}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>/mo</Text></Text></View>
            {p.feats.map((f) => <Text key={f} style={{ color: t.ink3, fontSize: 13, marginTop: 3 }}>· {f}</Text>)}
          </View>
        ))}
      </ScrollView>

      {/* Manage trainer */}
      <Modal visible={!!current} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          {current && (
            <View>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize' }}>{current.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 16 }}>{current.clients} clients · ${current.mrr}/mo · since {current.since}</Text>

              <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Plan</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
                {PLAN_NAMES.map((pn) => { const on = current.plan === pn; return (
                  <Pressable key={pn} onPress={() => setPlan(current.id, pn)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                    <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 13 }}>{pn}</Text>
                    <Text style={{ color: on ? t.brandInk : t.ink3, fontSize: 11, marginTop: 2 }}>${PLANS.find((p) => p.name === pn)?.price}</Text>
                  </Pressable>); })}
              </View>

              <Pressable onPress={() => toggleSuspend(current.id)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: current.status === 'suspended' ? t.brand : t.warn, fontWeight: '800' }}>{current.status === 'suspended' ? 'Reactivate trainer' : 'Suspend trainer'}</Text>
              </Pressable>
              <Pressable onPress={() => { const tr = current; Alert.alert('Remove trainer?', `Remove ${tr.name} from the platform?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { removeTrainer(tr.id); setSel(null); } }]); }} style={{ borderColor: t.crit, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: t.crit, fontWeight: '800' }}>Remove Trainer</Text>
              </Pressable>
              <Pressable onPress={() => setSel(null)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Done</Text></Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* Add trainer */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Add Trainer</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>They start on a trial and appear in your billing roster.</Text>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Trainer name" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 }} />
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Plan</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {PLAN_NAMES.map((pn) => { const on = newPlan === pn; return (
              <Pressable key={pn} onPress={() => setNewPlan(pn)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 13 }}>{pn}</Text>
                <Text style={{ color: on ? t.brandInk : t.ink3, fontSize: 11, marginTop: 2 }}>${PLANS.find((p) => p.name === pn)?.price}</Text>
              </Pressable>); })}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Cancel</Text></Pressable>
            <Pressable onPress={() => { if (!newName.trim()) { Alert.alert('Add a name', 'Enter the trainer name.'); return; } addTrainer(newName, newPlan); setAddOpen(false); Alert.alert('Trainer added ✓', `${newName.trim()} is now on your platform.`); }} style={{ flex: 2, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add Trainer</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
