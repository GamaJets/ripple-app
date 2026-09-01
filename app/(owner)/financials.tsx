// Owner · Financial checks. KPIs, retention and a RULE-BASED read of the
// figures the owner has typed in, with the thresholds each finding crossed.
//
// ── Not an AI review, on this screen or anywhere else ─────────────────────
//
// This screen was headed "AI Financial Review" over a subtitle promising "an
// AI review of where to improve", and the module behind it was called
// `financialAI.ts`. There is no model call anywhere in it and there never was:
// src/lib/finReview.ts is an if/else chain over eight typed numbers and a
// fixed set of thresholds. The header of that file is the long version of why
// the name mattered — the short version is that `grade >= 'A'` compared
// strings, every gym was told it was in strong financial health, and an owner
// who thinks a model read their books has no way to catch that. Rules they can
// read, they can argue with.
//
// The review runs ONLY on figures the owner has entered. This screen previously
// rendered `sampleFinances()` — an invented AED 214,000/mo, 1,940-member gym —
// behind a one-line footnote, so a real owner opened it and was told, with a
// grade and a verdict, that their business was in strong financial health.
// Until figures are entered it now shows an entry form and no analysis at all.
//
// ── The figures never leave this phone, and the screen says so three times ─
//
// They are one AsyncStorage key under `KEY`. No row, no sync, no backup. An
// owner typing a real P&L into a phone is entitled to know that before they
// treat it as a record, so `storageNote()` is said in the empty state, in the
// entry form and under the review — the three places somebody can be standing
// when they decide whether this is somewhere their numbers live.
// docs/OWNER-PORTAL.md:89 offers two ways out of this: connect real accounting,
// or rename the screen to what it is. Accounting is a Xero/QuickBooks OAuth
// app, a token store, a sync worker and a chart-of-accounts mapping, none of
// which exists. So this is the other one, done honestly.
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
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { emptyFinances, hasFigures, anyEntered, reviewFinances, reviewBasis, storageNote, type FinInputs, type FinFlag } from '../../src/lib/finReview';
import { reconcile, reconcileNote, unreadable } from '../../src/lib/finReconcile';
import { fetchPlans, fetchMemberships, fetchPayments, summarise } from '../../src/lib/gymRecord';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { deltaLabel } from '../../src/lib/deltaLabel';
import { readNumber } from '../../src/lib/units';

const KEY = 'repple.owner.financials';
// One formatter for the whole owner app, rather than 'AED ' typed here and '$'
// typed on Revenue — the two screens read the same gym, and a demo that tabs
// between them showed one business in two currencies. Every figure on this
// screen is one the owner typed into the form below, so it is never null; the
// dash is there because gymMoney refuses to render an unknown as 0.00.
// Takes the gym's currency, and there is no fallback behind it: part 99 added
// `tenants.currency` nullable on purpose, so a gym that never set one gets the
// dash rather than somebody else's money. GYM_CURRENCY is no longer a render
// fallback anywhere — see the note on it in src/ui/tenant.tsx.
const moneyIn = (n: number, cur: string | null) => gymMoney(n, cur) ?? '—';

// `hint` is optional now. A money field's hint IS the gym's currency, and the
// gym is not known at module scope — it was printing GYM_CURRENCY, the module
// default, to every gym including the ones part 99 gave a currency of their
// own. Absent means "money, in this gym's currency", filled in at render.
const FIELDS: { key: keyof FinInputs; label: string; hint?: string }[] = [
  { key: 'revenue', label: 'Total Revenue / Mo' },
  { key: 'expenses', label: 'Total Expenses / Mo' },
  { key: 'mrr', label: 'Recurring Membership Revenue' },
  { key: 'members', label: 'Active Members', hint: 'count' },
  { key: 'newMembers', label: 'Joined This Month', hint: 'count' },
  { key: 'churnedMembers', label: 'Left This Month', hint: 'count' },
  { key: 'ptRevenue', label: 'Personal-training Revenue' },
  { key: 'classRevenue', label: 'Class Revenue' },
];

