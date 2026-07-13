// Client · Reminders (#11). Hydration nudges through the day + custom supplement
// reminders, backed by daily repeating local notifications. Persisted; re-scheduled
// on save. Uses the notifications layer already built — it lights up on the
// notifications-enabled build and no-ops safely before then.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Icon } from '../../src/ui/Icon';
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
        const id = await scheduleDailyReminder('Time to hydrate', 'Sip some water — small and often keeps you on target.', h, 0);
        if (id) newIds.push(id);
      }
    }
    for (const s of supps) {
      const id = await scheduleDailyReminder(s.name, `Reminder: ${s.name}`, s.hour, s.minute);
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
    <Pressable onPress={() => set(val)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: cur === val ? t.brand : t.surface2, borderWidth: 1, borderColor: cur === val ? t.brand : t.ring }}>
      <Text style={{ color: cur === val ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  const num = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, width: 54, textAlign: 'center' } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}><Icon name="back" size={22} color={t.ink2} /></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Reminders</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Gentle daily nudges for hydration and supplements.</Text>

        {!pushAvailable() ? (
          <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 18, flexDirection: 'row', gap: 8 }}>
            <Icon name="bell" size={15} color={t.ink3} />
            <Text style={{ color: t.ink3, fontSize: 12.5, flex: 1, lineHeight: 18 }}>Save your reminders now — they'll start sending once the notifications build installs from TestFlight.</Text>
          </View>
        ) : null}

        {/* Hydration */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: hydration ? 14 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="water" size={17} color={t.brand} /><Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Hydration nudges</Text></View>
            <Pressable onPress={() => setHydration((v) => !v)} style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: hydration ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: hydration ? 'flex-end' : 'flex-start' }} />
            </Pressable>
          </View>
          {hydration ? (
            <View>
              <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Every</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>{seg(2, every, setEvery, '2 hours')}{seg(3, every, setEvery, '3 hours')}{seg(4, every, setEvery, '4 hours')}</View>
              <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Between</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TextInput value={String(startH)} onChangeText={(x) => setStartH(Math.min(23, Math.max(0, parseInt(x, 10) || 0)))} keyboardType="number-pad" style={num} />
                <Text style={{ color: t.ink3 }}>to</Text>
                <TextInput value={String(endH)} onChangeText={(x) => setEndH(Math.min(23, Math.max(0, parseInt(x, 10) || 0)))} keyboardType="number-pad" style={num} />
                <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>{fmt(startH, 0)} – {fmt(endH, 0)}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Supplements */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><Icon name="check" size={16} color={t.brand} /><Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Supplement reminders</Text></View>
          {supps.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.ring }}>
              <Text style={{ color: t.ink2, fontSize: 14, flex: 1 }}>{s.name}</Text>
              <Text style={{ color: t.ink, fontSize: 13, fontWeight: '700', marginRight: 12 }}>{fmt(s.hour, s.minute)}</Text>
              <Pressable accessibilityLabel="Remove reminder" accessibilityRole="button" onPress={() => removeSupp(s.id)} hitSlop={6}><Icon name="minus" size={16} color={t.ink3} /></Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Creatine" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 }} />
            <TextInput value={sh} onChangeText={setSh} keyboardType="number-pad" style={num} />
            <Text style={{ color: t.ink3, fontWeight: '800' }}>:</Text>
            <TextInput value={sm} onChangeText={setSm} keyboardType="number-pad" style={num} />
          </View>
          <Pressable onPress={addSupp} style={{ marginTop: 10, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={15} color={t.ink2} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Add reminder</Text>
          </Pressable>
        </View>

        <Pressable onPress={saveAndSchedule} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save &amp; schedule</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
