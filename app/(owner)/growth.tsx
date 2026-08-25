// Owner · Growth. Acquisition/retention snapshot + an interactive promo-code
//
// Promo rows show the discount only. They used to append "· N redeemed", but
// nothing in the codebase ever increments `redeemed` — the sole write is the
// literal `redeemed: 0` at creation — so it was a permanently-zero counter
// presented as a tracked redemption metric. Same defect was fixed on the
// Promotions screen; this was the second render site.
// tool: create referral/discount codes, toggle them on/off, track redemptions.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): three bordered stat boxes and four stacked cards became
// one hero figure plus hairline-separated sections, and the Georgia serif
// header is gone.
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import {
  Rule, Section, SectionHead, Hero, KpiRow, Cta,
} from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { DistBar } from '../../src/ui/charts';
import { usePromos } from '../../src/ui/promos';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { gymRollup, cohorts, clientAnalytics, type TrainerLike } from '../../src/lib/ownerAnalytics';

const DISCOUNTS = [10, 20, 30, 50];

export default function OwnerGrowth() {
  const t = useTheme();
  const { promos, addPromo, toggleActive, removePromo } = usePromos();
  const { trainers } = usePlatformTrainers();
  const roll = gymRollup(trainers as TrainerLike[], null);
  const coh = cohorts(trainers as TrainerLike[]);
  const ca = clientAnalytics(trainers as TrainerLike[]);
  // Joined this month, from the real `profiles.created_at` rather than a
  // hand-formatted "Aug 2026" string that only matched by luck.
  const now = new Date();
  const newThisMonth = trainers.filter((x) => {
    const ts = x.since ? Date.parse(x.since) : NaN;
    if (!isFinite(ts)) return false;
    const d = new Date(ts);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  // Idle = carrying no clients and delivering nothing. That is the gym's
  // equivalent of churn; a subscription "suspended" flag never existed here.
  const idle = trainers.filter((x) => (x.clients || 0) === 0 && (x.sessions30 || 0) === 0).length;
  const idlePct = trainers.length ? Math.round((idle / trainers.length) * 100) : 0;
  const [code, setCode] = useState('');
  const [disc, setDisc] = useState(20);
  // Trainer funnel, derived from the real roster. There is no analytics on
  // site visits, so the funnel starts at signup — a "Visited site 100% →
  // Paying 18%" curve was previously hardcoded here and was entirely invented.
  const activated = trainers.filter((x) => x.clients > 0).length;
  const funnelPct = (n: number) => (roll.trainers ? Math.round((n / roll.trainers) * 100) : 0);
  const funnel: [string, number, number][] = [
    ['Signed up', roll.trainers, 100],
    ['Activated (has clients)', activated, funnelPct(activated)],
    ['Delivering sessions', roll.trainers - idle, funnelPct(roll.trainers - idle)],
  ];

  const create = () => {
    const r = addPromo(code, disc);
    if (!r.ok) { Alert.alert('Cannot create', r.reason ?? 'Try a different code.'); return; }
    setCode('');
    Alert.alert('Code created', `${code.trim().toUpperCase()} · ${disc}% off is now live.`);
  };

  /** One labelled bar — the section's unit of comparison. */
  const Bar = ({ label, right, pct, dim }: { label: string; right: string; pct: number; dim?: boolean }) => (
    <View style={{ marginBottom: sp.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...ty.caption, color: t.ink2 }}>{label}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{right}</Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
        <View style={{ height: 3, borderRadius: 2, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: t.brand, opacity: dim ? 0.55 : 1 }} />
      </View>
    </View>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Acquisition &amp; retention</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Growth</Text>
        </View>

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label={`New trainers · ${now.toLocaleString(undefined, { month: 'short' })} ${now.getFullYear()}`}
          figure={'+' + newThisMonth}
          note={roll.trainers > 0
            ? `${roll.trainers} on the roster · ${roll.trainers - idle} delivering sessions`
            : 'No trainers yet — this fills in as they join your gym.'}
        />

        <Rule />

        {/* ── retention ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Retention" />
          <KpiRow items={[
            { label: 'Idle', value: String(idlePct), unit: '%', delta: `${idle} of ${roll.trainers}` },
            { label: 'Sessions · 30d', value: String(roll.sessions30), delta: `${roll.avgSessionsPerTrainer} avg / trainer` },
            { label: 'Clients', value: String(ca.total), delta: `${ca.avgPerTrainer} avg / trainer` },
          ]} />
        </Section>

        <Rule />

        {/* ── platform client analytics ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Platform clients" note="Across every trainer" />
          <KpiRow items={[
            { label: 'Active clients', value: String(ca.total) },
            { label: 'Engaged', value: String(ca.engagementPct), unit: '%' },
            { label: 'Avg / trainer', value: String(ca.avgPerTrainer) },
          ]} />
          <View style={{ marginTop: sp.xl }}>
            <DistBar segments={[
              { label: 'Engaged', value: ca.engaged, color: t.brand },
              { label: 'At risk', value: ca.atRisk, color: t.warn },
            ]} />
            <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md }}>
              {([['Engaged', ca.engaged, t.brand], ['At risk', ca.atRisk, t.warn]] as const).map(([l, v, col]) => (
                <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{l} {v}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Clients by trainer</Text>
            {ca.byTrainer.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No clients on the roster yet.</Text> : null}
            {ca.byTrainer.map((bt) => (
              <Bar key={bt.id} label={bt.name} right={`${bt.clients} · ${bt.pct}%`} pct={bt.pct} />
            ))}
          </View>
        </Section>

        <Rule />

        {/* ── cohort retention ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Cohort retention" note="By signup month" />
          {coh.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No signups to group yet.</Text> : null}
          {coh.map((c) => (
            <Bar key={c.label} label={c.label} right={`${c.pct}% · ${c.active}/${c.total}`} pct={c.pct} dim={c.pct < 60} />
          ))}
        </Section>

        <Rule />

        {/* ── trainer acquisition funnel ─────────────────────────────────── */}
        <Section>
          <SectionHead title="Trainer acquisition funnel" note="From signup" />
          {roll.trainers === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers on the platform yet — the funnel fills in as they sign up.</Text>
          ) : funnel.map(([label, count, pct]) => (
            <Bar key={label} label={label} right={`${count} · ${pct}%`} pct={pct} />
          ))}
        </Section>

        <Rule />

        {/* ── promo / referral codes ─────────────────────────────────────── */}
        <Section>
          <SectionHead title="Promo & referral codes" note="Trainer subscriptions" />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
            <TextInput value={code} onChangeText={setCode} placeholder="CODE" placeholderTextColor={t.ink3}
              autoCapitalize="characters" autoCorrect={false}
              style={{ ...ty.body, fontWeight: '500', letterSpacing: 1, flex: 1, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }} />
            <Cta label="Create" onPress={create} />
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.xl }}>
            {DISCOUNTS.map((d) => { const on = disc === d; return (
              <Pressable key={d} onPress={() => setDisc(d)}
                style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: on ? t.brandInk : t.ink2 }}>{d}%</Text>
              </Pressable>); })}
          </View>

          {promos.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No codes yet — create one above.</Text> : null}
          {promos.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                                      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...value(15), letterSpacing: 1, color: t.ink }}>{p.code}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.discountPct}% off</Text>
              </View>
              <Pressable onPress={() => toggleActive(p.id)} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: p.active ? t.brand : t.ink3 }} />
                <Text style={{ ...ty.caption, color: t.ink2 }}>{p.active ? 'Active' : 'Off'}</Text>
              </Pressable>
              <Pressable onPress={() => removePromo(p.id)} accessibilityLabel="Delete code" accessibilityRole="button" hitSlop={8}
                style={{ paddingHorizontal: sp.xs, paddingVertical: sp.xs }}>
                <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
              </Pressable>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
