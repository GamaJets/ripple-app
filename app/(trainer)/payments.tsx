// Trainer · Payments (Stripe Connect). Onboard a payout account, then create
// packages (memberships / session-packs) clients can buy. Money goes to the
// trainer's connected account minus the platform fee. Credential-ready: activates
// once Stripe Connect is enabled and keys are set. No card details in-app.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every Stripe/Connect call, handler, conditional and route
// is untouched — only the presentation changed: the four bordered cards became
// hairline-separated sections, the one card left is the payout decision itself,
// and the Georgia serif header is gone.
//
// Nothing here reports a balance, a payout or a transaction: every figure is a
// price the trainer typed, stored in `trainer_packages`. There is no earnings
// number on this screen because the app is not told one.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { money } from '../../src/lib/billing';
import { startTrainerOnboarding, fetchMyConnect, fetchMyPackages, createPackage, deactivatePackage, type ConnectStatus, type TrainerPackage } from '../../src/lib/connect';

export default function TrainerPayments() {
  const t = useTheme();
  const router = useRouter();
  const [conn, setConn] = useState<ConnectStatus | null>(null);
  // null is not []. [] is a trainer who sells nothing; null is a price list we
  // could not read, and telling someone they have no packages when they do is
  // how a duplicate price list gets built.
  const [pkgs, setPkgs] = useState<TrainerPackage[] | null>(null);
  const [pkgErr, setPkgErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sessions, setSessions] = useState('');

  const load = useCallback(async () => { setLoading(true); const [c, p] = await Promise.all([fetchMyConnect(), fetchMyPackages()]); setConn(c); setPkgs(p); setPkgErr(p === null); setLoading(false); }, []);
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

  const remove = (id: string) => Alert.alert('Remove package?', 'Clients will no longer see it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
    // deactivatePackage used to return void and swallow the error, so this
    // refreshed and said nothing — a package the trainer believes is withdrawn
    // stays on sale until a client buys it.
    const ok = await deactivatePackage(id);
    if (!ok) { Alert.alert('Not removed', 'That package is still on sale — the change did not save. Try again in a moment.'); return; }
    load();
  } }]);

  const active = conn?.charges_enabled;
  const G = layout.gutter;
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Getting paid</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Payments</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Get paid by your clients — memberships &amp; session packs.
        </Text>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {/* ── payout status: the one decision on this screen ──────────── */}
            {!active ? (
              <View style={{ marginTop: sp.xl }}>
                <Notice tone={t.warn} kicker="Payouts" title="Set Up Payouts"
                  note={conn?.stripe_account_id ? 'Finish verifying with Stripe to go live.' : 'Connect a payout account with Stripe.'}>
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label={busy ? 'Opening…' : (conn?.stripe_account_id ? 'Continue Setup' : 'Set Up Payouts')} wide disabled={busy} onPress={onboard} />
                  </View>
                </Notice>
              </View>
            ) : (
              <Section>
                <SectionHead title="Payouts" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Payouts active</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>You can accept client payments.</Text>
                  </View>
                </View>
              </Section>
            )}

            <Rule />

            {/* ── what clients can buy ───────────────────────────────────── */}
            <Section>
              <SectionHead title="Your Packages" note={(pkgs ?? []).filter((p) => p.active).length ? String((pkgs ?? []).filter((p) => p.active).length) : undefined} />
              {pkgErr ? (
                <Flag tone={t.crit}>
                  Your packages could not be read, so this is not a list of what you sell. Do not add
                  them again from here — reopen the screen once you have signal.
                </Flag>
              ) : (pkgs ?? []).filter((p) => p.active).length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>No packages yet. Add one below — a monthly membership or a pack of sessions.</Text>
              ) : null}
              {(pkgs ?? []).filter((p) => p.active).map((p, i) => (
                <View key={p.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{money(p.price_cents, p.currency)}{p.sessions ? ` · ${p.sessions} sessions` : ' · membership'}</Text>
                  </View>
                  <Pressable onPress={() => remove(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + p.name} style={{ padding: 6 }}>
                    <Icon name="minus" size={17} color={t.ink3} />
                  </Pressable>
                </View>
              ))}
            </Section>

            <Rule />

            {/* ── add a package ──────────────────────────────────────────── */}
            <Section>
              <SectionHead title="Add a Package" />
              <TextInput value={name} onChangeText={setName} placeholder="Name — e.g. 10-Session Pack" placeholderTextColor={t.ink3} style={input} />
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Price ($)</Text>
                  <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="500" placeholderTextColor={t.ink3} style={input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Sessions (blank = membership)</Text>
                  <TextInput value={sessions} onChangeText={setSessions} keyboardType="number-pad" placeholder="10" placeholderTextColor={t.ink3} style={input} />
                </View>
              </View>
              <View style={{ height: sp.lg }} />
              <Cta label={busy ? 'Saving…' : 'Add Package'} wide disabled={busy} onPress={addPkg} />
            </Section>

            <Rule />

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
              Payments are processed by Stripe. A platform fee applies to each sale. You never handle card details.
            </Text>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
