// Client · Reminders (#11). Hydration nudges through the day + custom supplement
// reminders, backed by daily repeating local notifications. Persisted; re-scheduled
// on save. Uses the notifications layer already built — it lights up on the
// notifications-enabled build and no-ops safely before then.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): two
// bordered boxes became hairline-separated sections, the "not on this build
// yet" banner became the screen's one <Notice>. Hooks, state, scheduling and
// persistence are unchanged.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { pushAvailable, scheduleDailyReminder, cancelReminders } from '../../src/ui/pushNotifications';

const KEY = 'repple.reminders';
type Supp = { id: string; name: string; hour: number; minute: number };
type Saved = { hydration: boolean; every: number; startH: number; endH: number; supps: Supp[]; ids: string[] };

const two = (n: number) => String(n).padStart(2, '0');
const fmt = (h: number, m: number) => `${two(((h + 11) % 12) + 1)}:${two(m)} ${h < 12 ? 'AM' : 'PM'}`;
const newId = () => 'r_' + Math.random().toString(36).slice(2, 8);

export default function Reminders() {
  const t = useTheme();
  const router = useRouter();
  const [hydration, setHydration] = useState(true);
  const [every, setEvery] = useState(3);      // hours between hydration nudges
  const [startH, setStartH] = useState(9);
  const [endH, setEndH] = useState(21);
  const [supps, setSupps] = useState<Supp[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [sh, setSh] = useState('08');
  const [sm, setSm] = useState('00');

  useEffect(() => { AsyncStorage.getItem(KEY).then((r) => { if (r) { try { const p: Saved = JSON.parse(r); setHydration(p.hydration); setEvery(p.every); setStartH(p.startH); setEndH(p.endH); setSupps(p.supps || []); setIds(p.ids || []); } catch { /* ignore */ } } }); }, []);

  const addSupp = () => {
    const nm = name.trim(); const h = parseInt(sh, 10); const m = parseInt(sm, 10);
    if (!nm) { Alert.alert('Name it', 'Give the supplement or reminder a name.'); return; }
    if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) { Alert.alert('Check the time', 'Use 24-hour time, e.g. 08 : 00.'); return; }
    setSupps((p) => [...p, { id: newId(), name: nm, hour: h, minute: m }]);
    setName(''); setSh('08'); setSm('00');
  };
  const removeSupp = (id: string) => setSupps((p) => p.filter((x) => x.id !== id));

  const saveAndSchedule = async () => {
    await cancelReminders(ids);       // clear our previous reminders only
    const newIds: string[] = [];
    if (hydration) {
      for (let h = startH; h <= endH; h += every) {
        const id = await scheduleDailyReminder('Time to hydrate', 'Sip some water — small and often keeps you on target.', h, 0, { route: '/(client)/recovery' });
        if (id) newIds.push(id);
      }
    }
    for (const s of supps) {
      const id = await scheduleDailyReminder(s.name, `Reminder: ${s.name}`, s.hour, s.minute, { route: '/(client)/reminders' });
      if (id) newIds.push(id);
    }
    const payload: Saved = { hydration, every, startH, endH, supps, ids: newIds };
    setIds(newIds);
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
    Alert.alert(
      pushAvailable() ? 'Reminders set' : 'Saved',
      pushAvailable()
        ? `You'll get ${newIds.length} daily reminder${newIds.length === 1 ? '' : 's'}${hydration ? ` (hydration every ${every}h from ${fmt(startH, 0)}–${fmt(endH, 0)})` : ''}.`
        : 'Saved. Reminders start sending once the notifications build is installed from TestFlight.'
    );
  };

  const seg = (val: number, cur: number, set: (n: number) => void, label: string) => (
    <Pressable onPress={() => set(val)} style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center', backgroundColor: cur === val ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: cur === val ? '600' : '500', color: cur === val ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  const num = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, width: 54, textAlign: 'center' } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Daily</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Reminders</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>Gentle daily nudges for hydration and supplements.</Text>

        {!pushAvailable() ? (
          <Notice kicker="Not sending yet" title="Save them now, they'll start later"
            note="Your reminders start sending once the notifications build installs from TestFlight." />
        ) : null}

        <Rule />

        {/* Hydration */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: hydration ? sp.lg : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Icon name="water" size={17} color={t.brand} />
              <Text style={{ ...ty.head, color: t.ink }}>Hydration nudges</Text>
            </View>
            <Pressable onPress={() => setHydration((v) => !v)} style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: hydration ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: hydration ? 'flex-end' : 'flex-start' }} />
            </Pressable>
          </View>
          {hydration ? (
            <View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Every</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>{seg(2, every, setEvery, '2 hours')}{seg(3, every, setEvery, '3 hours')}{seg(4, every, setEvery, '4 hours')}</View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Between</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <TextInput value={String(startH)} onChangeText={(x) => setStartH(Math.min(23, Math.max(0, parseInt(x, 10) || 0)))} keyboardType="number-pad" style={num} />
                <Text style={{ ...ty.label, color: t.ink3 }}>to</Text>
                <TextInput value={String(endH)} onChangeText={(x) => setEndH(Math.min(23, Math.max(0, parseInt(x, 10) || 0)))} keyboardType="number-pad" style={num} />
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3, flex: 1 }}>{fmt(startH, 0)} – {fmt(endH, 0)}</Text>
              </View>
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* Supplements */}
        <Section>
          <SectionHead title="Supplement reminders" note={supps.length ? String(supps.length) : undefined} />
          {supps.map((s, i) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{s.name}</Text>
              <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink, marginRight: sp.md }}>{fmt(s.hour, s.minute)}</Text>
              <Pressable accessibilityLabel="Remove reminder" accessibilityRole="button" onPress={() => removeSupp(s.id)} hitSlop={6}><Icon name="minus" size={16} color={t.ink3} /></Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Creatine" placeholderTextColor={t.ink3}
              style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />
            <TextInput value={sh} onChangeText={setSh} keyboardType="number-pad" style={num} />
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink3 }}>:</Text>
            <TextInput value={sm} onChangeText={setSm} keyboardType="number-pad" style={num} />
          </View>
          <View style={{ marginTop: sp.md, alignItems: 'flex-start' }}>
            <Ghost label="Add reminder" icon="plus" onPress={addSupp} />
          </View>
        </Section>

        <Rule />

        <View style={{ marginTop: layout.section }}>
          <Cta label="Save & schedule" onPress={saveAndSchedule} wide />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
