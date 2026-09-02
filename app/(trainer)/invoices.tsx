// Coach · Invoices. The document a self-employed trainer can hand to the
// person who paid them, and the record of what they have already handed over.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Stripe Connect takes the money and produces nothing a coach can give
// anybody. `client_purchases` is a line in this app's ledger — no number, no
// name, no statement of what was sold — and it does not exist at all for the
// half of a working book that pays in cash, by transfer, or through a gym. So
// "can you send me something for that?" had no answer, and the coach had no
// record of what they had already sent.
//
// ── Nothing on this screen decides what an invoice says ────────────────────
//
// The document is built by src/lib/coachInvoice.ts, which is pure and tested,
// and states on its own face that it is not a tax invoice and not a payment
// receipt. The number is allocated by part 138's `issue_coach_invoice()` under
// an advisory lock, because a sequence a screen allocated could collide with
// the coach's own second device. This file reads, collects what the coach
// types, and draws.
//
// ── THE CURRENCY IS THE GATE ───────────────────────────────────────────────
//
// Repple is white-labelled and `tenants.currency` is NULLABLE ON PURPOSE (part
// 99): null means "this gym has not told us", not "dollars". An invoice with
// the wrong three letters on it is worse than no invoice, because it reads as a
// considered figure and it is a different amount of money. So the Issue button
// is dead until a currency has been established, and the screen says which
// setting is missing and who sets it — rather than offering a form that ends in
// a server refusal the coach cannot act on.
//
// ── An empty list means two different things ───────────────────────────────
//
// Under 'ready' the coach has issued nothing. Under 'error' the list could not
// be read, and telling a self-employed person they have issued no invoices when
// the read was refused is a statement about their own business records. The
// two are drawn differently and the totals are withheld under anything but a
// whole read — a sum over a page of a longer list is not a smaller total.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useBrand } from '../../src/ui/brand';
import { useRoster } from '../../src/ui/roster';
import { isoToday } from '../../src/lib/dayPlan';
import { isQueryableId } from '../../src/lib/clientDrift';
import { shareDoc, pdfExportAvailable } from '../../src/lib/exportShare';
import {
  coachInvoiceDoc, invoiceShareBlurb, invoiceBlockers, invoiceNumber, invoiceDayLabel,
  invoiceBook, money, kindLabel, ageingBook, invoiceAge, chaseBlocker, chaseHistoryLine,
  BUCKET_TITLE, AGEING_IS_YOUR_OWN_RECORD, INVOICE_DUE_NOT_A_TERM, plusDays,
  type AgeBucket,
  type CoachInvoice, type InvoiceDraft, type InvoiceKind,
} from '../../src/lib/coachInvoice';
import { minorMoney } from '../../src/lib/coachMoney';
import {
  fetchMyInvoices, fetchInvoiceIssuer, fetchInvoiceCurrency, issueInvoice, voidInvoice, remindInvoice,
  type InvoiceCurrency,
} from '../../src/ui/coachInvoices';
import { useMyCoachLogo } from '../../src/ui/coachLogo';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { currencyGapLine, currencyGapOfStatus } from '../../src/lib/currencyGap';

const DASH = '—';

