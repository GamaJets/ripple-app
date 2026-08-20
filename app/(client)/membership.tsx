// Client · Membership. The gym-member home: your member pass, the sessions you
// have actually logged this month, and the places you can go from here — entry
// barcode, classes, personal training, bookings, offers, referrals and packs.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): one hero figure instead of four competing bordered
// tiles, and a single card spent on the thing you actually do here (show the
// barcode).
//
// Fabrication removed in this pass: the card used to print a "Plan · Member"
// and a "Valid until <today + 1 year>" that no billing system had ever issued,
// a "Loyalty points" figure invented as (visit days × 10 + log entries × 2)
// with no loyalty programme behind it, and a "Balance · Add top-up ›" tile for
// an account balance that does not exist. Nothing replaced them — what is left
// is the member number, which is derived from the signed-in user, and visit
// counts, which come from the real workout log.
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, ActionCard, ListRow, Ghost } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
import type { IconName } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useBrand } from '../../src/ui/brand';
import { memberNoFrom } from '../../src/lib/membership';

export default function Membership() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log } = useWorkoutLog();
  const { appName } = useBrand();
  const memberNo = memberNoFrom(c.name, c.id);

  const { visits, last } = useMemo(() => {
    const now = new Date();
    const days = new Set<string>();
    let latest = 0;
    for (const e of log) {
      const d = new Date(e.t);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) days.add(d.toDateString());
      const ts = Date.parse(e.t); if (ts > latest) latest = ts;
    }
    const lastLabel = latest ? new Date(latest).toLocaleDateString() : '—';
    return { visits: days.size, last: lastLabel };
  }, [log]);

  const actions: { label: string; note: string; icon: IconName; route: string; hero?: boolean }[] = [
    { label: 'Entry barcode', note: 'Your Repple ID — link it at reception', icon: 'grid', route: '/(client)/access', hero: true },
    { label: 'Classes', note: 'Book a group class at your branch', icon: 'calendar', route: '/(client)/classes' },
    { label: 'Personal training', note: 'Approve sessions your trainer delivered', icon: 'people', route: '/(client)/pt-sessions' },
    { label: 'My bookings', note: 'Everything you have booked', icon: 'check', route: '/(client)/bookings' },
    { label: 'Memberships & packs', note: 'What you have bought and what is left', icon: 'trophy', route: '/(client)/packages' },
    { label: 'Offers', note: 'What else the app can do', icon: 'sparkle', route: '/(client)/explore' },
    { label: 'Refer a friend', note: 'Share Repple with someone', icon: 'share', route: '/(client)/referral' },
  ];
  const heroAction = actions.find((a) => a.hero);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{appName}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Membership</Text>
            <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 3 }}>{c.name || 'Member'} · {memberNo}</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── the hero: the only live number this screen has ──────────────── */}
        <Hero
          label="Sessions logged this month"
          figure={String(visits)}
          note={visits > 0 ? `Last logged ${last}` : 'No sessions logged yet this month'}
        />

        <Rule />

        {/* ── the one card: the thing you open this screen to do ──────────── */}
        {heroAction ? (
          <Section>
            <ActionCard
              title="Show entry barcode"
              note={`Member ${memberNo} · ${heroAction.note}`}
              cta="Show"
              onPress={() => router.push(heroAction.route as any)}
            />
          </Section>
        ) : null}

        <Rule />

        {/* ── everywhere else you can go ─────────────────────────────────── */}
        <Section>
          <SectionHead title="At the gym" />
          {actions.filter((a) => !a.hero).map((a) => (
            <ListRow key={a.label} icon={a.icon} title={a.label} note={a.note}
              onPress={() => router.push(a.route as any)} />
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
