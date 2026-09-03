// Coach · What Your Business Costs You. Rent, insurance, courses, equipment,
// kit, travel and the accountant.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// The outgoing half of the Money screen had two sources and its empty state
// listed both: "Your Repple plan and any ad spend you record show up here."
// That was the whole of it. For a self-employed coach the largest single line
// of the year is usually the gym rent or the chair fee, and this app held no
// trace of it — nor of insurance, CPD, equipment, kit, travel between clients,
// or the accountant who prepares the return the Statement of Record is meant to
// be handed to. So the statement was one-sided by construction: every penny in,
// no penny out, given to somebody whose whole job is the difference.
//
// ── WHAT THIS SCREEN MAY NOT DO ────────────────────────────────────────────
//
// Subtract. There is no profit figure here, there is none on the Money screen,
// and there must never be one. `NO_NET_NOTE` has been a standing rule of this
// product since before this table existed, and this is the feature that makes
// breaking it possible for the first time. Four things would be wrong with the
// number: the takings are gross of Stripe's fee and the platform's, the cash
// half of the income is only what the coach wrote down, the costs half is only
// what they wrote down here, and the two sides can be in different currencies
// this app holds no rate between. `COSTS_ARE_NEVER_NETTED` says so on the page,
// because the absence of a profit figure reads as an omission unless somebody
// says it was a decision.
//
// ── And may not imply ──────────────────────────────────────────────────────
//
// That any of this is deductible. There is no allowable tick and no tax column,
// for the reason `INVOICE_TAX` gives about an invoice: what can be set against
// income turns on the coach's country, their trade and their accountant's
// judgement, and a checkbox here would be tax advice printed under somebody's
// name. `COSTS_ARE_NOT_TAX_ADVICE` is on the page too.
//
// ── The two ways this screen could produce a wrong figure ──────────────────
//
//   · DOUBLE COUNTING. Ad spend already sits against a join code and the
//     coach's own Repple plan is already read from their billing, so both are
//     under Going Out before anybody types anything. Nothing can detect a row
//     that duplicates either — they share no key — so `COSTS_NOT_TWICE` is on
//     the page, above the button, rather than the app pretending it could tell.
//   · A CONFIDENT EMPTY. An empty list under 'error' would tell a coach the
//     rent they recorded last week is not on record. `costsEmptyLine` says
//     "could not be read" and "you have recorded none" as different sentences.
//
// ── The currency is the gate ───────────────────────────────────────────────
//
// Resolved by `fetchInvoiceCurrency`, exactly as the receipts screen resolves
// it, rather than holding a second opinion that could differ from the one the
// invoice screen shows. There is no fallback: Repple is white-labelled,
// `tenants.currency` is nullable on purpose, and an amount with the wrong three
// letters on it is a different amount of money.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useToday } from '../../src/ui/today';
import { minorMoney } from '../../src/lib/coachMoney';
import { invoiceDayLabel, plusDays } from '../../src/lib/coachInvoice';
import {
  costBlockers, costsTaken, costsByCategory, costsEmptyLine, categoryLabel, COST_CATEGORIES,
  COST_IS_YOUR_WORD, COSTS_ARE_NEVER_NETTED, COSTS_ARE_NOT_TAX_ADVICE, COSTS_NOT_TWICE,
  type CoachCost, type CostDraft, type CostCategory,
} from '../../src/lib/coachCosts';
import { fetchMyCosts, recordCost, deleteCost } from '../../src/ui/coachCosts';
import { fetchInvoiceCurrency, type InvoiceCurrency } from '../../src/ui/coachInvoices';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { currencyGapLine, currencyGapOfStatus } from '../../src/lib/currencyGap';
import { myCurrencyLine } from '../../src/lib/currencySource';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

const DASH = '—';