export default function Invoices() {
  const t = useTheme();
  const router = useRouter();
  const { appName } = useBrand();
  const roster = useRoster();

  const [rows, setRows] = useState<CoachInvoice[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  // Its own state and its own status: the issuer name fails independently of
  // the list, and a failed name must not be papered over with the platform's
  // own — that would put the wrong business on a financial document.
  const [issuer, setIssuer] = useState<{ name: string | null; status: LoadStatus }>({ name: null, status: 'loading' });
  const logo = useMyCoachLogo();
  const [ccy, setCcy] = useState<InvoiceCurrency>({ currency: null, source: null, status: 'loading' });

  const [open, setOpen] = useState(false);
  const [billTo, setBillTo] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  // Typed, and empty by default. There is no offered "30 days" and no offered
  // "14 days": a payment term this app suggested would be printed on a document
  // under the coach's name, and most coaches settle on terms this app has never
  // been told about. Empty stays empty all the way to the column.
  const [dueText, setDueText] = useState('');
  const [kind, setKind] = useState<InvoiceKind>('requested');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // The invoice being voided, and the reason typed for it. Its own flag rather
  // than a shared one: check-runtime-traps flags sibling modals whose `visible`
  // expressions share an identifier, and it flags them because iOS will not
  // present two at once from the same parent.
  const [voidTarget, setVoidTarget] = useState<CoachInvoice | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    const [list, who, cur] = await Promise.all([fetchMyInvoices(), fetchInvoiceIssuer(), fetchInvoiceCurrency()]);
    setRows(list.rows);
    setStatus(list.status);
    setIssuer(who);
    setCcy(cur);
  }, []);

  // On focus, not on mount: a coach who issues one, backs out to the client
  // screen and comes back should see it. `load` has no dependencies, so this
  // re-runs on focus and at no other time.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const book = useMemo(() => invoiceBook(rows, status), [rows, status]);

  /** The number the next invoice will carry, or null when we cannot say.
   *
   *  Knowable under 'ready' (an empty list genuinely means 0001 is next) and
   *  under 'partial' (the read is `seq` descending, so the first page holds the
   *  highest number even when the tail was cut). Not knowable under 'loading'
   *  or 'error', where `rows` is empty for a reason that has nothing to do with
   *  how many invoices the coach has issued. */
  const nextSeq = status === 'ready' || status === 'partial' ? (rows[0]?.seq ?? 0) + 1 : null;

  // The date the DEVICE is on, not the server's UTC date. A coach in Auckland
  // issuing at 10am would otherwise date their document yesterday. Part 138
  // allows a day's grace either side for exactly this.
  const today = isoToday(new Date());

  // Aged against THE SAME `today`, which is the device's day and not the
  // server's UTC one. A coach in Auckland reading this at 10am would otherwise
  // have yesterday's arithmetic applied to their own book — every invoice a day
  // less late than it is, which is the wrong side of a chasing decision.
  const ageing = useMemo(() => ageingBook(rows, status, today), [rows, status, today]);

  const draft = (): InvoiceDraft => ({
    billTo, description, amountText, currency: ccy.currency, kind, issuedOn: today,
    dueOn: dueText.trim() || null, note: note.trim() || null,
  });
  const blockers = invoiceBlockers(draft());
  const canIssue = blockers.length === 0 && !busy;

  const reset = () => { setBillTo(''); setClientId(null); setDescription(''); setAmountText(''); setDueText(''); setKind('requested'); setNote(''); };

  const onIssue = async () => {
    const d = draft();
    const problems = invoiceBlockers(d);
    if (problems.length) { Alert.alert('Not yet', problems.join('\n\n')); return; }
    setBusy(true);
    // Only a client with a real account carries an id. Somebody the coach typed
    // into their book by hand has no `clients` row, and part 138 refuses an id
    // that is not one of the coach's own — sending one would turn an ordinary
    // invoice into a refusal.
    const linked = clientId && isQueryableId(clientId) ? clientId : null;
    const res = await issueInvoice(d, linked);
    setBusy(false);
    if (!res.ok || !res.invoice) {
      Alert.alert('That invoice was not issued', res.error || 'Nothing was written. Try again in a moment.');
      return;
    }
    setOpen(false);
    reset();
    await load();
    const issued = res.invoice;
    // What the client was told, said out loud, because "issued" and "they know
    // about it" are two different facts and this screen used to imply the
    // second from the first. The notification is a heads-up and NOT the
    // document: `coach_invoices` is readable by this coach alone, so the copy
    // in their inbox tells them to expect it from you.
    const told = res.notified === true
      ? 'They have a notification about it — not the document, which still comes from you.'
      : res.notified === false
        ? 'They could not be notified about it, so the first they will hear of it is when you send it.'
        : 'This one is not tied to an account, so nobody was notified — it goes to them when you send it.';
    Alert.alert(
      `Invoice ${invoiceNumber(issued.seq)} issued`,
      `${money(issued) ?? DASH} to ${issued.billTo}. It is in your list now. ${told}`,
      [{ text: 'Later', style: 'cancel' }, { text: 'Send it', onPress: () => { void send(issued); } }],
    );
  };

  const send = async (inv: CoachInvoice) => {
    // The coach's own mark on the coach's own invoice. Null when they have set
    // none and null when it could not be fetched, and the document is the same
    // either way — src/lib/coachLogo.ts holds that fallback rather than this
    // screen having an opinion about it.
    const doc = coachInvoiceDoc({
      invoice: inv,
      issuer: { status: issuer.status, name: issuer.name, brand: appName, logoDataUri: logo.dataUri },
    });
    Alert.alert(
      `Send invoice ${invoiceNumber(inv.seq)}`,
      invoiceShareBlurb(doc, inv) + '\n\n'
      + (pdfExportAvailable()
        ? 'It goes as a PDF through your phone’s share sheet, so it can reach them however you already talk to them.'
        : 'This build cannot produce a PDF, so it goes as plain text instead. Nothing is left out of it: every line and every caveat is in the text.'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => { void shareDoc(doc.html, doc.text, `Invoice ${invoiceNumber(inv.seq)}`); } },
      ],
    );
  };

  // A reason is required and it is typed in a sheet rather than in
  // `Alert.prompt`, which exists only on iOS — a Void button that silently does
  // nothing on Android is exactly the dead control this codebase keeps finding.
  const doVoid = async () => {
    if (!voidTarget) return;
    const reason = voidReason.trim();
    if (!reason) return;
    setBusy(true);
    const res = await voidInvoice(voidTarget.id, reason);
    setBusy(false);
    if (!res.ok) { Alert.alert('Not voided', res.error || 'Nothing changed.'); return; }
    setVoidTarget(null);
    setVoidReason('');
    await load();
  };

  /**
   * Chase one, and say what actually happened to both halves.
   *
   * Two facts, and they are reported apart because they can differ: the chase
   * was RECORDED against the coach's own row, and the client WAS or WAS NOT
   * told. A screen that implied the second from the first would leave a coach
   * believing they had sent a reminder that never reached anybody, and they
   * would stop asking. `remindInvoice` carries the second as a three-state
   * answer for exactly this.
   */
  const onChase = async (inv: CoachInvoice) => {
    const blocked = chaseBlocker(inv);
    if (blocked) { Alert.alert('Nothing to chase', blocked); return; }
    setBusy(true);
    const res = await remindInvoice(inv.id);
    setBusy(false);
    if (!res.ok) { Alert.alert('That reminder was not recorded', res.error || 'Nothing changed.'); return; }
    await load();
    const told = res.notified === true
      ? 'They have a notification about it. It names the number so they can match it to the document you already sent, and it is not a second invoice.'
      : res.notified === false
        ? 'They could not be notified, so nothing reached them. The chase is recorded on your side only — send it to them the way you sent it the first time.'
        : 'This one is not tied to an account, so nobody was notified.';
    Alert.alert(`Chased invoice ${invoiceNumber(inv.seq)}`, told);
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const G = layout.gutter;

  /**
   * One row on an ageing list: the number, who it is for, the amount, how late
   * it is, and the one action that does anything about it.
   *
   * The amount goes through `money()`, which returns null rather than a bare
   * figure when the currency is missing — a number with no currency beside it
   * is not an amount of money, and this is a list a coach chases from.
   */
  const agedRow = (inv: CoachInvoice, ageLine: string) => {
    const amount = money(inv);
    const chased = chaseHistoryLine(inv);
    const blocked = chaseBlocker(inv);
    return (
      <View key={inv.id} style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
          <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: t.ink }}>{invoiceNumber(inv.seq)}</Text>
          <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{inv.billTo}</Text>
          <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{amount ?? DASH}</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{ageLine}</Text>
        {chased ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{chased}</Text> : null}
        {/* The reason, never a dead control. A coach who taps nothing and is
            told nothing concludes the button is broken; a coach who is told
            "this one is not tied to an account" knows to send it by hand. */}
        {blocked ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{blocked}</Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
            <Pressable onPress={() => { void onChase(inv); }} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={`Chase invoice ${invoiceNumber(inv.seq)}`} disabled={busy}
              style={{ paddingVertical: sp.xs }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.brand }}>Chase it</Text>
            </Pressable>
            <Pressable onPress={() => { void send(inv); }} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={`Send invoice ${invoiceNumber(inv.seq)} again`} style={{ paddingVertical: sp.xs }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Send again</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  // The gate. Said as a sentence a coach can act on, naming who sets it —
  // never as a silent fallback to a currency nobody chose.
  //
  // Four causes, not two. This branched on 'error' and then let EVERYTHING else
  // with no code fall through to "no currency has been set for you" — so
  // 'partial', which `fetchInvoiceCurrency` returns when one of its two reads
  // failed and the other had nothing to say, was reported as a settled fact
  // about the coach's own gym, as was 'loading' for the length of the read. A
  // coach sent to their gym owner over a query that failed is told the currency
  // is already set, and neither of them learns anything. The amounts were
  // always correctly withheld; only this sentence was wrong.
  // src/lib/currencyGap.ts holds the four and their wording.
  const curGap = currencyGapOfStatus({ currency: ccy.currency, status: ccy.status });
  const currencyBlocker = curGap
    ? curGap === 'unset'
      ? 'No currency has been set for you. Repple is white-labelled, so there is no default that would be right for every gym — and an invoice with the wrong currency on it is worse than no invoice. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.'
      : currencyGapLine(curGap, 'nothing can be issued')
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your own paperwork</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Invoices</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Notice
            kicker="What this is"
            title="A record of a charge you made"
            note="Numbered in your own sequence inside this app. It states no tax and it is not a payment receipt — both are printed on the document itself, so nobody has to take your word for what it is."
          />
        </View>

        {status === 'error' ? (
          <Notice tone={t.crit} kicker="Not read" title="Your invoices could not be read"
            note="This list is empty because the read failed, not because you have issued none. Nothing below is a statement about your records." />
        ) : null}
        {status === 'partial' ? (
          <PartialRead what="invoices" shown={rows.length} />
        ) : null}

        {currencyBlocker ? (
          <Notice tone={t.crit} kicker="Nothing can be issued yet" title="No currency" note={currencyBlocker} />
        ) : null}

        <Rule />

        <Section>
          <SectionHead
            title="What you have issued"
            note={ccy.currency ? `Priced in ${ccy.currency}${ccy.source === 'packages' ? ', from your own packages' : ccy.source === 'gym' ? ', from your gym’s setting' : ''}` : undefined}
          />
          {book.totals ? (
            book.totals.pots.length ? (
              <View style={{ marginTop: sp.sm }}>
                {book.totals.pots.map((p) => (
                  <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ ...ty.label, color: t.ink2 }}>{p.count} invoice{p.count === 1 ? '' : 's'} in {p.currency}</Text>
                    <Text style={{ ...ty.label, ...numeric, color: t.ink }}>{minorMoney(p.minorUnits, p.currency) ?? DASH}</Text>
                  </View>
                ))}
                {/* Currencies are never added together. Said, because a coach
                    looking at two rows might otherwise add them themselves. */}
                {book.totals.pots.length > 1 ? (
                  <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                    These are separate amounts of money and are deliberately not added together.
                  </Flag>
                ) : null}
                {book.totals.unlabelled > 0 ? (
                  <Flag style={{ marginTop: sp.sm }}>
                    {book.totals.unlabelled} invoice{book.totals.unlabelled === 1 ? ' has' : 's have'} an amount with no currency on it, so {book.totals.unlabelled === 1 ? 'it is' : 'they are'} not in any figure above.
                  </Flag>
                ) : null}
                {book.voided > 0 ? (
                  <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                    {book.voided} voided invoice{book.voided === 1 ? ' is' : 's are'} left out of these figures. {book.voided === 1 ? 'It is' : 'They are'} still listed below.
                  </Flag>
                ) : null}
              </View>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                You have not issued any invoices yet. The first one you issue is number 0001.
              </Text>
            )
          ) : (
            <Flag style={{ marginTop: sp.sm }}>{book.reason}</Flag>
          )}
        </Section>

        <Rule />

        {/* ── WHO OWES YOU ────────────────────────────────────────────────
            "Who owes me money" was the most common unanswered question in this
            app, and every part of the answer here is something the coach
            themselves recorded: a kind they chose, a due date they typed, a
            void they performed. Nothing is inferred from a payment processor,
            because nothing about a payment processor reaches this table — which
            is also why an invoice stays on this list until the coach says
            otherwise rather than until somebody pays. */}
        <Section>
          <SectionHead title="Owed to You" note="Invoices you are still asking for" />
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{AGEING_IS_YOUR_OWN_RECORD}</Text>

          {ageing.withheld ? (
            <Flag>{ageing.withheld}</Flag>
          ) : ageing.outstanding && ageing.outstanding.pots.length ? (
            <View>
              {ageing.outstanding.pots.map((p) => (
                <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>
                    {p.count} outstanding in {p.currency}
                  </Text>
                  <Text style={{ ...ty.body, fontWeight: '700', ...numeric, color: t.ink }}>
                    {minorMoney(p.minorUnits, p.currency) ?? DASH}
                  </Text>
                </View>
              ))}
              {/* Currencies never merge. Said, because two rows of figures is
                  exactly the shape somebody adds up in their head. */}
              {ageing.outstanding.pots.length > 1 ? (
                <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                  These are separate amounts of money and are deliberately not added together.
                </Flag>
              ) : null}
              {ageing.outstanding.unlabelled > 0 ? (
                <Flag style={{ marginTop: sp.sm }}>
                  {ageing.outstanding.unlabelled} outstanding invoice{ageing.outstanding.unlabelled === 1 ? ' has' : 's have'} an amount with no currency on it, so {ageing.outstanding.unlabelled === 1 ? 'it is' : 'they are'} in no figure above.
                </Flag>
              ) : null}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing you have issued is still being asked for. Every read came back in full, so this is your record rather than a failure.
            </Text>
          )}

          {/* The invoices with no due date, said out loud and kept out of every
              figure above. This is the bucket every invoice issued before the
              due-date column existed lands in, and calling it "not due" would
              put a coach's whole back catalogue into the reassuring pile. */}
          {ageing.undatedNote ? <Flag style={{ marginTop: sp.sm }}>{ageing.undatedNote}</Flag> : null}
        </Section>

        {/* One group per band, longest overdue first. Grouped rather than
            listed flat because chasing is done in bands: a coach clears the
            two-month column before they look at last week's. */}
        {(['61+', '31-60', '8-30', '1-7'] as AgeBucket[]).map((b) => {
          const inBand = ageing.overdue.filter((a) => a.age.bucket === b);
          if (!inBand.length) return null;
          return (
            <Section key={b}>
              <SectionHead title={BUCKET_TITLE[b]} />
              {inBand.map(({ invoice, age }) => agedRow(invoice, age.line))}
            </Section>
          );
        })}

        {ageing.upcoming.length ? (
          <Section>
            <SectionHead title="Not Yet Due" />
            {ageing.upcoming.map(({ invoice, age }) => agedRow(invoice, age.line))}
          </Section>
        ) : null}

        <Rule />

        <Section>
          {/* A count, and "nothing", are both claims about the coach's own
              sequence — so neither may be made from a list that is not the
              whole list. `fetchMyInvoices` returns `{rows: [], status:
              'error'}`, which read as "Nothing issued yet" to a coach who has
              issued thirty-one, and a capped read would have headed a page of
              1,000 rows "1000 issued" when there were more. Nothing is wrong
              server-side — the sequence is allocated under an advisory lock —
              so the only thing at fault was this heading. */}
          <SectionHead title={isWhole(status) ? (rows.length ? `${rows.length} issued` : 'Nothing issued yet') : 'What is on record'} />
          {status === 'error' ? (
            <Flag style={{ marginTop: sp.sm }}>
              Your invoices could not be read just now, so this is not a list of none. Nothing has
              happened to them — the numbers you have issued are still on record.
            </Flag>
          ) : status === 'partial' ? (
            <PartialRead what="your invoices" onPress={() => { void load(); }} />
          ) : null}
          {rows.map((inv) => {
            const amount = money(inv);
            return (
              <View key={inv.id} style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
                  <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: inv.voidedAt ? t.ink3 : t.ink }}>
                    {invoiceNumber(inv.seq)}
                  </Text>
                  <Text style={{ ...ty.body, color: inv.voidedAt ? t.ink3 : t.ink, flex: 1 }} numberOfLines={1}>
                    {inv.billTo}
                  </Text>
                  <Text style={{ ...ty.body, ...numeric, color: inv.voidedAt ? t.ink3 : t.ink }}>{amount ?? DASH}</Text>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }} numberOfLines={2}>
                  {invoiceDayLabel(inv.issuedOn)} · {kindLabel(inv.kind)} · {inv.description}
                </Text>
                {/* Where it stands, on every row rather than only on the ageing
                    lists above. A coach scrolling their whole book should not
                    have to scroll back up to find out whether 0031 is late. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{invoiceAge(inv, today).line}</Text>
                {inv.voidedAt ? (
                  <Flag style={{ marginTop: sp.sm }}>
                    Voided{inv.voidReason ? ` — ${inv.voidReason}` : ''}. Its number is not reused.
                  </Flag>
                ) : null}
                {!amount ? (
                  <Flag style={{ marginTop: sp.sm }}>
                    This one has no currency on it, so no amount can be printed on the document either.
                  </Flag>
                ) : null}
                <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                  <Pressable onPress={() => { void send(inv); }} hitSlop={8} accessibilityRole="button"
                    accessibilityLabel={`Send invoice ${invoiceNumber(inv.seq)}`} style={{ paddingVertical: sp.xs }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Send</Text>
                  </Pressable>
                  {!inv.voidedAt ? (
                    <Pressable onPress={() => { setVoidTarget(inv); setVoidReason(''); }} hitSlop={8} accessibilityRole="button"
                      accessibilityLabel={`Void invoice ${invoiceNumber(inv.seq)}`} style={{ paddingVertical: sp.xs }}>
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Void</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {!rows.length && status === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Nothing here yet. An invoice you issue stays in this list for good — it can be voided, never edited and never deleted, because the copy your client is holding does not change.
            </Text>
          ) : null}
        </Section>

        <View style={{ marginTop: layout.section }}>
          <Cta label="Issue an Invoice" wide disabled={!!currencyBlocker} onPress={() => setOpen(true)} />
          {currencyBlocker ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{currencyBlocker}</Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, maxHeight: '90%' }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={{ ...ty.title, color: t.ink }}>New invoice</Text>
              {/* The predicted number comes from `rows[0].seq`, and the rows
                  are ordered `seq` descending — so it is right under 'ready'
                  and right under 'partial' too, where the first page still
                  holds the highest number. Under 'error' and while loading
                  `rows` is empty, and `?? 0` turned that into "It will be
                  number 0001" in front of a coach on their thirty-second
                  invoice. The number itself was never at risk: it is allocated
                  server-side under an advisory lock when the invoice is issued.
                  Only the sentence was wrong, and it is the sentence a coach
                  would have quoted to a client. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                {nextSeq != null
                  ? `It will be number ${invoiceNumber(nextSeq)} in your own sequence, dated ${invoiceDayLabel(today)}${ccy.currency ? `, in ${ccy.currency}` : ''}.`
                  : `Your sequence could not be read, so we cannot say which number this will be. It is allocated when you issue, dated ${invoiceDayLabel(today)}${ccy.currency ? `, in ${ccy.currency}` : ''}, and it never repeats one you have used.`}
              </Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>Who it is for</Text>
              <TextInput value={billTo} onChangeText={(v) => { setBillTo(v); setClientId(null); }}
                placeholder="Their name, as it should appear" placeholderTextColor={t.ink3}
                accessibilityLabel="Who the invoice is for" style={inp} />
              {/* The roster is a shortcut, not the only way in: a coach bills
                  people who have never installed this app, and typing a name is
                  a first-class path rather than a fallback. */}
              {roster.roster.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.sm }}>
                  <View style={{ flexDirection: 'row', gap: sp.sm }}>
                    {roster.roster.slice(0, 20).map((c) => (
                      <Pressable key={c.id} onPress={() => { setBillTo(c.name); setClientId(isQueryableId(c.id) ? c.id : null); }}
                        accessibilityRole="button" accessibilityLabel={`Bill ${c.name}`}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: billTo === c.name ? t.brand : t.surface2 }}>
                        <Text style={{ ...ty.caption, color: billTo === c.name ? '#fff' : t.ink2 }}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>What it is for</Text>
              <TextInput value={description} onChangeText={setDescription}
                placeholder="8 personal training sessions" placeholderTextColor={t.ink3}
                accessibilityLabel="What the invoice is for" style={inp} />

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>
                Amount{ccy.currency ? ` in ${ccy.currency}` : ''}
              </Text>
              <TextInput value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad"
                placeholder="480" placeholderTextColor={t.ink3}
                accessibilityLabel="Amount" style={inp} />

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>Your own statement about the money</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                {(['requested', 'received'] as InvoiceKind[]).map((k) => (
                  <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="button"
                    accessibilityLabel={kindLabel(k)} accessibilityState={{ selected: kind === k }}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', backgroundColor: kind === k ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, color: kind === k ? '#fff' : t.ink2 }}>
                      {k === 'requested' ? 'Asking for it' : 'Already paid'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                Whichever you choose is printed as your own statement. Repple does not check it against a bank or a card processor, and the document says so.
              </Text>

              {/* Optional, and empty by default, and there is no suggested
                  term. Thirty days is a convention in one trade in one country;
                  a coach settling weekly in cash has never agreed to it. A
                  default here would be a deadline printed on a document under
                  the coach's name that they did not choose — so the shortcuts
                  below preselect nothing and the field stays empty until one is
                  tapped or a date is typed. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>When you expect to be paid (optional)</Text>
              <TextInput value={dueText} onChangeText={setDueText} autoCapitalize="none" autoCorrect={false}
                placeholder="YYYY-MM-DD, or leave it empty" placeholderTextColor={t.ink3}
                accessibilityLabel="Due date" style={inp} />
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                {([['On the day', 0], ['In a week', 7], ['In two weeks', 14], ['In a month', 30]] as [string, number][]).map(([label, n]) => {
                  const when = plusDays(today, n);
                  return (
                    <Pressable key={label} onPress={() => setDueText(dueText === when ? '' : when)}
                      accessibilityRole="button" accessibilityLabel={label}
                      accessibilityState={{ selected: dueText === when }}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center', backgroundColor: dueText === when ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.micro, color: dueText === when ? '#fff' : t.ink2 }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{INVOICE_DUE_NOT_A_TERM}</Text>

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>A note, if you want one (optional)</Text>
              <TextInput value={note} onChangeText={setNote} multiline
                placeholder="Block booked, to be used within 12 weeks." placeholderTextColor={t.ink3}
                accessibilityLabel="Note" style={[inp, { minHeight: 70, textAlignVertical: 'top' }]} />

              <View style={{ marginTop: sp.lg }}>
                <Flag tone={t.ink3}>
                  No tax is calculated or added, and the document says so on its face. If you are registered for tax, check with your accountant what your invoices need to carry.
                </Flag>
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
                  <Cta label={busy ? 'Issuing…' : 'Issue it'} wide disabled={!canIssue} onPress={() => { void onIssue(); }} />
                </View>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Once issued it cannot be edited. You can void it, and the number stays spent.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!voidTarget} animationType="slide" transparent onRequestClose={() => setVoidTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
            <Text style={{ ...ty.title, color: t.ink }}>
              Void invoice {voidTarget ? invoiceNumber(voidTarget.seq) : ''}?
            </Text>
            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
              It stays in your list, marked voided, and its number is never reused — a missing number in a sequence is a question you would have to answer later, and a reused one is worse. It cannot be un-voided.
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>Why (required)</Text>
            <TextInput value={voidReason} onChangeText={setVoidReason}
              placeholder="Issued twice by mistake" placeholderTextColor={t.ink3}
              accessibilityLabel="Reason for voiding" style={inp} />
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
              <View style={{ flex: 1 }}>
                <Cta label="Keep It" tone={t.surface2} wide onPress={() => { setVoidTarget(null); setVoidReason(''); }} />
              </View>
              <View style={{ flex: 1 }}>
                <Cta label={busy ? 'Voiding…' : 'Void it'} tone={t.crit} wide
                  disabled={!voidReason.trim() || busy} onPress={() => { void doVoid(); }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
