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
import { num } from '../../src/lib/format';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { DistBar } from '../../src/ui/charts';
import { usePromos } from '../../src/ui/promos';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { gymRollup, cohorts, clientAnalytics, type TrainerLike } from '../../src/lib/ownerAnalytics';

const DISCOUNTS = [10, 20, 30, 50];

export default function OwnerGrowth() {
  const t = useTheme();
  const { promos, status: promoStatus, addPromo, toggleActive, removePromo } = usePromos();
  // The roster read has to be waited on. Every count on this screen — new this
  // month, idle, the whole funnel — is derived from `trainers`, so before it
  // returns the hero read "+0 new trainers" over "No trainers yet" and the
  // retention row reported 0% idle. An owner checking whether their growth push
  // worked was shown a month with no signups by a query that had not finished.
  const { trainers, loading, status: trainersStatus } = usePlatformTrainers();
  // And having waited on it, the read can still have FAILED — which leaves
  // `trainers` empty with `loading` false, i.e. exactly the state the paragraph
  // above describes, permanently. "+0 new trainers" over "No trainers yet", and
  // a retention row of Idle 0% · Sessions 0 · Clients 0, are then not a slow
  // query being caught mid-flight but a settled answer about the gym, and the
  // owner who came here to see whether their growth push worked is told it did
  // not. Overview tells the two apart; this is that check.
  const trainersUnread = trainersStatus === 'error';
  const trainersUnknown = loading || trainersUnread;
  // One sentence for every dash on the screen that is a dash for this reason.
  const unreadNote = 'could not be read';
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
  // Null, not 0, over a roster we do not have: "0% idle" is the best possible
  // reading of a retention figure and was what a refused read produced.
  const idlePct = trainersUnknown || !trainers.length ? null : Math.round((idle / trainers.length) * 100);
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

  // Awaited now that a code is a row rather than a number in memory. The old
  // synchronous call told the owner "is now live" the instant they tapped,
  // which was true of nothing outside this process.
  const create = async () => {
    const r = await addPromo(code, disc);
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
          figure={trainersUnknown ? '—' : '+' + newThisMonth}
          note={loading
            ? 'Reading your roster…'
            : trainersUnread
            ? 'Your roster could not be read — this is not a month with no signups in it.'
            : roll.trainers > 0
            ? `${roll.trainers} on the roster · ${roll.trainers - idle} delivering sessions`
            : 'No trainers yet — this fills in as they join your gym.'}
        />

        <Rule />

        {/* ── retention ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Retention" />
          <KpiRow items={[
            { label: 'Idle', value: trainersUnknown ? '—' : fig(idlePct), unit: trainersUnknown || idlePct == null ? undefined : '%',
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : `${idle} of ${roll.trainers}` },
            { label: 'Sessions · 30d', value: trainersUnknown ? '—' : fig(num(roll.sessions30)),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : `${roll.avgSessionsPerTrainer} avg / trainer` },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(num(ca.total)),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : ca.avgPerTrainer == null ? 'no trainers yet' : `${ca.avgPerTrainer} avg / trainer` },
          ]} />
        </Section>

        <Rule />

        {/* ── platform client analytics ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Platform Clients" note="Across every trainer" />
          <KpiRow items={[
            { label: 'Active Clients', value: trainersUnknown ? '—' : fig(num(ca.total)) },
            { label: 'Engaged', value: trainersUnknown ? '—' : fig(ca.engagementPct), unit: trainersUnknown || ca.engagementPct == null ? undefined : '%' },
            { label: 'Avg / Trainer', value: trainersUnknown ? '—' : fig(ca.avgPerTrainer) },
          ]} />
          {/* The split is drawn from the same roster. Under a failed read both
              segments are 0, which DistBar has no way to distinguish from a gym
              where nobody is engaged and nobody is at risk — so the picture is
              withheld rather than drawn empty. */}
          {trainersUnknown ? null : (
            <View style={{ marginTop: sp.xl }}>
              <DistBar segments={[
                { label: 'Engaged', value: ca.engaged, color: t.brand },
                { label: 'At Risk', value: ca.atRisk, color: t.warn },
              ]} />
              <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md }}>
                {([['Engaged', ca.engaged, t.brand], ['At risk', ca.atRisk, t.warn]] as const).map(([l, v, col]) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>{l} {num(v)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Clients by trainer</Text>
            {loading ? <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
              : trainersUnread ? <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so their clients could not be counted.</Text>
              : ca.byTrainer.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No clients on the roster yet.</Text> : null}
            {trainersUnread ? null : ca.byTrainer.map((bt) => (
              <Bar key={bt.id} label={bt.name} right={`${bt.clients} · ${bt.pct}%`} pct={bt.pct} />
            ))}
          </View>
        </Section>

        <Rule />

        {/* ── cohort retention ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Cohort Retention" note="By signup month" />
          {loading ? <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
            : trainersUnread ? <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so there was nothing to group into cohorts.</Text>
            : coh.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No signups to group yet.</Text> : null}
          {coh.map((c) => (
            <Bar key={c.label} label={c.label} right={`${c.pct}% · ${num(c.active)}/${num(c.total)}`} pct={c.pct} dim={c.pct < 60} />
          ))}
        </Section>

        <Rule />

        {/* ── trainer acquisition funnel ─────────────────────────────────── */}
        <Section>
          <SectionHead title="Trainer Acquisition Funnel" note="From signup" />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read — an empty funnel here would say nobody signed up, which is not something this screen found out.</Text>
          ) : roll.trainers === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers on the platform yet — the funnel fills in as they sign up.</Text>
          ) : funnel.map(([label, count, pct]) => (
            <Bar key={label} label={label} right={`${num(count)} · ${pct}%`} pct={pct} />
          ))}
        </Section>

        <Rule />

        {/* ── promo / referral codes ─────────────────────────────────────── */}
        <Section>
          {/* The note read "Trainer subscriptions", which is what these codes
              were for in the subscription console this app used to be. They are
              redeemed by MEMBERS now — `offers.tsx` in the client app calls
              `redeem_promo` against this same `promos` table — so the label
              named the wrong audience entirely, on the one screen an owner
              reads aloud when explaining a promotion to somebody. */}
          <SectionHead title="Promo & Referral Codes" note="Redeemed by members" />
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

          {promoStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Your codes could not be read just now — this is not a statement that you have none.</Text>
          ) : promos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>{promoStatus === 'loading' ? 'Loading.' : 'No codes yet — create one above.'}</Text>
          ) : null}
          {promos.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                                      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...value(15), letterSpacing: 1, color: t.ink }}>{p.code}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {p.discountPct}% off · {p.redeemed < 0 ? '—' : p.redeemed} used
                </Text>
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