export default function Financials() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();
  // `?? null`, not `|| GYM_CURRENCY`. Every figure on this screen is one the
  // owner typed, so the amounts are known — but the money they are in is the
  // gym's own answer or nothing, and a form whose fields are headed "(AED)" at
  // a gym billing in pounds invites the owner to type pounds into a dirham
  // field. The header below names the missing setting instead.
  const cur = tenant?.currency ?? null;
  const money = (n: number) => moneyIn(n, cur);
  const [fin, setFin] = useState<FinInputs>(emptyFinances);
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  // What the records themselves say. MRR and the active-member count are both
  // things the database already knows — memberships on priced plans give one,
  // memberships with status 'active' give the other — so asking an owner to
  // type them creates two sources for one number that nothing compares.
  //
  // The derived figures are NOT written over what was typed. An owner entering
  // a different number is usually right about something the records do not
  // hold: a corporate contract invoiced offline, a price that changed
  // mid-month. Overwriting that would swap one wrong number for another and
  // lose what the owner knows. The screen names both and lets them decide.
  const [derivedMrr, setDerivedMrr] = useState<number | null>(null);
  const [derivedMembers, setDerivedMembers] = useState<number | null>(null);
  /**
   * Two more of the eight the register already holds.
   *
   * `revenue` is what `gym_payments` says was banked in the last 30 days —
   * whatever it was for — and `newMembers` is memberships whose `started_on`
   * falls in the same window. Both were being typed by hand beside a database
   * that already knew them, which is two sources for one number and nothing
   * comparing them.
   *
   * CHURN is deliberately not derived, and the reason is worth stating: nothing
   * in `memberships` records WHEN a membership was cancelled. `status` moves to
   * 'cancelled' in place and `ends_on` is only set on a fixed term, so any
   * derived churn would be a guess dressed as a check — and a check that is
   * wrong is worse than no check, because this screen exists to be believed.
   */
  const [derivedRevenue, setDerivedRevenue] = useState<number | null>(null);
  const [derivedNew, setDerivedNew] = useState<number | null>(null);
  /**
   * The register could not be read.
   *
   * `fetchPlans`/`fetchMemberships`/`fetchPayments` all throw on a PostgREST
   * error, and the catch below only logged it — which left both derived figures
   * null, which is the same state an empty register produces. So `reconcile`
   * returned 'no_record' and the screen told an owner "Nothing recorded yet, so
   * your MRR cannot be checked against the register": a specific claim about
   * their own gym, in the same type used when it is true, arrived at by code
   * that never read a row. On a screen whose entire purpose is checking the
   * owner's figures against the register, that is the worst available sentence.
   */
  const [derivedFailed, setDerivedFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!tenant?.id) return;
      try {
        const [plans, memberships, payments] = await Promise.all([
          fetchPlans(supabase, tenant.id),
          fetchMemberships(supabase, tenant.id),
          fetchPayments(supabase, tenant.id),
        ]);
        if (!live) return;
        const sum = summarise(payments, memberships, plans);
        // summarise returns null when no active membership sits on a priced
        // plan. Passed straight through: "not known" must not become a zero
        // that makes an owner doubt a figure they are right about.
        setDerivedMrr(sum.mrrCents == null ? null : Math.round(sum.mrrCents / 100));
        setDerivedMembers(memberships.length ? sum.activeMembers : null);

        // Thirty days back, in whole days, so the window does not slide by the
        // hour of day the screen happened to be opened.
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const recent = payments.filter((p) => p.takenAt >= since);
        // The currency has to AGREE before there is a total: a gym that changed
        // its currency has two in its ledger and adding them is not a sum. Null
        // withholds the check rather than comparing a typed figure against a
        // number made of two moneys.
        const oneMoney = recent.length > 0 && new Set(recent.map((p) => p.currency)).size === 1;
        setDerivedRevenue(oneMoney ? Math.round(recent.reduce((a, p) => a + p.amountCents, 0) / 100) : null);

        const sinceDay = since.slice(0, 10);
        setDerivedNew(memberships.length ? memberships.filter((m) => m.startedOn >= sinceDay).length : null);
        setDerivedFailed(false);
      } catch (e) {
        reportError('financials.derived', e);
        // The figures already on screen are from a read that no longer holds,
        // so they are cleared rather than left standing beside the failure.
        if (!live) return;
        setDerivedMrr(null); setDerivedMembers(null);
        setDerivedRevenue(null); setDerivedNew(null); setDerivedFailed(true);
      }
    })();
    return () => { live = false; };
  }, [tenant?.id]);

  // `unreadable` rather than `reconcile(..., null)`: only this screen knows the
  // query threw, and it is the one piece of information that separates "your
  // register is empty" from "we could not read your register".
  const mrrCheck = derivedFailed ? unreadable(fin.mrr) : reconcile(fin.mrr, derivedMrr);
  const memberCheck = derivedFailed ? unreadable(fin.members) : reconcile(fin.members, derivedMembers);
  const revenueCheck = derivedFailed ? unreadable(fin.revenue) : reconcile(fin.revenue, derivedRevenue);
  const newCheck = derivedFailed ? unreadable(fin.newMembers) : reconcile(fin.newMembers, derivedNew);

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
      // `replace(/[^0-9.]/g, '')` deleted the decimal COMMA and closed the gap,
      // so an owner in Berlin typing 16,5 had 165 filed — and every ratio the
      // review below draws was then built on it. These boxes are decimal pads;
      // the comma on them is a decimal point, not a separator to throw away.
      const n = readNumber(draft[f.key] ?? '');
      next[f.key] = n ?? 0;
    }
    setFin(next);
    setEditing(false);
    try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [draft]);

  const ready = hasFigures(fin);
  // The review quotes amounts inside its sentences, so it needs the currency
  // rather than a formatter: with null it writes the same analysis in
  // percentages and leaves the figures out, which is the only honest version
  // when nobody has said what money this gym counts in.
  const r = useMemo(() => (ready ? reviewFinances(fin, cur) : null), [fin, ready, cur]);
  const toneColor = (tone: FinFlag['tone']) => (tone === 'good' ? t.good : tone === 'watch' ? t.warn : t.crit);

  const kpis: [string, string][] = r ? [
    ['Revenue / mo', money(fin.revenue)],
    ['Net profit', money(r.netProfit)],
    ['Margin', r.marginPct.toFixed(0) + '%'],
    ['MRR', money(fin.mrr)],
    ['Members', fin.members.toLocaleString()],
    ['Churn', r.churnPct.toFixed(1) + '%'],
    // A gym that neither grew nor shrank reads "No change", not "+0.0%". The
    // `>= 0` arm put a plus on a month in which nothing happened.
    ['Net growth', deltaLabel(r.growthPct, { since: null, unit: '%' })],
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

  // ── "Connect Accounting" is gone ───────────────────────────────────────
  //
  // It was a ListRow over `const [connected] = useState(false)` — a variable
  // with no setter, which nothing could ever set — whose only behaviour was an
  // Alert describing an integration that does not exist. Two states were
  // rendered ("Accounting Connected", "Syncing from Xero") that were
  // unreachable by construction.
  //
  // A control that explains what it would do if it were built is worse than no
  // control: it is indistinguishable from one that is merely misconfigured, so
  // an owner who wants it goes looking for the setting, or asks for help
  // enabling something nobody has written. The manual entry beside it is real
  // and works.
  //
  // Xero and QuickBooks are each an OAuth app, a token store, a sync worker and
  // a chart-of-accounts mapping. When that exists it earns a row here.

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Financial Checks</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        {/* Says what this is before it says anything about the gym. The
            sentence comes from src/lib/finReview.ts rather than being typed
            here, so a rewrite of this screen cannot quietly drop the one line
            that stops the grade below being read as a verdict from a model. */}
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          {reviewBasis()}
        </Text>

        {!hydrated ? null : editing ? (
          /* ── entry form ───────────────────────────────────────────────── */
          <Section>
            <SectionHead title="Your Monthly Figures" note="This phone only" />
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Leave a field blank if you don't track it. {storageNote()}
            </Text>
            {FIELDS.map((f) => (
              <View key={f.key} style={{ marginBottom: sp.md }}>
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>
                  {f.label} <Text style={{ ...ty.caption, color: t.ink3 }}>({f.hint ?? cur ?? 'currency not set'})</Text>
                </Text>
                <TextInput
                  value={draft[f.key] ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={t.ink3}
                  style={input}
                />
                {/* What the records say, for the four fields Repple can work
                    out for itself. Offered, never imposed — see finReconcile.ts.
                    Churn is not among them and cannot be: nothing in
                    `memberships` records WHEN one was cancelled, so a derived
                    churn would be a guess dressed as a check. */}
                {f.key === 'mrr' || f.key === 'members' || f.key === 'revenue' || f.key === 'newMembers' ? (() => {
                  const chk = f.key === 'mrr' ? mrrCheck
                    : f.key === 'members' ? memberCheck
                    : f.key === 'revenue' ? revenueCheck
                    : newCheck;
                  const val = f.key === 'mrr' ? derivedMrr
                    : f.key === 'members' ? derivedMembers
                    : f.key === 'revenue' ? derivedRevenue
                    : derivedNew;
                  const asMoney = f.key === 'mrr' || f.key === 'revenue';
                  const fmtv = (n: number) => (asMoney ? money(n) : n.toLocaleString());
                  const note = reconcileNote(chk, f.label.toLowerCase(), fmtv);
                  if (!note) return null;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 6 }}>
                      {/* s3 as caption ink does not clear 4.5:1 — it is a series
                          colour, drawn for chart lines at the 3:1 a mark needs.
                          reconcileNote() already says the two figures differ. */}
                      {chk.state === 'differs' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3, flexShrink: 0 }} /> : null}
                      <Text style={{ ...ty.caption, color: chk.state === 'differs' ? t.ink2 : t.ink3, flex: 1 }}>
                        {note}
                      </Text>
                      {val != null ? (
                        <Ghost label="Use It" onPress={() => setDraft((d) => ({ ...d, [f.key]: String(val) }))} />
                      ) : null}
                    </View>
                  );
                })() : null}
              </View>
            ))}
            <View style={{ height: sp.sm }} />
            <Cta label="Save & Review" wide onPress={save} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Cancel" onPress={() => setEditing(false)} />
          </Section>
        ) : !ready ? (
          /* ── honest empty state: no hero of zeros ─────────────────────── */
          <Section>
            {/* Two different people arrive here and they must not read the same
                sentence. One has typed nothing. The other typed their member
                counts, left revenue blank, and would otherwise be told "nothing
                is shown until it comes from you" about figures they had just
                entered — which reads as the screen having lost them. */}
            <SectionHead title={anyEntered(fin) ? 'Revenue Is Missing' : 'No Figures Yet'} />
            <Text style={{ ...ty.body, color: t.ink2 }}>
              {anyEntered(fin)
                ? 'Your figures are saved. The review still needs your total revenue for the month — margin, the health score and every recommendation below are a share of it, and without it there is nothing honest to work them out from.'
                : "Enter this month's revenue, expenses and membership numbers. Nothing is shown until it comes from you."}
            </Text>
            {/* Before they type, not after. Somebody deciding whether to keep
                their P&L here needs to know it is kept nowhere else while the
                decision is still theirs to make. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {storageNote()}
            </Text>
            <View style={{ height: sp.lg }} />
            <Cta label={anyEntered(fin) ? 'Add My Revenue' : 'Enter My Figures'} wide onPress={openEditor} />
          </Section>
        ) : r ? (
          <>
            {/* ── the hero ─────────────────────────────────────────────── */}
            <Hero
              label="Health Score"
              figure={fig(r.score)}
              unit="/100"
              note={cur
                ? `Grade ${r.grade} · ${money(r.netProfit)} net profit on a ${r.marginPct.toFixed(0)}% margin`
                : `Grade ${r.grade} · a ${r.marginPct.toFixed(0)}% net margin. The amounts are not written here because this gym has not set its currency.`}
              arc={r.score / 100}
              arcLabel="health score"
            />

            {/* The score is built on what was typed. If the register disagrees,
                say so here rather than only inside the edit form — this is the
                screen somebody acts on. */}
            {[mrrCheck, memberCheck, revenueCheck, newCheck].some((c) => c.state === 'differs') ? (
              <Notice
                tone={t.s3}
                kicker="Worth a look"
                title="Your figures and your records disagree"
                note={[
                  mrrCheck.state === 'differs' ? reconcileNote(mrrCheck, 'MRR', money) : null,
                  memberCheck.state === 'differs' ? reconcileNote(memberCheck, 'member count', (n) => n.toLocaleString()) : null,
                  revenueCheck.state === 'differs' ? reconcileNote(revenueCheck, 'monthly revenue', money) : null,
                  newCheck.state === 'differs' ? reconcileNote(newCheck, 'members joined this month', (n) => n.toLocaleString()) : null,
                ].filter(Boolean).join(' ') + ' This score is worked out from what you entered, not from the register.'}
              />
            ) : null}

            <Rule />

            <Section>
              <SectionHead title="What These Figures Say" note={`Grade ${r.grade}`} />
              <Text style={{ ...ty.body, color: t.ink2 }}>{r.summary}</Text>
            </Section>

            <Rule />

            <Section>
              <SectionHead title="This Month" note="From your figures" />
              {[0, 2, 4, 6].map((i) => (
                <View key={i} style={{ marginTop: i === 0 ? 0 : sp.lg }}>
                  <KpiRow items={kpis.slice(i, i + 2).map(([l, v]) => ({ label: l, value: v }))} />
                </View>
              ))}
            </Section>

            {r.strengths.length > 0 ? (<>
              <Rule />
              <Section>
                <SectionHead title="What's Working" />
                {flagList(r.strengths)}
              </Section>
            </>) : null}

            <Rule />

            {/* A heading with nothing under it is a section that failed to
                load, and that is how an A-grade gym read this one: every flag
                had gone to "What's Working" and this drew its title over blank
                space. A gym with nothing to fix is told so. */}
            <Section>
              <SectionHead title="Where to Improve" />
              {r.improvements.length > 0 ? flagList(r.improvements) : (
                <Text style={{ ...ty.body, color: t.ink2 }}>
                  Nothing is flagged on these figures — margin, retention, growth and your
                  recurring mix all read well this month.
                </Text>
              )}
            </Section>

            <Rule />

            <Section>
              <Cta label="Create a Promotion" wide onPress={() => router.push('/(owner)/promotions')} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Update My Figures" onPress={openEditor} />
              {/* Two separate things an owner has to be told, and neither
                  substitutes for the other: what produced the grade above, and
                  where the numbers behind it are kept. */}
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
                Worked out by fixed rules from the figures you entered. No accounting is connected,
                and this is not financial advice.
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
                {storageNote()}
              </Text>
            </Section>
          </>
        ) : null}

        <Rule />


      </ScrollView>
    </SafeAreaView>
  );
}
