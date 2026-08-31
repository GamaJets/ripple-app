// Client · Offers. Redeem a code your gym has given you, and see the ones you
// have already used.
//
// ── What this screen does NOT do ───────────────────────────────────────────
//
// It does not take money off anything. Repple records that you used a code and
// tells your gym; applying the discount is the gym's billing, not ours. That is
// stated on the screen rather than left to be discovered, because a screen that
// says "20% off applied" over a payment it never touched is the kind of lie
// this codebase keeps having to remove.
//
// The Membership screen's "Offers" row used to point at Explore — a list of
// what else the app can do, which is not an offer. It points here now.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import type { LoadStatus } from '../../src/ui/loadStatus';

interface Redeemed { code: string; discount: number; redeemedAt: string }

/** Why a code was refused, in words the person holding the phone can act on. */
function refusal(reason: string | undefined, code: string): string {
  switch (reason) {
    case 'no-such-code': return `Your gym has no code called “${code}”. Check the spelling with them.`;
    case 'inactive':     return `“${code}” is no longer running.`;
    case 'already':      return `You have already used “${code}”. A code works once per person.`;
    case 'no-gym':       return 'Your account is not attached to a gym yet, so there is nothing to redeem against.';
    case 'signed-out':   return 'You appear to be signed out. Sign in and try again.';
    default:             return 'That could not be redeemed just now. Try again in a moment.';
  }
}

export default function Offers() {
  const t = useTheme();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Redeemed[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    const { data, error } = await supabase.rpc('my_promo_redemptions');
    if (error) { setStatus('error'); return; }
    setMine((data ?? []).map((r: any) => ({
      code: String(r.code), discount: Number(r.discount) || 0, redeemedAt: String(r.redeemed_at),
    })));
    setStatus('ready');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const redeem = async () => {
    const c = code.trim().toUpperCase();
    if (!c || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('redeem_promo', { p_code: c });
    setBusy(false);
    if (error) { Alert.alert('Not redeemed', 'That could not be redeemed just now. Try again in a moment.'); return; }
    const res = (data ?? {}) as { ok?: boolean; reason?: string; discount?: number; code?: string };
    if (!res.ok) { Alert.alert('Not redeemed', refusal(res.reason, c)); return; }
    setCode('');
    await refresh();
    Alert.alert(
      'Code redeemed',
      `${res.code} · ${res.discount}% off is recorded against your account and your gym has been told. They apply the discount to your billing.`,
    );
  };

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Membership</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Offers</Text>
          </View>
        </View>

        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Redeem a Code" />
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            A code from your gym. It works once, and only at the gym that issued it.
          </Text>
          <TextInput
            value={code} onChangeText={setCode}
            autoCapitalize="characters" autoCorrect={false}
            placeholder="SUMMER20" placeholderTextColor={t.ink3}
            style={{
              ...ty.head, color: t.ink, letterSpacing: 2,
              borderBottomWidth: hairline, borderBottomColor: t.ring,
              paddingVertical: sp.md, marginTop: sp.md,
            }}
          />
          <View style={{ marginTop: sp.lg }}>
            <Cta label={busy ? 'Redeeming…' : 'Redeem'} onPress={redeem} disabled={busy || !code.trim()} wide />
          </View>
        </Section>

        <Notice tone={t.ink3} kicker="How this works" title="Repple records it, your gym applies it"
          note="Redeeming tells your gym you have used the code. The discount comes off through their billing, not through the app — Repple never touches the payment." />

        <Rule />

        <Section>
          <SectionHead title="Codes You Have Used" note={status === 'ready' && mine.length ? String(mine.length) : undefined} />
          {status === 'error' ? (
            // Empty under 'error' means we could not read it, which is not the
            // same as never having used one — and this list is what tells
            // somebody a code is already spent.
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              This could not be read just now. It is not a statement that you have used none.
            </Text>
          ) : mine.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {status === 'loading' ? 'Loading.' : 'None yet. Codes you redeem appear here.'}
            </Text>
          ) : mine.map((r, i) => (
            <View key={`${r.code}-${i}`} style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.sm,
              paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, letterSpacing: 1 }}>{r.code}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.discount}% off</Text>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{when(r.redeemedAt)}</Text>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
