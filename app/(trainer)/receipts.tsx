// Coach · Payments Taken Outside Repple. Cash, a bank transfer, and the front
// desk.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Money in was read from two tables and only two, both written by the
// stripe-webhook. So every figure on the Money screen covered card payments
// taken through Repple and nothing else, and for most self-employed coaches
// card is the MINORITY of income. The screen was not slightly short — it
// understated the business by a large fraction, said so honestly in four
// separate places, and a coach who reads a figure a third of what they know
// they earned stops trusting the money features altogether.
//
// ── WHAT A COACH MAY NOT DO HERE ───────────────────────────────────────────
//
// Record their own pay. This is a coach writing down WHAT A CLIENT PAID THEM,
// money that has already moved, outside this app, from a client to them. It is
// not a claim about what anybody owes them and nothing that pays a coach reads
// this table.
//
// The distinction matters because the word "earnings" means two opposite things
// in this product. A GYM PAYING AN EMPLOYED TRAINER is read-only to that
// trainer everywhere — a self-authored payroll figure is a self-authored
// invoice to an employer — and none of that changes. `receiptBlockers` refuses a
// payment from the coach to themselves and part 190 refuses the same row with a
// CHECK constraint: the screen explains it, the database enforces it.
//
// ── The two ways this screen could produce a wrong figure ──────────────────
//
//   · DOUBLE COUNTING. A coach records the cash for a pack Stripe also took,
//     and it lands in the Money screen twice. Nothing can detect it: the two
//     rows share no key and this app is told nothing about either payment. So
//     `RECEIPT_MAY_DOUBLE_COUNT` is on the page, above the button, rather than
//     the app pretending it could tell.
//   · A CONFIDENT EMPTY. An empty list under 'error' would tell a coach the
//     cash they took last week is not on record. `receiptsEmptyLine` says
//     "could not be read" and "you have recorded none" as different sentences.
//
// ── The currency is the gate ───────────────────────────────────────────────
//
// Resolved by `fetchInvoiceCurrency`, which resolves it exactly the way part
// 138's `issue_coach_invoice` does — the coach's own packages when they agree,
// else the gym's setting — rather than holding a second opinion that could
// differ from the one the invoice screen shows. There is no fallback: Repple is
// white-labelled, `tenants.currency` is nullable on purpose, and an amount with
// the wrong three letters on it is a different amount of money.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useToday } from '../../src/ui/today';
import { isQueryableId } from '../../src/lib/clientDrift';
import { minorMoney } from '../../src/lib/coachMoney';
import { invoiceDayLabel, plusDays } from '../../src/lib/coachInvoice';
import {
  receiptBlockers, receiptsTaken, receiptsEmptyLine, methodLabel, RECEIPT_METHODS,
  RECEIPT_IS_YOUR_WORD, RECEIPT_IS_NOT_PAY, RECEIPT_MAY_DOUBLE_COUNT, RECEIPT_IS_NOT_A_DOCUMENT,
  type CoachReceipt, type ReceiptDraft, type ReceiptMethod,
} from '../../src/lib/coachReceipts';
import { fetchMyReceipts, recordReceipt, deleteReceipt } from '../../src/ui/coachReceipts';
import { fetchInvoiceCurrency, type InvoiceCurrency } from '../../src/ui/coachInvoices';
import { supabase } from '../../src/lib/supabase';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { currencyGapLine, currencyGapOfStatus } from '../../src/lib/currencyGap';
import { myCurrencyLine } from '../../src/lib/currencySource';
import { BACK_ICON } from '../../src/ui/direction';

const DASH = '—';