export default function Costs() {
  const t = useTheme();
  const router = useRouter();

  const [rows, setRows] = useState<CoachCost[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [ccy, setCcy] = useState<InvoiceCurrency>({ currency: null, source: null, status: 'loading', gap: null });

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CostCategory>('rent');
  const [dayText, setDayText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, cur] = await Promise.all([fetchMyCosts(), fetchInvoiceCurrency()]);
    setRows(list.rows);
    setStatus(list.status);
    setCcy(cur);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // The same read the focus effect runs. Both halves of it, because the
  // currency is what decides whether a single one of these amounts may be
  // printed at all — a refreshed cost list under a stale currency is the one
  // combination this screen must not produce.
  const pull = usePullToRefresh(load);

  // The date the DEVICE is on, not the server's UTC date. A coach in Auckland
  // recording a payment at 10am would otherwise date it yesterday.
  // ── the day this screen stamps on a cost ─────────────────────────
  //
  // `useToday()`, not `isoToday(new Date())`. This is not a label: `paidOn`
  // below is `dayText.trim() || today`, so when the coach does not type a date
  // this value is WRITTEN as the day money went out. And a bare read in the render body
  // is only ever as fresh as the last render — this screen is registered
  // `href: null` in app/(trainer)/_layout.tsx, so it mounts once, is never torn
  // down, and does not re-render while nobody is touching it.
  //
  // So a coach who opened this screen on Sunday, went to another tab, and came
  // back on Wednesday to write something up got it dated SUNDAY — under a
  // placeholder that says "leave it for today". The record is the thing this
  // screen exists to keep, the date is the part of it that decides which month
  // it lands in, and nothing on screen would have shown the coach it was
  // wrong.
  //
  // `check:frozen-day` looks for `useMemo(…, [])` and cannot see this shape.
  // `useToday` re-reads at the next local midnight and on foreground, compares
  // before it sets, and is still the DEVICE's day rather than the server's UTC
  // one — which is the point the comment this replaces was making, and it is
  // preserved: a coach in Auckland recording at 10am must not date it
  // yesterday.
  const today = useToday();
  const paidOn = dayText.trim() || today;

  const taken = useMemo(() => costsTaken(rows), [rows]);
  const byCategory = useMemo(() => costsByCategory(rows), [rows]);

  const draft = (): CostDraft => ({
    description, amountText, currency: ccy.currency, category, paidOn,
    note: note.trim() || null,
  });
  const blockers = costBlockers(draft());
  const canRecord = blockers.length === 0 && !busy;

  const reset = () => { setDescription(''); setAmountText(''); setCategory('rent'); setDayText(''); setNote(''); };

  const onRecord = async () => {
    const d = draft();
    const problems = costBlockers(d);
    if (problems.length) { Alert.alert('Not yet', problems.join('\n\n')); return; }
    setBusy(true);
    const res = await recordCost(d);
    setBusy(false);
    if (!res.ok) {
      Alert.alert('That cost was not recorded', res.error || 'Nothing was written. Try again in a moment.');
      return;
    }
    setOpen(false);
    reset();
    await load();
  };

  const onRemove = (c: CoachCost) => {
    Alert.alert(
      'Remove this line?',
      // The honest framing. Nothing was handed to anybody and no document was
      // made from it, so this is a private ledger line being corrected — but it
      // does leave the figures smaller, and the coach is the only person who
      // will ever know it was here.
      `${minorMoney(c.amountCents, c.currency) ?? DASH} for ${c.description}, ${invoiceDayLabel(c.paidOn)}. Nobody else has ever seen this line and no document was made from it, so removing it only changes your own figures. It cannot be undone.`,
      [
        { text: 'Keep It', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const gone = await deleteCost(c.id);
              if (!gone) {
                Alert.alert('Still there', 'That line was not removed and it is still in your figures. Try again in a moment.');
                return;
              }
              await load();
            })();
          },
        },
      ],
    );
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const G = layout.gutter;

  // The gate, said as a sentence a coach can act on and naming who sets it.
  // Four causes and not two: 'partial' and 'loading' are not settled facts
  // about the gym, and sending a coach to an owner over a query that failed
  // tells neither of them anything.
  //
  // And 'unset' is itself several facts since part 940, which is why this now
  // branches the way app/(trainer)/invoices.tsx does. A gym was once the only
  // place a currency could live, so "no currency has been set for you" could
  // safely end by naming a gym owner. A coach with no gym has no owner to
  // name, and that sentence sent them to look for a person who does not exist
  // — while the setting they could actually make sat one screen away in
  // Settings. `ccy.gap` carries which it is, and only 'gym-unset' names an
  // owner.
  const curGap = currencyGapOfStatus({ currency: ccy.currency, status: ccy.status });
  const currencyBlocker = curGap
    ? curGap === 'unset'
      ? ccy.gap && ccy.gap !== 'gym-unset'
        ? myCurrencyLine(ccy.gap, 'there is nothing to record a cost in')
        : 'No currency has been set for you, so there is nothing to record a cost in. Repple is white-labelled, so there is no default that would be right for every gym. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.'
      : currencyGapLine(curGap, 'nothing can be recorded')
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>The other side of the book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>What It Costs You</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Notice
            kicker="What this is"
            title="What running your business costs"
            note={COST_IS_YOUR_WORD}
          />
        </View>

        {status === 'error' ? (
          <Notice tone={t.crit} kicker="Not read" title="Your recorded costs could not be read"
            note="This list is empty because the read failed, not because you have recorded none. Nothing below is a statement about your records." />
        ) : null}
        {status === 'partial' ? <PartialRead what="recorded costs" shown={rows.length} onPress={() => { void load(); }} /> : null}

        {currencyBlocker ? (
          <Notice tone={t.crit} kicker="Nothing can be recorded yet" title="No currency" note={currencyBlocker} />
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="What You Have Recorded" note="Counted by the day you say you paid" />
          {status !== 'ready' ? (
            <Flag style={{ marginTop: sp.sm }}>{costsEmptyLine(status)}</Flag>
          ) : taken.pots.length ? (
            <View style={{ marginTop: sp.sm }}>
              {taken.pots.map((p) => (
                <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>
                    {p.count} {p.count === 1 ? 'cost' : 'costs'} in {p.currency}
                  </Text>
                  <Text style={{ ...ty.body, fontWeight: '700', ...numeric, color: t.ink }}>
                    {minorMoney(p.minorUnits, p.currency) ?? DASH}
                  </Text>
                </View>
              ))}
              {/* Currencies are never added together, here or anywhere. */}
              {taken.pots.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  These are separate amounts of money and are deliberately not added together.
                </Flag>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{costsEmptyLine(status)}</Text>
          )}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{COSTS_ARE_NEVER_NETTED}</Text>
        </Section>

        {/* ── where it went ───────────────────────────────────────────────
            Per category AND per currency. A category with nothing in it is
            absent rather than present at zero: a "Kit — 0.00" line is a
            statement that this coach spent nothing on kit, and what it would
            actually mean is that they have not written any down. */}
        {status === 'ready' && byCategory.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Where It Went" note={`${byCategory.length} ${byCategory.length === 1 ? 'kind' : 'kinds'}`} />
              {byCategory.map((c) => (
                <View key={c.category} style={{ paddingVertical: sp.sm, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{c.label}</Text>
                  {c.taken.pots.map((p) => (
                    <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>
                        {p.count} {p.count === 1 ? 'line' : 'lines'} in {p.currency}
                      </Text>
                      <Text style={{ ...ty.label, ...numeric, color: t.ink }}>
                        {minorMoney(p.minorUnits, p.currency) ?? DASH}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </Section>
          </>
        ) : null}

        <Rule />

        <Section>
          {/* A count is a claim about the coach's own records, so it is only
              made from a list that is the whole list. `fetchMyCosts` answers
              `{rows: [], status: 'error'}` for a refused read, and "Nothing
              recorded yet" over that is a sentence this app cannot support. */}
          <SectionHead title={isWhole(status) ? (rows.length ? `${rows.length} recorded` : 'Nothing recorded yet') : 'What is on record'} />
          {rows.map((c) => (
            <View key={c.id} style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
                <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{c.description}</Text>
                <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{minorMoney(c.amountCents, c.currency) ?? DASH}</Text>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }} numberOfLines={2}>
                {invoiceDayLabel(c.paidOn)} · {categoryLabel(c.category)}{c.note ? ` · ${c.note}` : ''}
              </Text>
              {/* Never a bare dash where an amount belongs. An amount with no
                  currency on it is not an amount of money, and it is counted
                  out of the figures above rather than shown as nothing. */}
              {!minorMoney(c.amountCents, c.currency) ? (
                <Flag style={{ marginTop: sp.sm }}>
                  This one has no readable amount on it, so it is in no figure above.
                </Flag>
              ) : null}
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                <Pressable onPress={() => onRemove(c)} hitSlop={8} accessibilityRole="button"
                  accessibilityLabel={`Remove the cost for ${c.description}`} style={{ paddingVertical: sp.xs }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {!rows.length && status === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{costsEmptyLine('ready')}</Text>
          ) : null}
        </Section>

        <Section>
          <SectionHead title="What This Is Not" />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{COSTS_ARE_NOT_TAX_ADVICE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{COSTS_NOT_TWICE}</Text>
        </Section>

        <View style={{ marginTop: layout.section }}>
          <Cta label="Record a Cost" wide disabled={!!currencyBlocker} onPress={() => setOpen(true)} />
          {currencyBlocker ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{currencyBlocker}</Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, maxHeight: '90%' }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={{ ...ty.title, color: t.ink }}>Something you paid for</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                Leave out your Repple plan and your ad spend. Both are already counted for you.
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>What it was for</Text>
              <TextInput value={description} onChangeText={setDescription}
                placeholder="September rent at the gym" placeholderTextColor={t.ink3}
                accessibilityLabel="What it was for" style={inp} />

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>What kind of cost</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap' }}>
                {COST_CATEGORIES.map((c) => (
                  <Pressable key={c.id} onPress={() => setCategory(c.id)} accessibilityRole="button"
                    accessibilityLabel={c.label} accessibilityState={{ selected: category === c.id }}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: category === c.id ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, color: category === c.id ? '#fff' : t.ink2 }}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                {COST_CATEGORIES.find((c) => c.id === category)?.note}
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>
                Amount{ccy.currency ? ` in ${ccy.currency}` : ''}
              </Text>
              {/* A decimal pad, because money has a fractional part in every
                  currency this field will see that is not zero-decimal. See
                  scripts/check-decimals.mjs — a number pad on a money field is
                  a coach who cannot type the fifty pence. */}
              <TextInput value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad"
                placeholder="450" placeholderTextColor={t.ink3}
                accessibilityLabel="Amount" style={inp} />

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>The day you paid it</Text>
              <TextInput value={dayText} onChangeText={setDayText} autoCapitalize="none" autoCorrect={false}
                placeholder={`${today}, or leave it for today`} placeholderTextColor={t.ink3}
                accessibilityLabel="The day you paid it" style={inp} />
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                {([['Today', 0], ['Yesterday', -1], ['A week ago', -7]] as [string, number][]).map(([label, n]) => {
                  const when = plusDays(today, n);
                  return (
                    <Pressable key={label} onPress={() => setDayText(dayText === when ? '' : when)}
                      accessibilityRole="button" accessibilityLabel={label}
                      accessibilityState={{ selected: paidOn === when }}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center', backgroundColor: paidOn === when ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.micro, color: paidOn === when ? '#fff' : t.ink2 }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                The day the money went out, not today. A quarter of receipts written up in one evening belongs in the months they were paid in.
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>A note, if you want one (optional)</Text>
              <TextInput value={note} onChangeText={setNote} multiline
                placeholder="Paid by standing order" placeholderTextColor={t.ink3}
                accessibilityLabel="Note" style={[inp, { minHeight: 70, textAlignVertical: 'top' }]} />

              <View style={{ marginTop: sp.lg }}>
                <Flag tone={t.ink3}>{COSTS_NOT_TWICE}</Flag>
              </View>

              {blockers.length ? (
                <View style={{ marginTop: sp.md }}>
                  {blockers.map((b) => <Flag key={b} style={{ marginTop: sp.xs }}>{b}</Flag>)}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}>
                  <Cta label="Cancel" tone={t.surface2} wide onPress={() => { setOpen(false); reset(); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Cta label={busy ? 'Recording…' : 'Record It'} wide disabled={!canRecord} onPress={() => { void onRecord(); }} />
                </View>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{COSTS_ARE_NOT_TAX_ADVICE}</Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
