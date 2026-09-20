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
import { Rule, Section, SectionHead, Cta, PageHead, Notice, Flag, PartialRead, FigureCard, Donut, Legend, Expandable, type Tone, type Slice } from '../../src/ui/kit';
import { sharePercent } from '../../src/lib/sharePercent';
import { num } from '../../src/lib/format';
import { sp, layout, radius, type as ty, numeric, font } from '../../src/theme/scale';
import { useToday } from '../../src/ui/today';
import { minorMoney } from '../../src/lib/coachMoney';
import { invoiceDayLabel, plusDays } from '../../src/lib/coachInvoice';
import {
  costBlockers, costsTaken, costsByCategory, costsEmptyLine, categoryLabel, COST_CATEGORIES,
  COST_IS_YOUR_WORD, COSTS_ARE_NEVER_NETTED, COSTS_ARE_NOT_TAX_ADVICE, COSTS_NOT_TWICE,
  type CoachCost, type CostDraft, type CostCategory,
} from '../../src/lib/coachCosts';
import {
  linesByMonth, biggestLines,
  MONTHS_ARE_WHAT_YOU_WROTE_DOWN, BIGGEST_IS_OF_WHAT_YOU_RECORDED, type BookLine,
} from '../../src/lib/moneyBook';
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

  /* ── the two questions an expense list is actually opened for ───────────
     "How much in September" and "what is the biggest thing in here". This
     screen answered neither: pots, categories and a flat list, with `paid_on`
     sitting unread on every row.

     A month total is NOT a net and does not breach `COSTS_ARE_NEVER_NETTED` —
     nothing is subtracted from anything here, on this screen or anywhere else,
     and the rule is about the difference between two sides of a book rather
     than about adding one side up. src/lib/moneyBook.ts does the folding so the
     two currency rules — never merged, never ranked against each other — are
     kept in one place for both books. */
  const lines = useMemo((): BookLine[] => rows.map((c) => ({
    id: c.id,
    // The day the coach says the money WENT OUT. A quarter of receipts written
    // up in one evening belongs in the months they were paid in, and this is
    // the field that decides which month each one lands in.
    day: c.paidOn,
    amountCents: c.amountCents,
    currency: c.currency,
    label: c.description,
  })), [rows]);

  const byMonth = useMemo(() => linesByMonth(lines), [lines]);
  const biggest = useMemo(() => biggestLines(lines), [lines]);

  /* ── the mix, one ring per currency ──────────────────────────────────────
   * Off the same `byCategory` the rows under the ring are drawn from, and only
   * ever rendered inside the whole-read branch those rows sit in. */
  const CATEGORY_TONE: Record<string, Tone> = { rent: 'blue', insurance: 'purple', education: 'teal', equipment: 'orange', kit: 'pink', travel: 'amber', professional: 'brand', other: 'neutral' };
  const categoryRings = taken.pots.map((pot) => {
    const slices: Slice[] = byCategory.map((g) => {
      const part = g.taken.pots.find((x) => x.currency === pot.currency)?.minorUnits ?? 0;
      return { label: g.label, tone: CATEGORY_TONE[g.category] ?? 'neutral', value: part, shown: sharePercent(part, pot.minorUnits) };
    }).filter((x) => (x.value ?? 0) > 0);
    const centre = minorMoney(pot.minorUnits, pot.currency);
    return {
      currency: pot.currency, slices, centre,
      spoken: `Where it went in ${pot.currency}, ${centre ?? 'no figure'}: ${slices.map((x) => `${x.label} ${x.shown ?? 'no figure'}`).join(', ')}`,
    };
  });

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
        {/* The board's head — back at the leading edge, the title centred,
            the way app/(trainer)/money.tsx opens. The eyebrow that stood here
            ("The other side of the book") was a line of prose above the title; what it said is
            still said by the first card below. */}
        <PageHead title="What It Costs You" />

        {status === 'error' ? (
          <Notice tone={t.crit} kicker="Not read" title="Your recorded costs could not be read"
            note="This list is empty because the read failed, not because you have recorded none. Nothing below is a statement about your records." />
        ) : null}
        {status === 'partial' ? <PartialRead what="recorded costs" shown={rows.length} onPress={() => { void load(); }} /> : null}

        {currencyBlocker ? (
          <Notice tone={t.crit} kicker="Nothing can be recorded yet" title="No currency" note={currencyBlocker} />
        ) : null}


        {/* Round five: the screen opens on its figure. The kit's figure card,
            one figure per currency and never one over both, with the amber
            mark this side of the book carries everywhere. A dash and
            `costsEmptyLine`'s sentence under any read that was not whole; the word
            "Nothing" — not a dash, and not a money nought, which would need a
            currency — where the read was whole and there is nothing in it.

            The card of prose that opened the page and the paragraph that
            closed this card are behind What This Is, below, word for word;
            one line of the caveat stays beside the figure it qualifies. */}
        <FigureCard title="What You Have Recorded" period="All you have recorded" source="Your own record"
          figure={status === 'ready' && !taken.pots.length ? 'Nothing' : null}
          detail={status === 'ready' && taken.pots.length ? undefined : costsEmptyLine(status)}
          figures={status === 'ready' && taken.pots.length ? taken.pots.map((p) => ({
            key: p.currency,
            figure: minorMoney(p.minorUnits, p.currency),
            comparison: `${num(p.count)} ${p.count === 1 ? 'cost' : 'costs'} in ${p.currency}`,
            tone: t.data.amber,
            spoken: `${minorMoney(p.minorUnits, p.currency) ?? 'no figure'}, ${num(p.count)} ${p.count === 1 ? 'cost' : 'costs'} in ${p.currency}`,
          })) : undefined}>
          {/* Currencies are never added together, here or anywhere. */}
          {status === 'ready' && taken.pots.length > 1 ? (
            <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
              These are separate amounts of money and are deliberately not added together.
            </Flag>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Never taken off what you were paid. There is no profit figure anywhere in this app.</Text>
        </FigureCard>

        <Expandable title="What This Is" note="Your own record of what went out, and why nothing is netted">
          <Text style={{ ...ty.caption, color: t.ink3 }}>{COST_IS_YOUR_WORD}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{COSTS_ARE_NEVER_NETTED}</Text>
        </Expandable>

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
              {/* The mix as a ring, ONE PER CURRENCY: a ring is a whole, and
                  two moneys are not one. Each slice is this category's pot in
                  that currency and the share is of that currency's own total.
                  The rows under it keep every amount and every count. */}
              {categoryRings.map((d, i) => (
                <View key={d.currency} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.lg, marginTop: i === 0 ? 0 : sp.lg, marginBottom: sp.md }}>
                  <Donut slices={d.slices} centre={d.centre} sub="recorded" spoken={d.spoken} />
                  <Legend items={d.slices} />
                </View>
              ))}
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

        {/* ── by month ────────────────────────────────────────────────────
            Drawn only under `isWhole(status)`, like every other figure here: a
            month total over a truncated read is a subtotal with a month's name
            on it, and over a refused read it is a claim about somebody's
            spending made out of our own failure.

            A month is a slice of ONE side of the book. Nothing is taken off
            anything — see `COSTS_ARE_NEVER_NETTED`, which is about the
            difference between the two sides and is not touched by adding one
            of them up by month. */}
        {status === 'ready' && byMonth.months.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="By Month" note="Counted by the day you say you paid" />
              {byMonth.months.map((m) => (
                <View key={m.key} style={{ paddingVertical: sp.sm, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{m.label}</Text>
                  {/* One figure per currency and never one per month. A coach
                      paying rent in dirhams and an insurer in sterling has two
                      amounts of money in September and not a sum. */}
                  {m.taken.pots.map((p) => (
                    <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>
                        {p.count} {p.count === 1 ? 'line' : 'lines'} in {p.currency}
                      </Text>
                      <Text style={{ ...ty.label, ...numeric, color: t.ink }}>
                        {minorMoney(p.minorUnits, p.currency) ?? DASH}
                      </Text>
                    </View>
                  ))}
                  {m.taken.unlabelled + m.taken.unpriced ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                      {m.taken.unlabelled + m.taken.unpriced} {m.taken.unlabelled + m.taken.unpriced === 1 ? 'line has' : 'lines have'} no readable amount and {m.taken.unlabelled + m.taken.unpriced === 1 ? 'is' : 'are'} in no figure here.
                    </Text>
                  ) : null}
                </View>
              ))}
              {/* A day that will not read belongs to no month. Swept into this
                  one it would make a month too big; dropped in silence it would
                  make the months add up to less than the figure above them. */}
              {byMonth.undated ? (
                <Flag style={{ marginTop: sp.sm }}>
                  {byMonth.undated} {byMonth.undated === 1 ? 'cost has' : 'costs have'} a day that could not be read, so {byMonth.undated === 1 ? 'it is' : 'they are'} in none of these months. {byMonth.undated === 1 ? 'It is' : 'They are'} still in the total above.
                </Flag>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{MONTHS_ARE_WHAT_YOU_WROTE_DOWN}</Text>
            </Section>
          </>
        ) : null}

        {/* ── the biggest line ────────────────────────────────────────────
            ONE PER CURRENCY, because "the largest cost" is not a question with
            a single answer over a book in two moneys — 1,200 dirhams is a
            smaller amount than 450 pounds and a larger integer, and this app
            holds no rate that could say so. A coach with one currency, which is
            all of them today, sees exactly one line. */}
        {status === 'ready' && biggest.top.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead title={biggest.top.length === 1 ? 'The Biggest Line' : 'The Biggest Line In Each Currency'} />
              {biggest.top.map((b) => (
                <View key={b.currency} style={{ paddingVertical: sp.sm, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
                    <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{b.line.label}</Text>
                    <Text style={{ ...ty.body, ...font('700'), ...numeric, color: t.ink }}>
                      {minorMoney(b.minorUnits, b.currency) ?? DASH}
                    </Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{invoiceDayLabel(b.line.day)}</Text>
                </View>
              ))}
              {biggest.top.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  One for each currency. These are separate amounts of money and are deliberately not ranked against one another — there is no rate in this app that could put them in an order.
                </Flag>
              ) : null}
              {/* Counted out rather than quietly ignored. A line with no
                  readable amount cannot be the biggest anything, and saying how
                  many were left out stops the answer being read as "and there
                  is nothing larger than this". */}
              {biggest.skipped ? (
                <Flag style={{ marginTop: sp.sm }}>
                  {biggest.skipped} {biggest.skipped === 1 ? 'line has' : 'lines have'} no readable amount on {biggest.skipped === 1 ? 'it' : 'them'}, so {biggest.skipped === 1 ? 'it was' : 'they were'} not compared with anything.
                </Flag>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{BIGGEST_IS_OF_WHAT_YOU_RECORDED}</Text>
            </Section>
          </>
        ) : null}


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
                  <Text style={{ ...ty.label, ...font('500'), color: t.ink3 }}>Remove</Text>
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
