// Client · Invite friends. Share a personal referral code to bring friends onto
// the app. Uses the core React Native Share sheet (OTA-safe, no native module).
// The code is derived deterministically from the user so it's stable and can be
// credited once reward attribution is wired on the backend.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same code derivation, same share sheet, same hooks in the
// same order. No hero: an invite code is not a metric, so the one card on the
// screen is spent on the thing you act on.
//
// Nothing here is invented: the joined count comes from the `referral_count`
// RPC and is simply absent until someone has actually signed up with the code —
// no "0 friends joined" tile, no sample referrals, no fake reward balance.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useBrand } from '../../src/ui/brand';
import { referralCount } from '../../src/lib/referrals';
import { Rule, Section, SectionHead, Card, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';

function codeFrom(name: string, id: string): string {
  const first = (name.trim().split(' ')[0] || 'REP').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'REP';
  let h = 0;
  const seed = id || name || 'repple';
  for (let i = 0; i < seed.length; i++) { h = (h * 31 + seed.charCodeAt(i)) >>> 0; }
  const tag = h.toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
  return first + '-' + tag;
}

export default function Referral() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { appName } = useBrand();
  const code = codeFrom(c.name, c.id);
  // null covers both 'not read yet' and 'could not be read'. Neither is 0.
  const [joined, setJoined] = useState<number | null>(null);
  useEffect(() => { let on = true; referralCount(code).then((n) => { if (on) setJoined(n); }); return () => { on = false; }; }, [code]);
  const shareMsg = `Join me on ${appName} — the app I use to plan workouts, track progress and dial in my nutrition. Use my code ${code} when you sign up.`;

  const steps = [
    { n: '1', label: 'Share Your Code', note: 'Send it to a friend or training partner.' },
    { n: '2', label: 'They Join ' + appName, note: 'They enter your code when they sign up.' },
    { n: '3', label: 'Train Together', note: 'Keep each other consistent and accountable.' },
  ];

  const invite = async () => {
    try { await Share.share({ message: shareMsg }); } catch { /* user cancelled */ }
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Training is easier with company</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Invite Friends</Text>
          </View>
        </View>

        {/* ── the one card: the thing you act on ─────────────────────────── */}
        <Section>
          <Card>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your code</Text>
            <Text style={{ ...value(30), color: t.ink, letterSpacing: 1.5, marginTop: 6 }}>{code}</Text>
            {joined != null && joined > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                <Text style={{ ...ty.label, ...numeric, color: t.ink2 }}>{joined} friend{joined === 1 ? '' : 's'} joined with your code</Text>
              </View>
            ) : null}
            <View style={{ marginTop: sp.lg }}>
              <Cta label="Share My Invite" wide onPress={invite} />
            </View>
          </Card>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="How It Works" />
          {steps.map((s, i) => (
            <View key={s.n} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink2 }}>{s.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{s.label}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.note}</Text>
              </View>
            </View>
          ))}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