export default function Receipts() {
  const t = useTheme();
  const router = useRouter();
  const roster = useRoster();

  const [rows, setRows] = useState<CoachReceipt[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [ccy, setCcy] = useState<InvoiceCurrency>({ currency: null, source: null, status: 'loading', gap: null });
  /** The signed-in coach's own id, for the one refusal in `receiptBlockers`.
   *  Null while it is being read, which makes the guard inert for that instant
   *  — acceptable because the same row is refused by a CHECK constraint in the
   *  database whatever this screen believes. */
  const [me, setMe] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [paidBy, setPaidBy] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [dayText, setDayText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, cur, auth] = await Promise.all([
      fetchMyReceipts(),
      fetchInvoiceCurrency(),
      supabase.auth.getUser(),
    ]);
    setRows(list.rows);
    setStatus(list.status);
    setCcy(cur);
    setMe(auth?.data?.user?.id ?? null);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // `load` is the receipts, the currency they are printed in and who is
  // signed in, in one call; the roster beside it is where the client names on
  // these rows come from. The currency travels with the amounts on purpose —
  // a refreshed list under a stale currency is a wrong number, not an old one.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([load(), roster.refresh()]),
    [load, roster],
  ));

  // ── the day this screen stamps on a payment ─────────────────────────
  //
  // `useToday()`, not `isoToday(new Date())`. This is not a label: `receivedOn`
  // below is `dayText.trim() || today`, so when the coach does not type a date
  // this value is WRITTEN as the day money arrived. And a bare read in the render body
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
  const receivedOn = dayText.trim() || today;

  const taken = useMemo(() => receiptsTaken(rows), [rows]);

  const draft = (): ReceiptDraft => ({
    paidBy, amountText, currency: ccy.currency, method, receivedOn,
    note: note.trim() || null, clientId, coachId: me,
  });
  const blockers = receiptBlockers(draft());
  const canRecord = blockers.length === 0 && !busy;

  const reset = () => { setPaidBy(''); setClientId(null); setAmountText(''); setMethod('cash'); setDayText(''); setNote(''); };

  const onRecord = async () => {
    const d = draft();
    const problems = receiptBlockers(d);
    if (problems.length) { Alert.alert('Not yet', problems.join('\n\n')); return; }
    setBusy(true);
    const res = await recordReceipt(d);
    setBusy(false);
    if (!res.ok) {
      Alert.alert('That payment was not recorded', res.error || 'Nothing was written. Try again in a moment.');
      return;
    }
    setOpen(false);
    reset();
    await load();
  };

  const onRemove = (r: CoachReceipt) => {
    Alert.alert(
      'Remove this line?',
      // The honest framing. There is no document to cancel and nobody was told,
      // so this is a private ledger line being corrected rather than a record
      // being destroyed — but it does leave the Money screen smaller, and the
      // coach is the only person who will ever know it was here.
      `${minorMoney(r.amountCents, r.currency) ?? DASH} from ${r.paidBy}, ${invoiceDayLabel(r.receivedOn)}. Nobody was ever told about this line and no document was made from it, so removing it only changes your own figures. It cannot be undone.`,
      [
        { text: 'Keep It', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const gone = await deleteReceipt(r.id);
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
  // tells neither of them anything. src/lib/currencyGap.ts holds the wording.
  //
  // And 'unset' is itself several facts since part 940, which is why this now
  // branches the way app/(trainer)/invoices.tsx does. A gym was once the only
  // place a currency could live, so "no currency has been set for you" could
  // safely end by naming a gym owner. A coach with no gym has no owner to
  // name, and that sentence sent them to look for a person who does not exist
  // — while the setting they could actually make sat one screen away in
  // Settings. `ccy.gap` carries which it is: the gym has set none, they have
  // chosen none, there is no coach record, or part 940 is not applied. Only
  // the first names an owner.
  const curGap = currencyGapOfStatus({ currency: ccy.currency, status: ccy.status });
  const currencyBlocker = curGap
    ? curGap === 'unset'
      ? ccy.gap && ccy.gap !== 'gym-unset'
        ? myCurrencyLine(ccy.gap, 'there is nothing to record a payment in')
        : 'No currency has been set for you, so there is nothing to record a payment in. Repple is white-labelled, so there is no default that would be right for every gym. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.'
      : currencyGapLine(curGap, 'nothing can be recorded')
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>The half Repple never sees</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Cash and Transfers</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Notice
            kicker="What this is"
            title="Money you were paid outside this app"
            note={RECEIPT_IS_YOUR_WORD}
          />
        </View>

        {status === 'error' ? (
          <Notice tone={t.crit} kicker="Not read" title="Your recorded payments could not be read"
            note="This list is empty because the read failed, not because you have recorded none. Nothing below is a statement about your records." />
        ) : null}
        {status === 'partial' ? <PartialRead what="recorded payments" shown={rows.length} onPress={() => { void load(); }} /> : null}

        {currencyBlocker ? (
          <Notice tone={t.crit} kicker="Nothing can be recorded yet" title="No currency" note={currencyBlocker} />
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="What You Have Recorded" note="Counted by the day you say you were paid" />
          {status !== 'ready' ? (
            <Flag style={{ marginTop: sp.sm }}>{receiptsEmptyLine(status)}</Flag>
          ) : taken.pots.length ? (
            <View style={{ marginTop: sp.sm }}>
              {taken.pots.map((p) => (
                <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>
                    {p.count} {p.count === 1 ? 'payment' : 'payments'} in {p.currency}
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
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{receiptsEmptyLine(status)}</Text>
          )}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{RECEIPT_MAY_DOUBLE_COUNT}</Text>
        </Section>

        <Rule />

        <Section>
          {/* A count is a claim about the coach's own records, so it is only
              made from a list that is the whole list. `fetchMyReceipts` answers
              `{rows: [], status: 'error'}` for a refused read, and "Nothing
              recorded yet" over that is a sentence about somebody's income that
              this app cannot support. */}
          <SectionHead title={isWhole(status) ? (rows.length ? `${rows.length} recorded` : 'Nothing recorded yet') : 'What is on record'} />
          {rows.map((r) => (
            <View key={r.id} style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
                <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{r.paidBy}</Text>
                <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{minorMoney(r.amountCents, r.currency) ?? DASH}</Text>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }} numberOfLines={2}>
                {invoiceDayLabel(r.receivedOn)} · {methodLabel(r.method)}{r.note ? ` · ${r.note}` : ''}
              </Text>
              {/* Never a bare dash where an amount belongs. An amount with no
                  currency on it is not an amount of money, and it is counted
                  out of the figures above rather than shown as nothing. */}
              {!minorMoney(r.amountCents, r.currency) ? (
                <Flag style={{ marginTop: sp.sm }}>
                  This one has no readable amount on it, so it is in no figure above.
                </Flag>
              ) : null}
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                <Pressable onPress={() => onRemove(r)} hitSlop={8} accessibilityRole="button"
                  accessibilityLabel={`Remove the payment from ${r.paidBy}`} style={{ paddingVertical: sp.xs }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {!rows.length && status === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{receiptsEmptyLine('ready')}</Text>
          ) : null}
        </Section>

        <Section>
          <SectionHead title="What This Is Not" />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{RECEIPT_IS_NOT_PAY}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{RECEIPT_IS_NOT_A_DOCUMENT}</Text>
        </Section>

        <View style={{ marginTop: layout.section }}>
          <Cta label="Record a Payment" wide disabled={!!currencyBlocker} onPress={() => setOpen(true)} />
          {currencyBlocker ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{currencyBlocker}</Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, maxHeight: '90%' }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={{ ...ty.title, color: t.ink }}>A payment you took</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                Only what did not go through this app. Anything Stripe took is already counted for you.
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>Who paid you</Text>
              <TextInput value={paidBy} onChangeText={(v) => { setPaidBy(v); setClientId(null); }}
                placeholder="Their name" placeholderTextColor={t.ink3}
                accessibilityLabel="Who paid you" style={inp} />
              {/* The roster is a shortcut and not the only way in: the people
                  who pay a coach in cash are mostly the ones who were never
                  given an account, so typing a name is a first-class path. */}
              {roster.roster.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.sm }}>
                  <View style={{ flexDirection: 'row', gap: sp.sm }}>
                    {roster.roster.slice(0, 20).map((c) => (
                      <Pressable key={c.id} onPress={() => { setPaidBy(c.name); setClientId(isQueryableId(c.id) ? c.id : null); }}
                        accessibilityRole="button" accessibilityLabel={`Paid by ${c.name}`}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: paidBy === c.name ? t.brand : t.surface2 }}>
                        <Text style={{ ...ty.caption, color: paidBy === c.name ? '#fff' : t.ink2 }}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>
                Amount{ccy.currency ? ` in ${ccy.currency}` : ''}
              </Text>
              {/* A decimal pad, because money has a fractional part in every
                  currency this field will see that is not zero-decimal. See
                  scripts/check-decimals.mjs — a number pad on a money field is
                  a coach who cannot type the fifty pence. */}
              <TextInput value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad"
                placeholder="200" placeholderTextColor={t.ink3}
                accessibilityLabel="Amount" style={inp} />

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>How it reached you</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap' }}>
                {RECEIPT_METHODS.map((m) => (
                  <Pressable key={m.id} onPress={() => setMethod(m.id)} accessibilityRole="button"
                    accessibilityLabel={m.label} accessibilityState={{ selected: method === m.id }}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: method === m.id ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, color: method === m.id ? '#fff' : t.ink2 }}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                {RECEIPT_METHODS.find((m) => m.id === method)?.note}
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>The day you were paid</Text>
              <TextInput value={dayText} onChangeText={setDayText} autoCapitalize="none" autoCorrect={false}
                placeholder={`${today}, or leave it for today`} placeholderTextColor={t.ink3}
                accessibilityLabel="The day you were paid" style={inp} />
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                {([['Today', 0], ['Yesterday', -1], ['A week ago', -7]] as [string, number][]).map(([label, n]) => {
                  const when = plusDays(today, n);
                  return (
                    <Pressable key={label} onPress={() => setDayText(dayText === when ? '' : when)}
                      accessibilityRole="button" accessibilityLabel={label}
                      accessibilityState={{ selected: receivedOn === when }}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center', backgroundColor: receivedOn === when ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.micro, color: receivedOn === when ? '#fff' : t.ink2 }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                The day the money arrived, not today. A month of cash written up in one evening belongs in the months it was taken in.
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>A note, if you want one (optional)</Text>
              <TextInput value={note} onChangeText={setNote} multiline
                placeholder="Second half of the ten pack" placeholderTextColor={t.ink3}
                accessibilityLabel="Note" style={[inp, { minHeight: 70, textAlignVertical: 'top' }]} />

              <View style={{ marginTop: sp.lg }}>
                <Flag tone={t.ink3}>{RECEIPT_MAY_DOUBLE_COUNT}</Flag>
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
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{RECEIPT_IS_NOT_A_DOCUMENT}</Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
