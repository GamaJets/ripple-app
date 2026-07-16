// Client · Personal training. Sessions your trainer has delivered, awaiting your
// approval (draws down your package), plus your approved history. Mirrors the
// "Sessions delivered → Approve" flow gyms use. Approvals persist on-device and
// best-effort to the backend.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useSessions } from '../../src/ui/sessions';
import { useClientData } from '../../src/ui/clientData';

const KEY = 'repple.ptApproved';
const fmt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

export default function PtSessions() {
  const t = useTheme();
  const router = useRouter();
  const { sessions } = useSessions();
  const c = useClientData();
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v) { try { setApproved(JSON.parse(v)); } catch { /* ignore */ } } setHydrated(true); }).catch(() => setHydrated(true)); }, []);
  useEffect(() => { if (hydrated) AsyncStorage.setItem(KEY, JSON.stringify(approved)).catch(() => {}); }, [approved, hydrated]);

  const mine = useMemo(() => sessions
    .filter((s) => s.clientId === c.id && s.status === 'booked' && Date.parse(s.startsAt) <= Date.now())
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)), [sessions, c.id]);
  const pending = mine.filter((s) => !approved[s.id]);
  const done = mine.filter((s) => approved[s.id]);

  const approve = (id: string) => { setApproved((p) => ({ ...p, [id]: true })); Alert.alert('Approved', 'Thanks — the session is confirmed and drawn from your package.'); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Personal training</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Approve sessions your trainer has delivered to confirm and draw them from your package.</Text>

        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Awaiting your approval ({pending.length})</Text>
        {pending.map((s) => (
          <View key={s.id} style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 10 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{fmt(s.startsAt)}</Text>
            <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 2 }}>{s.durationMin} min personal training session</Text>
            <TextInput value={note[s.id] || ''} onChangeText={(v) => setNote((p) => ({ ...p, [s.id]: v }))} placeholder="Add a comment (optional)…" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, marginTop: 12, marginBottom: 12 }} />
            <Pressable onPress={() => approve(s.id)} accessibilityRole="button" accessibilityLabel="Approve session" style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Approve session</Text>
            </Pressable>
          </View>
        ))}
        {pending.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 8 }}>Nothing to approve right now.</Text> : null}

        {done.length > 0 ? (
          <>
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 10 }}>Approved ({done.length})</Text>
            {done.map((s) => (
              <View key={s.id} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: t.ink2, fontSize: 13.5, fontWeight: '600' }}>{fmt(s.startsAt)}</Text>
                <Text style={{ color: t.good, fontWeight: '800', fontSize: 12 }}>Approved ✓</Text>
              </View>
            ))}
          </>
        ) : null}

        <Pressable onPress={() => router.push('/(client)/packages')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 14 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>View my packages & sessions</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
