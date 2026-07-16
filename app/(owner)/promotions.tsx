// Owner · Promotions. Create a promotion and push it to every member. Uses the
// promos store for the code + a member-wide push (all_member_ids RPC, owner-only).
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePromos } from '../../src/ui/promos';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { sendPush } from '../../src/ui/pushNotifications';

export default function Promotions() {
  const t = useTheme();
  const router = useRouter();
  const { promos, addPromo, removePromo } = usePromos();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [disc, setDisc] = useState(20);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const pushToMembers = async (body: string): Promise<number> => {
    if (!USE_SUPABASE) return 0;
    try {
      const { data } = await supabase.rpc('all_member_ids');
      const ids = Array.isArray(data) ? data.map((r: any) => r.user_id).filter(Boolean) : [];
      if (ids.length) sendPush(ids, title.trim() || 'A new offer', body, { route: '/(client)/explore' });
      return ids.length;
    } catch { return 0; }
  };

  const create = async (push: boolean) => {
    const c = code.trim().toUpperCase();
    if (!title.trim() || !c || busy) { Alert.alert('Add details', 'Enter a title and a promo code.'); return; }
    setBusy(true);
    try {
      const res = addPromo(c, disc);
      if (!res.ok) { Alert.alert('Could not create', res.reason || 'Try a different code.'); return; }
      let n = 0;
      const body = (msg.trim() || `${disc}% off with code ${c}`);
      if (push) n = await pushToMembers(body);
      setTitle(''); setCode(''); setMsg('');
      Alert.alert('Promotion created', push ? `“${c}” created and pushed to ${n} member${n === 1 ? '' : 's'}.` : `“${c}” created. Push it to members any time.`);
    } finally { setBusy(false); }
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Promotions</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Create an offer and push it straight to your members.</Text>

        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 20 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 12 }}>New promotion</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title — e.g. Summer Special" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 10 }]} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <TextInput value={code} onChangeText={setCode} placeholder="CODE" autoCapitalize="characters" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10 }}>
              <Pressable onPress={() => setDisc((d) => Math.max(5, d - 5))} hitSlop={8} style={{ paddingHorizontal: 13, paddingVertical: 11 }}><Text style={{ color: t.brand, fontWeight: '900', fontSize: 16 }}>−</Text></Pressable>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14, minWidth: 42, textAlign: 'center' }}>{disc}%</Text>
              <Pressable onPress={() => setDisc((d) => Math.min(80, d + 5))} hitSlop={8} style={{ paddingHorizontal: 13, paddingVertical: 11 }}><Text style={{ color: t.brand, fontWeight: '900', fontSize: 16 }}>+</Text></Pressable>
            </View>
          </View>
          <TextInput value={msg} onChangeText={setMsg} placeholder="Push message (optional)" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 14 }]} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => create(false)} disabled={busy} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13.5 }}>Save</Text></Pressable>
            <Pressable onPress={() => create(true)} disabled={busy} style={{ flex: 2, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13.5 }}>{busy ? 'Working…' : 'Create & push to members'}</Text></Pressable>
          </View>
        </View>

        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Active promotions</Text>
        {promos.map((p) => (
          <View key={p.id} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, letterSpacing: 1 }}>{p.code}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{p.discountPct}% off · {p.redeemed} redeemed</Text>
            </View>
            <Pressable onPress={() => { const body = `${p.discountPct}% off with code ${p.code}`; pushToMembers(body).then((n) => Alert.alert('Pushed', `Sent to ${n} member${n === 1 ? '' : 's'}.`)); }} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 }}><Text style={{ color: t.brand, fontWeight: '800', fontSize: 12 }}>Push</Text></Pressable>
            <Pressable onPress={() => removePromo(p.id)} hitSlop={6}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Remove</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
