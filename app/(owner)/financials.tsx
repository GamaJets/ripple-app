// Owner · Financial health. KPIs, retention and an AI-style review of the gym's
// numbers with concrete improvement recommendations.
//
// The review runs ONLY on figures the owner has entered. This screen previously
// rendered `sampleFinances()` — an invented AED 214,000/mo, 1,940-member gym —
// behind a one-line footnote, so a real owner opened it and was told, with a
// grade and an AI verdict, that their business was in strong financial health.
// Until figures are entered (or accounting is connected) it now shows an entry
// form and no analysis at all.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional, handler, route and the
// AsyncStorage persistence are preserved — only the presentation changed: the
// health score became the screen's one hero figure (in the "has figures" state
// only — the empty state shows no hero of zeros), the bordered KPI grid became
// hairline-divided KPI rows, the flag boxes became a hairline-divided list with
// a tone dot beside ink-coloured text, and the Georgia serif header is gone.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { emptyFinances, hasFigures, reviewFinances, type FinInputs, type FinFlag } from '../../src/lib/financialAI';

const KEY = 'repple.owner.financials';
const money = (n: number) => 'AED ' + Math.round(n).toLocaleString();

const FIELDS: { key: keyof FinInputs; label: string; hint: string }[] = [
  { key: 'revenue', label: 'Total revenue / mo', hint: 'AED' },
  { key: 'expenses', label: 'Total expenses / mo', hint: 'AED' },
  { key: 'mrr', label: 'Recurring membership revenue', hint: 'AED' },
  { key: 'members', label: 'Active members', hint: 'count' },
  { key: 'newMembers', label: 'Joined this month', hint: 'count' },
  { key: 'churnedMembers', label: 'Left this month', hint: 'count' },
  { key: 'ptRevenue', label: 'Personal-training revenue', hint: 'AED' },
  { key: 'classRevenue', label: 'Class revenue', hint: 'AED' },
];

export default function Financials() {
  const t = useTheme();
  const router = useRouter();
  const [connected] = useState(false);
  const [fin, setFin] = useState<FinInputs>(emptyFinances);
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const next = emptyFinances();
          for (const f of FIELDS) if (typeof parsed?.[f.key] === 'number') next[f.key] = parsed[f.key];
          setFin(next);
        }
      } catch { /* ignore */ }
      setHydrated(true);
    })();
  }, []);

  const openEditor = useCallback(() => {
    const d: Record<string, string> = {};
    for (const f of FIELDS) d[f.key] = fin[f.key] ? String(fin[f.key]) : '';
    setDraft(d);
    setEditing(true);
  }, [fin]);

  const save = useCallback(async () => {
    const next = emptyFinances();
    for (const f of FIELDS) {
      const n = Number(String(draft[f.key] ?? '').replace(/[^0-9.]/g, ''));
      next[f.key] = Number.isFinite(n) ? n : 0;
    }
    setFin(next);
    setEditing(false);
    try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [draft]);

  const ready = hasFigures(fin);
  const r = useMemo(() => (ready ? reviewFinances(fin) : null), [fin, ready]);
  const toneColor = (tone: FinFlag['tone']) => (tone === 'good' ? t.good : tone === 'watch' ? t.warn : t.crit);

  const kpis: [string, string][] = r ? [
    ['Revenue / mo', money(fin.revenue)],
    ['Net profit', money(r.netProfit)],
    ['Margin', r.marginPct.toFixed(0) + '%'],
    ['MRR', money(fin.mrr)],
    ['Members', fin.members.toLocaleString()],
    ['Churn', r.churnPct.toFixed(1) + '%'],
    ['Net growth', (r.growthPct >= 0 ? '+' : '') + r.growthPct.toFixed(1) + '%'],
    ['PT + classes', money(fin.ptRevenue + fin.classRevenue)],
  ] : [];

  const G = layout.gutter;
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };

  const flagList = (flags: FinFlag[]) => flags.map((f, i) => (
    <View key={i} style={{
      flexDirection: 'row', gap: sp.md, paddingVertical: sp.md,
      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: toneColor(f.tone) }} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{f.title}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{f.detail}</Text>
      </View>
    </View>
  ));

  const connectRow = (
    <ListRow
      icon="chart"
      title={connected ? 'Accounting connected' : 'Connect accounting'}
      note={connected ? 'Syncing from Xero' : 'Xero · QuickBooks — pull real P&L'}
      tone={connected ? t.good : undefined}
      onPress={() => Alert.alert('Connect accounting', 'Link Xero or QuickBooks to pull real revenue, expenses and P&L automatically. Setup uses your accounting login — ask us to enable it for your account.')}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Financial health</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          How the gym is doing — with an AI review of where to improve.
        </Text>

        {!hydrated ? null : editing ? (
          /* ── entry form ───────────────────────────────────────────────── */
          <Section>
            <SectionHead title="Your monthly figures" note="This device only" />
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Leave a field blank if you don't track it. Stored on this device only.
            </Text>
            {FIELDS.map((f) => (
              <View key={f.key} style={{ marginBottom: sp.md }}>
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>
                  {f.label} <Text style={{ ...ty.caption, color: t.ink3 }}>({f.hint})</Text>
                </Text>
                <TextInput
                  value={draft[f.key] ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={t.ink3}
                  style={input}
                />
              </View>
            ))}
            <View style={{ height: sp.sm }} />
            <Cta label="Save & review" wide onPress={save} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Cancel" onPress={() => setEditing(false)} />
          </Section>
        ) : !ready ? (
          /* ── honest empty state: no hero of zeros ─────────────────────── */
          <Section>
            <SectionHead title="No figures yet" />
            <Text style={{ ...ty.body, color: t.ink2 }}>
              Connect your accounting, or enter this month's revenue, expenses and membership
              numbers. Nothing is shown until it comes from you.
            </Text>
            <View style={{ height: sp.lg }} />
            <Cta label="Enter my figures" wide onPress={openEditor} />
          </Section>
        ) : r ? (
          <>
            {/* ── the hero ─────────────────────────────────────────────── */}
            <Hero
              label="Health score"
              figure={fig(r.score)}
              unit="/100"
              note={`Grade ${r.grade} · ${money(r.netProfit)} net profit on a ${r.marginPct.toFixed(0)}% margin`}
              arc={r.score / 100}
            />

            <Rule />

            <Section>
              <SectionHead title="AI financial review" note={`Grade ${r.grade}`} />
              <Text style={{ ...ty.body, color: t.ink2 }}>{r.summary}</Text>
            </Section>

            <Rule />

            <Section>
              <SectionHead title="This month" note="From your figures" />
              {[0, 2, 4, 6].map((i) => (
                <View key={i} style={{ marginTop: i === 0 ? 0 : sp.lg }}>
                  <KpiRow items={kpis.slice(i, i + 2).map(([l, v]) => ({ label: l, value: v }))} />
                </View>
              ))}
            </Section>

            {r.strengths.length > 0 ? (<>
              <Rule />
              <Section>
                <SectionHead title="What's working" />
                {flagList(r.strengths)}
              </Section>
            </>) : null}

            <Rule />

            <Section>
              <SectionHead title="Where to improve" />
              {flagList(r.improvements)}
            </Section>

            <Rule />

            <Section>
              <Cta label="Create a promotion" wide onPress={() => router.push('/(owner)/promotions')} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Update my figures" onPress={openEditor} />
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
                Review is generated from the figures you entered — not financial advice.
              </Text>
            </Section>
          </>
        ) : null}

        <Rule />

        <Section>{connectRow}</Section>

      </ScrollView>
    </SafeAreaView>
  );
}
