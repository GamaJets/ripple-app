// Trainer · Payments (Stripe Connect). Onboard a payout account, then create
// packages (memberships / session-packs) clients can buy. Money goes to the
// trainer's connected account minus the platform fee. Credential-ready: activates
// once Stripe Connect is enabled and keys are set. No card details in-app.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { money } from '../../src/lib/billing';
import { startTrainerOnboarding, fetchMyConnect, fetchMyPackages, createPackage, deactivatePackage, type ConnectStatus, type TrainerPackage } from '../../src/lib/connect';

export default function TrainerPayments() {
  const t = useTheme();
  const router = useRouter();
  const [conn, setConn] = useState<ConnectStatus | null>(null);
  const [pkgs, setPkgs] = useState<TrainerPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sessions, setSessions] = useState('');

  const load = useCallback(async () => { setLoading(true); const [c, p] = await Promise.all([fetchMyConnect(), fetchMyPackages()]); setConn(c); setPkgs(p); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const onboard = async () => { setBusy(true); const r = await startTrainerOnboarding(); setBusy(false); if (!r.ok) Alert.alert('Payouts setup', r.error || 'Could not start setup. Make sure Stripe Connect is enabled.'); };

  const addPkg = async () => {
    const nm = name.trim(); const dollars = parseFloat(price);
    if (!nm) { Alert.alert('Name it', 'Give the package a name.'); return; }
    if (!(dollars > 0)) { Alert.alert('Set a price', 'Enter a price greater than 0.'); return; }
    const sess = sessions.trim() ? parseInt(sessions, 10) : null;
    setBusy(true);
    const r = await createPackage({ name: nm, price_cents: Math.round(dollars * 100), sessions: sess && sess > 0 ? sess : null });
    setBusy(false);
    if (!r.ok) { Alert.alert('Could not save', r.error || 'Try again.'); return; }
    setName(''); setPrice(''); setSessions(''); load();
  };

  const remove = (id: string) => Alert.alert('Remove package?', 'Clients will no longer see it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deactivatePackage(id); load(); } }]);

  const active = conn?.charges_enabled;
  const input = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={{ marginBottom: 8 }}><Icon name="back" size={22} color={t.ink2} /></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Payments</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Get paid by your clients — memberships &amp; session packs.</Text>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {/* Payout status */}
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: active ? t.brand : t.ring, padding: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name={active ? 'check' : 'clock'} size={19} color={active ? t.brand : t.s3} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{active ? 'Payouts active' : 'Set up payouts'}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{active ? 'You can accept client payments.' : conn?.stripe_account_id ? 'Finish verifying with Stripe to go live.' : 'Connect a payout account with Stripe.'}</Text>
                </View>
              </View>
              {!active ? (
                <Pressable onPress={onboard} disabled={busy} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                  {busy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{conn?.stripe_account_id ? 'Continue setup' : 'Set up payouts'}</Text>}
                </Pressable>
              ) : null}
            </View>

            {/* Packages */}
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Your packages</Text>
            {pkgs.filter((p) => p.active).length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 12 }}>No packages yet. Add one below — a monthly membership or a pack of sessions.</Text> : null}
            {pkgs.filter((p) => p.active).map((p) => (
              <View key={p.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{p.name}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{money(p.price_cents, p.currency)}{p.sessions ? ` · ${p.sessions} sessions` : ' · membership'}</Text>
                </View>
                <Pressable onPress={() => remove(p.id)} hitSlop={8} style={{ padding: 6 }}><Icon name="minus" size={18} color={t.ink3} /></Pressable>
              </View>
            ))}

            {/* Add package */}
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginTop: 6 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14, marginBottom: 12 }}>Add a package</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Name — e.g. 10-Session Pack" placeholderTextColor={t.ink3} style={[input, { marginBottom: 10 }]} />
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 4 }}>Price ($)</Text>
                  <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="500" placeholderTextColor={t.ink3} style={input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 4 }}>Sessions (blank = membership)</Text>
                  <TextInput value={sessions} onChangeText={setSessions} keyboardType="number-pad" placeholder="10" placeholderTextColor={t.ink3} style={input} />
                </View>
              </View>
              <Pressable onPress={addPkg} disabled={busy} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                {busy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Add package</Text>}
              </Pressable>
            </View>

            <Text style={{ color: t.ink3, fontSize: 11.5, textAlign: 'center', marginTop: 14, lineHeight: 17 }}>Payments are processed by Stripe. A platform fee applies to each sale. You never handle card details.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
