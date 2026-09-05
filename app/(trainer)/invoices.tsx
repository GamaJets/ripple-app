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
import { useToday } from '../../src/ui/today';
import { isQueryableId } from '../../src/lib/clientDrift';
import { shareDoc, shareText, pdfExportAvailable } from '../../src/lib/exportShare';
import { chaseGroups, chaseMessage, chaseMessageCaveat, type ChaseGroup } from '../../src/lib/chaseList';
import {
  coachInvoiceDoc, invoiceShareBlurb, invoiceBlockers, invoiceNumber, invoiceDayLabel,
  invoiceBook, money, kindLabel, ageingBook, invoiceAge, chaseBlocker, chaseHistoryLine,
  settleBlocker, settleDayBlocker, voidBlocker, chaseFromBlocker, chaseFromDayBlocker,
  BUCKET_TITLE, AGEING_IS_YOUR_OWN_RECORD, INVOICE_DUE_NOT_A_TERM, CHASE_FROM_IS_NOT_A_DUE_DATE, plusDays,
  type AgeBucket,
  type CoachInvoice, type InvoiceDraft, type InvoiceKind,
} from '../../src/lib/coachInvoice';
import { minorMoney } from '../../src/lib/coachMoney';
import {
  fetchMyInvoices, fetchInvoiceIssuer, fetchInvoiceCurrency, issueInvoice, voidInvoice, remindInvoice,
  settleInvoice, setInvoiceChaseFrom,
  type InvoiceCurrency,
} from '../../src/ui/coachInvoices';
import { useMyCoachLogo } from '../../src/ui/coachLogo';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { currencyGapLine, currencyGapOfStatus } from '../../src/lib/currencyGap';
import { myCurrencyLine } from '../../src/lib/currencySource';
import { DateSheet } from '../../src/ui/DateSheet';
import { Icon } from '../../src/ui/Icon';
import { MIN_TARGET } from '../../src/lib/a11y';

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
  const [ccy, setCcy] = useState<InvoiceCurrency>({ currency: null, source: null, status: 'loading', gap: null });

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
  // What the coach states about tax, if anything (part 451). Both empty by
  // default and both stay empty unless the coach types: a rate this app filled
  // in would be a statement about their tax affairs printed under their name,
  // and an empty rate box is a DIFFERENT document from one stating zero.
  //
  // Nothing here is calculated from either. There is no tax amount on the
  // document, no net figure and no subtotal, and `INVOICE_TAX_STATED` says so
  // on the page of any document that carries them.
  const [taxRateText, setTaxRateText] = useState('');
  const [taxRegistration, setTaxRegistration] = useState('');
  const [busy, setBusy] = useState(false);
  // The invoice being voided, and the reason typed for it. Its own flag rather
  // than a shared one: check-runtime-traps flags sibling modals whose `visible`
  // expressions share an identifier, and it flags them because iOS will not
  // present two at once from the same parent.
  const [voidTarget, setVoidTarget] = useState<CoachInvoice | null>(null);
  const [voidReason, setVoidReason] = useState('');
  // The invoice being recorded as settled, the day the coach says the money
  // arrived, and how it arrived. Its own three pieces of state and its own
  // modal for the reason `voidTarget` has one — check-runtime-traps flags
  // sibling modals whose `visible` expressions share an identifier, because iOS
  // will not present two at once from the same parent.
  //
  // The day defaults to TODAY and not to the due date. A default of the due
  // date would be this app deciding when somebody's money arrived, which is the
  // one fact on this sheet that only the coach knows; today is the day they are
  // standing in and is what they will most often mean, and it is a starting
  // value in an editable box rather than a claim.
  const [settleTarget, setSettleTarget] = useState<CoachInvoice | null>(null);
  const [settleDay, setSettleDay] = useState('');
  const [settleNote, setSettleNote] = useState('');
  // The invoice getting a chase date, and the day typed for it. Empty clears
  // it, which puts the invoice back on the undated list.
  const [chaseTarget, setChaseTarget] = useState<CoachInvoice | null>(null);
  const [chaseDay, setChaseDay] = useState('');
  /**
   * Which of this screen's three dates has the month sheet open, if any.
   *
   * One value for all three rather than three booleans, and the type is what
   * enforces it: three booleans can all be true at once, and three modals
   * presented from the same parent is the defect
   * scripts/check-runtime-traps.mjs was written for — iOS presents one and
   * silently drops the others. Each sheet is also a sibling of the sheet its
   * field lives in, never a child of it, which is the pattern
   * app/(trainer)/templates.tsx settled: a modal nested inside a modal's own
   * subtree is the arrangement that does not present at all.
   */
  const [pick, setPick] = useState<null | 'due' | 'settle' | 'chase'>(null);

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
  // Four reads: the invoices, the issuer name and the currency `load` fetches
  // alongside them, the roster the client names come from, and the logo on
  // the letterhead. An invoice is a document handed to somebody, so the parts
  // of it are refreshed together or not at all — an amount from one read
  // under a currency from another is a figure a coach would be held to.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([load(), roster.refresh(), Promise.resolve(logo.reload())]),
    [load, roster, logo],
  ));

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
  //
  // And kept CURRENT, which `isoToday(new Date())` in the render body was not.
  // A bare call is right at the instant something else redraws, and this screen
  // is registered `href: null` in app/(trainer)/_layout.tsx — mounted once and
  // never torn down. Left open across local midnight it kept yesterday's day
  // feeding `ageingBook`, `invoiceAge`, `settleDayBlocker` and the chase-from
  // default: every invoice one day less late than it is, which is the wrong
  // side of a chasing decision, and a settle dated to yesterday. `useToday`
  // returns the same local `YYYY-MM-DD` and settles it on midnight, on
  // foreground and on focus. See src/ui/today.ts.
  const today = useToday();

  // Aged against THE SAME `today`, which is the device's day and not the
  // server's UTC one. A coach in Auckland reading this at 10am would otherwise
  // have yesterday's arithmetic applied to their own book — every invoice a day
  // less late than it is, which is the wrong side of a chasing decision.
  const ageing = useMemo(() => ageingBook(rows, status, today), [rows, status, today]);

  /**
   * The same outstanding book, grouped by WHO OWES IT.
   *
   * The lists below are documents banded by lateness, which is the right answer
   * to "what is late" and the wrong shape for the act: nobody sends four
   * messages to one client about four invoices. Off the banded lists a coach
   * did that grouping in their head — the bands interleave people — and then
   * typed the note by hand, number by number, scrolling back for each one.
   *
   * Derived from `ageing`, so there is one reading of what is outstanding on
   * this screen rather than two that can disagree. See src/lib/chaseList.ts.
   */
  const chase = useMemo(() => chaseGroups(ageing, status), [ageing, status]);

  /**
   * What this coach last stated about tax, from their own book.
   *
   * Not stored on the trainer and not a setting. It is read back off the most
   * recent invoice that carried either field, so a registered coach types their
   * registration number once rather than every time — and what is SAVED is
   * still what was on that document, snapshotted, because a coach who
   * deregisters next year has not changed what they issued this year.
   *
   * Only under a read that came back. Under 'error' `rows` is empty for a
   * reason that has nothing to do with what the coach has stated before, and
   * pre-filling from it would be inventing a blank.
   */
  const lastTax = useMemo(() => {
    if (status !== 'ready' && status !== 'partial') return null;
    return rows.find((i) => i.taxRatePct != null || !!String(i.taxRegistration ?? '').trim()) ?? null;
  }, [rows, status]);

  const draft = (): InvoiceDraft => ({
    billTo, description, amountText, currency: ccy.currency, kind, issuedOn: today,
    dueOn: dueText.trim() || null, note: note.trim() || null,
    taxRateText: taxRateText.trim() || null,
    taxRegistration: taxRegistration.trim() || null,
  });
  const blockers = invoiceBlockers(draft());
  const canIssue = blockers.length === 0 && !busy;

  // The tax fields are cleared too, and are re-offered from `lastTax` by the
  // "Use What I Stated Last Time" control rather than being silently carried
  // over. A rate that reappeared on its own would be a statement the coach did
  // not make on THIS document.
  const reset = () => { setBillTo(''); setClientId(null); setDescription(''); setAmountText(''); setDueText(''); setKind('requested'); setNote(''); setTaxRateText(''); setTaxRegistration(''); };

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

  /**
   * The note that chases one person for everything they owe.
   *
   * ── Why this is a share and not a send ────────────────────────────────
   *
   * Repple does not have a channel to most of these people. `chaseBlocker`
   * refuses an invoice with no `clientId` — "send it to them the way you sent
   * it the first time" — and those are exactly the clients this screen's own
   * header exists for: the half of a working book that pays in cash, by
   * transfer, or through a gym. The share sheet is the channel the coach
   * already uses, and it is the same route the invoice itself goes out on.
   *
   * ── What it does NOT do, said out loud ────────────────────────────────
   *
   * It records nothing. `remindInvoice` is what writes a chase against an
   * invoice and notifies an account holder, and that is still the per-invoice
   * "Chase it" below. A coach who assumed this had recorded four chases would
   * stop being able to tell who they had already asked, so the confirmation
   * says which of the two they are doing before anything leaves the phone.
   */
  const sendChase = (g: ChaseGroup) => {
    // The coach's own name, and only from a read that came back. A note signed
    // by the platform instead of by the person asking for the money is the
    // fault src/lib/coachInvoice.ts refuses on the document itself, and a note
    // is a smaller version of the same artefact.
    const note = chaseMessage(g, isWhole(issuer.status) ? issuer.name : null);
    if (!note) return;
    const caveat = chaseMessageCaveat(g);
    Alert.alert(
      `Note for ${g.billTo}`,
      note
      + '\n\n'
      + (caveat ? caveat + '\n\n' : '')
      + 'It goes through your phone’s share sheet, so it reaches them however you already talk to them. Nothing is sent from this app and nothing is recorded against these invoices — “Chase it” on an invoice is what records one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send it', onPress: () => { void shareText(note, `Outstanding invoices for ${g.billTo}`); } },
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
    // Checked here as well as on the control, for `settleBlocker`'s reason: the
    // sheet can be open when the state underneath it changes, and the
    // alternative to this line is a raw CHECK-constraint message from Postgres
    // reaching a coach. See `voidBlocker`.
    const blocked = voidBlocker(voidTarget);
    if (blocked) { Alert.alert('Not voided', blocked); return; }
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

  /**
   * Record that one was paid.
   *
   * ── The only door out that does not deface a paid document ──────────────
   *
   * Before part 660 a coach whose client actually paid a 'requested' invoice
   * had two options and both were wrong. Leave it: it stays on every chase
   * list, in the outstanding figure, and part 613's nightly pass tells them
   * four times over two months to chase money they already have. Or void it,
   * which prints THIS INVOICE HAS BEEN VOIDED across a document that was paid
   * in full — and `INVOICE_VOID_NOTICE` says a voided invoice "is not a record
   * of a charge that stands", which is a lie about a charge that stood and was
   * settled.
   *
   * Nothing here edits the document. `kind` still says what it said; the
   * settlement is a new fact recorded beside it and printed as the issuer's own
   * word, exactly as `kind` is.
   */
  const openSettle = (inv: CoachInvoice) => {
    const blocked = settleBlocker(inv);
    if (blocked) { Alert.alert('Nothing to settle', blocked); return; }
    setSettleTarget(inv);
    setSettleDay(today);
    setSettleNote('');
  };

  const doSettle = async () => {
    if (!settleTarget || busy) return;
    const bad = settleDayBlocker(settleTarget, settleDay.trim(), today);
    if (bad) { Alert.alert('Not that day', bad); return; }
    setBusy(true);
    const res = await settleInvoice(settleTarget.id, settleDay.trim(), settleNote.trim() || null);
    setBusy(false);
    if (!res.ok) { Alert.alert('Not recorded', res.error || 'Nothing changed.'); return; }
    const no = invoiceNumber(settleTarget.seq);
    setSettleTarget(null);
    setSettleDay('');
    setSettleNote('');
    await load();
    // The client is deliberately not told, and it is said out loud rather than
    // left to be discovered — a coach who assumes a receipt went out will not
    // send one. See `settleInvoice` for why: a settlement is the coach agreeing
    // with something the client already knows they did.
    Alert.alert(
      `Invoice ${no} recorded as settled`,
      'It is off your chase lists and out of the outstanding figure. Nobody has been told — send them the document again if you want them to have a copy that says it was paid.',
    );
  };

  /**
   * Set or clear the day the coach means to start chasing one that carries no
   * due date.
   *
   * NOT adding a due date, and the sheet says so in the coach's own words
   * before they type anything. `due_on` is on the document, is immutable, and
   * stays that way; this is a note about the coach's own list that appears on
   * no artefact anybody else ever sees.
   */
  const openChaseFrom = (inv: CoachInvoice) => {
    const blocked = chaseFromBlocker(inv);
    if (blocked) { Alert.alert('Nothing to set', blocked); return; }
    setChaseTarget(inv);
    setChaseDay(inv.chaseFrom ?? today);
  };

  const doChaseFrom = async (clear: boolean) => {
    if (!chaseTarget || busy) return;
    const day = clear ? '' : chaseDay.trim();
    if (!clear) {
      const bad = chaseFromDayBlocker(chaseTarget, day);
      if (bad) { Alert.alert('Not that day', bad); return; }
    }
    setBusy(true);
    const res = await setInvoiceChaseFrom(chaseTarget.id, day || null);
    setBusy(false);
    if (!res.ok) { Alert.alert('Not changed', res.error || 'Nothing changed.'); return; }
    setChaseTarget(null);
    setChaseDay('');
    await load();
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  /** A date, drawn as `inp` is but reachable as a button: `MIN_TARGET` tall
   *  rather than padded to roughly that, because the number is the floor and
   *  this screen is used one-handed. Shared by all three dates here so they
   *  cannot drift apart. */
  const dayBox = {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: sp.sm,
    minHeight: MIN_TARGET, paddingHorizontal: 12,
    backgroundColor: t.surface2, borderRadius: radius.sm,
  };
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
            "this one is not tied to an account" knows to send it by hand.

            ── and why it no longer takes the other two acts with it ──
            This sentence used to REPLACE the whole action row, so an invoice
            `chaseBlocker` refused had no controls at all. Two of the three have
            nothing to do with chasing: Send Again is a share sheet and needs no
            account, and They Paid It is the only door out of this list that
            does not stamp VOIDED across a document that was paid in full.
            The invoice it hid them from is the one with no `clientId` — which
            is exactly the client who pays in cash, by transfer or through a
            gym's front desk, the half of a working book this screen's own
            header exists for. That coach could never mark those settled from
            here: they stayed overdue for ever, in the outstanding figure, on
            every chase list, with the nightly pass telling them four times over
            two months to chase money they already had. The undated list below
            has always drawn all three, so the same invoice offered them or not
            depending on which list it happened to be on.
            Only Chase It is gated now, because only Chase It needs an account
            to notify. */}
        <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm, flexWrap: 'wrap' }}>
          {!blocked ? (
            <Pressable onPress={() => { void onChase(inv); }} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={`Chase invoice ${invoiceNumber(inv.seq)}`} disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={{ paddingVertical: sp.xs }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.brand }}>Chase it</Text>
            </Pressable>
          ) : null}
          {/* The action this list existed without. Everything on it is
              something the coach is asking for, and until part 660 there was
              no way to say it had arrived — so a paid invoice stayed here for
              ever, or was voided, which stamps THIS INVOICE HAS BEEN VOIDED
              across a document that was paid in full.
              `settleBlocker` is the same reader the sheet and the server use,
              so the control is absent exactly where the act would be refused —
              and it is a different question from whether there is an account to
              notify, which is what used to decide it. */}
          {!settleBlocker(inv) ? (
            <Pressable onPress={() => openSettle(inv)} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={`Record invoice ${invoiceNumber(inv.seq)} as paid`} disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={{ paddingVertical: sp.xs }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.brand }}>They paid it</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => { void send(inv); }} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={`Send invoice ${invoiceNumber(inv.seq)} again`} style={{ paddingVertical: sp.xs }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Send again</Text>
          </Pressable>
        </View>
        {blocked ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{blocked}</Text>
        ) : null}
      </View>
    );
  };

  /**
   * One invoice on the undated list: the ones carrying no due date at all.
   *
   * Its own row rather than `agedRow`, because the one thing to do about these
   * is not the one thing to do about a late invoice. They are in no figure and
   * on no chase list, and until part 660 that was permanent — the screen said
   * so and offered nothing. What it offers now is the coach's own note of when
   * to start chasing, which is not a due date and says so.
   */
  const undatedRow = (inv: CoachInvoice, ageLine: string) => {
    const amount = money(inv);
    return (
      <View key={inv.id} style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
          <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: t.ink }}>{invoiceNumber(inv.seq)}</Text>
          <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{inv.billTo}</Text>
          <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{amount ?? DASH}</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{ageLine}</Text>
        <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm, flexWrap: 'wrap' }}>
          <Pressable onPress={() => openChaseFrom(inv)} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={`Set a day to chase invoice ${invoiceNumber(inv.seq)} from`} disabled={busy}
            accessibilityState={{ disabled: busy, busy }}
            style={{ paddingVertical: sp.xs }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.brand }}>Chase it from…</Text>
          </Pressable>
          <Pressable onPress={() => openSettle(inv)} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={`Record invoice ${invoiceNumber(inv.seq)} as paid`} disabled={busy}
            accessibilityState={{ disabled: busy, busy }}
            style={{ paddingVertical: sp.xs }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.brand }}>They paid it</Text>
          </Pressable>
          <Pressable onPress={() => { void send(inv); }} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={`Send invoice ${invoiceNumber(inv.seq)} again`} style={{ paddingVertical: sp.xs }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Send again</Text>
          </Pressable>
        </View>
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
  //
  // And 'unset' is itself two facts since part 940. It used to be one, because
  // a gym was the only place a currency could live, so "no currency has been
  // set for you" could safely end by naming a gym owner. A coach with no gym
  // has no owner to name, and that sentence sent them to look for a person who
  // does not exist. `ccy.gap` carries which of the four it is — the gym has
  // set none, they have chosen none, there is no coach record, or part 940 is
  // not applied — and only the first names an owner.
  const curGap = currencyGapOfStatus({ currency: ccy.currency, status: ccy.status });
  const currencyBlocker = curGap
    ? curGap === 'unset'
      ? ccy.gap && ccy.gap !== 'gym-unset'
        ? myCurrencyLine(ccy.gap, 'nothing can be issued')
        : 'No currency has been set for you. Repple is white-labelled, so there is no default that would be right for every gym — and an invoice with the wrong currency on it is worse than no invoice. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.'
      : currencyGapLine(curGap, 'nothing can be issued')
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
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

        {/* ── one empty state, not two ────────────────────────────────────
            Seen on an iPhone: "WHAT YOU HAVE ISSUED — You have not issued any
            invoices yet. The first one you issue is number 0001.", then "OWED
            TO YOU", then "NOTHING ISSUED YET — Nothing here yet…". Two
            headings and two sentences, one section apart, both saying the
            coach has issued nothing.

            This one goes. A totals block over nothing has nothing to total,
            and the sentence it was carrying — the first number in the sequence
            — has moved down to the list's own empty state, which is the one
            place a coach looks to find out what they have. The section is
            still drawn whenever the read FAILED, because `book.reason` is the
            only thing on this screen that says why. */}
        {book.totals && !book.totals.pots.length ? null : (
        <>
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
            ) : null
          ) : (
            <Flag style={{ marginTop: sp.sm }}>{book.reason}</Flag>
          )}
        </Section>
        </>
        )}

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
          ) : ageing.overdue.length || ageing.upcoming.length ? (
            /* Outstanding invoices exist and NOT ONE of them could be
               denominated.

               The branch below used to be the only alternative to a pot, so a
               coach whose outstanding invoices all carry no currency was told
               "nothing you have issued is still being asked for" directly above
               the list of them, banded by how late each one is. `sumTaken`
               builds a pot per currency and an invoice with none goes to
               `unlabelled` instead — which is a real state, because part 138's
               currency column is NOT NULL but `toInvoice` reads a blank one as
               null, and a coach with a single unlabelled invoice has an empty
               `pots` array and something very much outstanding.

               A count of the invoices, and no figure, because there is no
               figure: an amount with no currency beside it is not an amount of
               money. The two lists below say which ones they are. */
            <View>
              <Text style={{ ...ty.label, color: t.ink }}>
                {ageing.overdue.length + ageing.upcoming.length} invoice{ageing.overdue.length + ageing.upcoming.length === 1 ? ' is' : 's are'} still being asked for, and no total can be stated for {ageing.overdue.length + ageing.upcoming.length === 1 ? 'it' : 'them'}.
              </Text>
              <Flag style={{ marginTop: sp.sm }}>
                {ageing.overdue.length + ageing.upcoming.length === 1 ? 'It has' : 'They have'} no currency recorded, so {ageing.overdue.length + ageing.upcoming.length === 1 ? 'the amount on it is' : 'the amounts on them are'} not an amount of any money and nothing here adds up. {ageing.overdue.length + ageing.upcoming.length === 1 ? 'It is' : 'They are'} listed below, and the document {ageing.overdue.length + ageing.upcoming.length === 1 ? 'itself carries' : 'themselves carry'} no figure either.
              </Flag>
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

        {/* ── THE SAME MONEY, BY WHO OWES IT ──────────────────────────────
            Above this line the answer is a list of documents banded by
            lateness. That is the right answer to "what is late" and it is the
            wrong shape for the act a coach performs, which is sending ONE
            message to ONE person about everything they owe. The bands
            interleave people, so a coach did that grouping in their head and
            then typed the note out by hand — the numbers, the amounts, the
            dates — scrolling back up for each line.

            Only drawn when there is something to chase. A heading over an
            empty list is a screen making a coach read a section to learn that
            it is empty, and the section above already says so in a sentence. */}
        {chase.groups.length || chase.withheld ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="By Who Owes It" note="Everything one person is late on, in one note" />
              {chase.withheld ? <Flag style={{ marginTop: sp.sm }}>{chase.withheld}</Flag> : null}
              {chase.groups.map((g) => (
                <View key={g.key} style={{ paddingVertical: sp.md, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
                    <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, flex: 1 }} numberOfLines={1}>{g.billTo}</Text>
                    <Text style={{ ...ty.label, color: t.ink3 }}>
                      {g.invoices.length} invoice{g.invoices.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {/* One line per currency and never a sum across them. `pots`
                      is null under anything but a whole read, which is why
                      there is no figure to draw there rather than a hidden
                      one. */}
                  {g.pots ? g.pots.map((p) => (
                    <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{p.count} in {p.currency}</Text>
                      <Text style={{ ...ty.label, ...numeric, color: t.ink }}>{minorMoney(p.minorUnits, p.currency) ?? DASH}</Text>
                    </View>
                  )) : null}
                  {g.pots && g.pots.length > 1 ? (
                    <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
                      These are separate amounts of money and are deliberately not added together.
                    </Flag>
                  ) : null}
                  {/* "Past a date they were shown" and "past a day you noted"
                      are two different kinds of lateness, and only one of them
                      is something to put in a demand. `overdue` counts the
                      first alone — see `fromChaseDate` in
                      src/lib/coachInvoice.ts. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {g.overdue
                      ? `${g.overdue} past a date you stated, the oldest by ${g.worstDays} day${g.worstDays === 1 ? '' : 's'}.`
                      : 'Outstanding, and none of it is past a date the client was ever shown.'}
                  </Text>
                  {g.clientId ? null : (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      Not tied to an account, so nothing here can notify them. This note is how you reach them.
                    </Text>
                  )}
                  {chaseMessageCaveat(g) ? (
                    <Flag style={{ marginTop: sp.sm }}>{chaseMessageCaveat(g)}</Flag>
                  ) : null}
                  {/* Absent rather than dead under a read that came back short:
                      a note saying "these three are still outstanding" when
                      there are five is a demand for the wrong money, under the
                      coach's own name. The sentence above says why. */}
                  {g.pots ? (
                    <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm, flexWrap: 'wrap' }}>
                      <Pressable onPress={() => sendChase(g)} hitSlop={8} accessibilityRole="button"
                        accessibilityLabel={`Write a note to ${g.billTo} about ${g.invoices.length} outstanding invoice${g.invoices.length === 1 ? '' : 's'}`}
                        style={{ paddingVertical: sp.xs }}>
                        <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Write the note</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                The note is built from what you recorded: your own numbers, the amounts you typed and the dates you stated. It says those are your records and asks — nothing here has been checked against a bank, and a client who paid you on Friday must not be told they did not.
              </Text>
            </Section>
          </>
        ) : null}

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

        {/* The ones with no date of any kind on them.
            `ageingBook` has always separated these — they are neither chased
            nor safe — and the screen carried only `undatedNote`, a sentence
            saying they were outside every figure and every list. So a coach's
            whole back catalogue was described and never shown, and there was
            nothing to do about any of it. They are listed now, and each one
            carries the two acts that were missing: say the coach means to start
            chasing it from a day, or say it was paid. */}
        {ageing.undated.length ? (
          <Section>
            <SectionHead title="No Due Date On Them" note="In no figure above and on no list of what is late" />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{CHASE_FROM_IS_NOT_A_DUE_DATE}</Text>
            {ageing.undated.map(({ invoice, age }) => undatedRow(invoice, age.line))}
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
                  {/* Offered on every row that can take it, not only on the
                      ageing lists: a coach scrolling their whole book is the
                      person most likely to find the one they were paid for
                      three weeks ago. `settleBlocker` is the same reader the
                      sheet and the server both use, so the control is absent
                      exactly where the act would be refused. */}
                  {!settleBlocker(inv) ? (
                    <Pressable onPress={() => openSettle(inv)} hitSlop={8} accessibilityRole="button"
                      accessibilityLabel={`Record invoice ${invoiceNumber(inv.seq)} as paid`} disabled={busy}
                      accessibilityState={{ disabled: busy, busy }}
                      style={{ paddingVertical: sp.xs }}>
                      <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.brand }}>They paid it</Text>
                    </Pressable>
                  ) : null}
                  {/* `voidBlocker`, not `!inv.voidedAt`. An invoice the coach
                      has recorded as settled cannot be voided — part 660's
                      `coach_invoices_not_both_chk` refuses a document that says
                      both that it was paid and that it was cancelled — and
                      part 138's function has no matching guard, so the tap
                      reached the UPDATE, tripped the CHECK, and came back as an
                      Alert carrying the raw Postgres sentence about a relation
                      and a constraint name. The same reader the sheet uses, so
                      the control is absent exactly where the act would be
                      refused. */}
                  {!voidBlocker(inv) ? (
                    <Pressable onPress={() => { setVoidTarget(inv); setVoidReason(''); }} hitSlop={8} accessibilityRole="button"
                      accessibilityLabel={`Void invoice ${invoiceNumber(inv.seq)}`} style={{ paddingVertical: sp.xs }}>
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Void</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {/* The screen's ONLY empty state. It carries the sequence fact that
              used to be said again a section higher up, and it is said under a
              whole read alone — "the first one is 0001" to a coach on their
              thirty-second invoice is the same defect as "Nothing issued yet"
              to the same coach. */}
          {!rows.length && status === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Nothing here yet, so the first invoice you issue is number 0001. An invoice you issue stays in this list for good — it can be voided, never edited and never deleted, because the copy your client is holding does not change.
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
              {/* ── the chips stay, and the month joins them ──────────────
                  "In a week" and "In a month" answer the common cases in one
                  tap and a calendar does not replace them — a coach who means
                  thirty days should not have to count to thirty on a grid. What
                  the grid answers is the OTHER case: "the Friday after their
                  holiday", which was a `TextInput` and was the reported fault
                  — the soft keyboard comes up over the bottom of this sheet,
                  which is where the field sits.

                  Days before today are greyed out because
                  `invoiceDraftBlocker` refuses them: an invoice cannot fall due
                  before it exists, and this one is issued today. Clearing is
                  the empty state and stays reachable — a due date is optional,
                  there is no suggested term, and none is preselected. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Pressable onPress={() => setPick('due')}
                  accessibilityRole="button"
                  accessibilityLabel={dueText
                    ? 'When you expect to be paid. Currently ' + dueText + '. Opens a calendar.'
                    : 'When you expect to be paid. Not set, so the document states no due date at all. Opens a calendar.'}
                  style={dayBox}>
                  <Text style={{ ...ty.body, color: dueText ? t.ink : t.ink3, flex: 1 }}>
                    {dueText || 'No due date'}
                  </Text>
                  <Icon name="calendar" size={18} color={t.ink2} />
                </Pressable>
                {dueText ? <Ghost label="Clear" a11yLabel="Clear the due date — the document then states none" onPress={() => setDueText('')} /> : null}
              </View>
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

              {/* ── what YOU state about tax ──────────────────────────────
                  Optional, empty by default, and printed exactly as typed.
                  Repple works nothing out from either field: there is no tax
                  amount on the document, no net figure and no subtotal, because
                  what a rate means for a particular supply depends on a margin
                  scheme, a flat-rate scheme, a reverse charge and half a dozen
                  other things this app is not told about. What it stops doing
                  is refusing to print a fact the coach stated, which is why a
                  registered coach had to keep a second invoicing system. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>Tax rate you state, as a percentage (optional)</Text>
              <TextInput value={taxRateText} onChangeText={setTaxRateText} keyboardType="decimal-pad"
                placeholder="20, or leave it empty" placeholderTextColor={t.ink3}
                accessibilityLabel="Tax rate you state" style={inp} />

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>Your tax registration number (optional)</Text>
              <TextInput value={taxRegistration} onChangeText={setTaxRegistration} autoCapitalize="characters" autoCorrect={false}
                placeholder="GB123456789, or leave it empty" placeholderTextColor={t.ink3}
                accessibilityLabel="Your tax registration number" style={inp} />

              {lastTax && !taxRateText.trim() && !taxRegistration.trim() ? (
                <View style={{ marginTop: sp.sm }}>
                  <Ghost label="Use What I Stated Last Time"
                    onPress={() => {
                      setTaxRateText(lastTax.taxRatePct != null ? String(lastTax.taxRatePct) : '');
                      setTaxRegistration(String(lastTax.taxRegistration ?? ''));
                    }} />
                </View>
              ) : null}

              <View style={{ marginTop: sp.lg }}>
                <Flag tone={t.ink3}>
                  Anything you type in those two boxes is printed on the document word for word and nothing is worked out from it. Repple calculates no tax amount, shows no net figure and no subtotal, and never will. Whether a rate and a number are all your invoices have to carry where you trade is a question for your accountant.
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

      {/* ── RECORDING THAT ONE WAS PAID ──────────────────────────────────────
          A sheet rather than `Alert.prompt`, which exists only on iOS — a
          control that silently does nothing on Android is exactly the dead
          button this codebase keeps finding. Its own `visible` identifier for
          the same reason the void sheet has one. */}
      <Modal visible={!!settleTarget} animationType="slide" transparent onRequestClose={() => setSettleTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, maxHeight: '90%' }}>
            {/* The longest confirmation in the file: the number, who and how much, a
                six-line paragraph about what settling does, a day box, an optional
                note field and the buttons. With the keyboard up over the note the top
                of it — including the amount a coach would use to notice they are on
                the wrong row — is off the top of the window. */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.title, color: t.ink }}>
                Invoice {settleTarget ? invoiceNumber(settleTarget.seq) : ''} was paid?
              </Text>
              {/* WHO and HOW MUCH, under the number.
                  This sheet named the sequence number alone, and the number is
                  the one thing on the row a coach does not know by heart. "They
                  paid it" sits beside "Send" on every row of the whole-book list
                  below, the rows are number-name-amount at a glance, and this is
                  the only act on the screen that cannot be undone or worked
                  around: a settlement is written once, there is no un-settle, and
                  part 660's `coach_invoices_not_both_chk` means a mis-settled
                  invoice cannot be voided either. It leaves every chase list and
                  the outstanding figure for good.
                  So the confirmation restates the two facts a coach would use to
                  notice they were on the wrong row. `money()` returns null rather
                  than a bare figure when the currency is missing, and a dash is
                  drawn instead — the same rule the rows themselves keep. */}
              {settleTarget ? (
                <Text style={{ ...ty.body, color: t.ink, marginTop: 4 }}>
                  {money(settleTarget) ?? DASH} from {settleTarget.billTo}
                </Text>
              ) : null}
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
                This records your own statement that the money arrived. Nothing about the document changes — it still says what it said when you issued it — and this is written once: if the money later goes back out, that is a refund or a chargeback and it happened on its own day. It cannot be undone, and a settled invoice cannot be voided either.
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>The day it arrived</Text>
              {/* A box that opens a month, not a box that raises a keyboard over
                  itself. The refused days are GREYED OUT in the sheet rather than
                  offered and then refused — `settleDayBlocker` has two hard ends
                  and a coach who has to tap a day to find out it is not allowed
                  is being handed the text box back with extra steps. See
                  `range` on the sheet at the foot of this file. */}
              <Pressable onPress={() => setPick('settle')}
                accessibilityRole="button"
                accessibilityLabel={settleDay
                  ? 'The day the money arrived. Currently ' + settleDay + '. Opens a calendar.'
                  : 'The day the money arrived. Not set yet. Opens a calendar.'}
                style={dayBox}>
                <Text style={{ ...ty.body, color: settleDay ? t.ink : t.ink3, flex: 1 }}>{settleDay || today}</Text>
                <Icon name="calendar" size={18} color={t.ink2} />
              </Pressable>
              {/* The refusal is kept even though the sheet no longer offers a day
                  that trips it. `settleInvoice` and part 660's function refuse on
                  the same two conditions, and the screen's copy is the
                  convenience rather than the rule — if a day ever reaches this
                  state by another route, the coach reads why here instead of
                  being told "Recorded" for a write that did not happen. */}
              {settleTarget && settleDay.trim() && settleDayBlocker(settleTarget, settleDay.trim(), today) ? (
                <Flag style={{ marginTop: sp.sm }}>{settleDayBlocker(settleTarget, settleDay.trim(), today)}</Flag>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>How it arrived (optional)</Text>
              <TextInput value={settleNote} onChangeText={setSettleNote}
                placeholder="Bank transfer" placeholderTextColor={t.ink3}
                accessibilityLabel="How the money arrived" style={inp} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Printed on the document if you send it again, in your own words. Nothing reads it for anything.
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}>
                  <Cta label="Cancel" tone={t.surface2} wide onPress={() => { setSettleTarget(null); setSettleDay(''); setSettleNote(''); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Cta label={busy ? 'Recording…' : 'Record it'} wide
                    disabled={busy || !settleTarget || !!settleDayBlocker(settleTarget, settleDay.trim(), today)}
                    onPress={() => { void doSettle(); }} />
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── THE DAY TO START CHASING ONE FROM ────────────────────────────────
          Not a due date, and the sheet says so before the coach types
          anything. `due_on` is on the document and cannot move; this is the
          coach's note about their own list and reaches nobody else. */}
      <Modal visible={!!chaseTarget} animationType="slide" transparent onRequestClose={() => setChaseTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
            <Text style={{ ...ty.title, color: t.ink }}>
              Chase invoice {chaseTarget ? invoiceNumber(chaseTarget.seq) : ''} from
            </Text>
            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{CHASE_FROM_IS_NOT_A_DUE_DATE}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg, marginBottom: 6 }}>The day</Text>
            {/* The same box, and the same greying, with ONE end. `chaseFromDayBlocker`
                has no upper bound on purpose — a coach who has agreed to wait
                until March sets March, and that is a plan about their own book —
                so the sheet greys out only what is before the invoice existed. */}
            <Pressable onPress={() => setPick('chase')}
              accessibilityRole="button"
              accessibilityLabel={chaseDay
                ? 'The day to start chasing this invoice from. Currently ' + chaseDay + '. Opens a calendar.'
                : 'The day to start chasing this invoice from. Not set yet. Opens a calendar.'}
              style={dayBox}>
              <Text style={{ ...ty.body, color: chaseDay ? t.ink : t.ink3, flex: 1 }}>{chaseDay || today}</Text>
              <Icon name="calendar" size={18} color={t.ink2} />
            </Pressable>
            {chaseTarget && chaseDay.trim() && chaseFromDayBlocker(chaseTarget, chaseDay.trim()) ? (
              <Flag style={{ marginTop: sp.sm }}>{chaseFromDayBlocker(chaseTarget, chaseDay.trim())}</Flag>
            ) : null}
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
              <View style={{ flex: 1 }}>
                <Cta label="Cancel" tone={t.surface2} wide onPress={() => { setChaseTarget(null); setChaseDay(''); }} />
              </View>
              <View style={{ flex: 1 }}>
                <Cta label={busy ? 'Saving…' : 'Set it'} wide
                  disabled={busy || !chaseTarget || !chaseDay.trim() || !!chaseFromDayBlocker(chaseTarget, chaseDay.trim())}
                  onPress={() => { void doChaseFrom(false); }} />
              </View>
            </View>
            {/* Clearing is its own act and is offered plainly. It puts the
                invoice back on the undated list, which is where it was before
                anybody made a plan for it — not a failure state and not a
                deletion of anything. */}
            {chaseTarget?.chaseFrom ? (
              <Pressable onPress={() => { void doChaseFrom(true); }} disabled={busy} hitSlop={8}
                accessibilityRole="button" accessibilityLabel="Clear the day to chase this invoice from"
                accessibilityState={{ disabled: busy, busy }}
                style={{ paddingVertical: sp.md, alignItems: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: busy ? t.ink3 : t.ink2 }}>
                  Clear it — put this one back on the undated list
                </Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── the three months ─────────────────────────────────────────────────
          Siblings of the sheets whose fields open them, for the reason `pick`
          gives. Every one of them carries the SAME bounds as the blocker that
          guards its write, so a day the sheet offers is a day the write takes:
          a coach who taps a cell and reads a refusal has been handed back the
          text box these replaced.

          The bounds are read straight off the invoice in hand, and an invoice
          whose `issuedOn` came back unreadable produces no floor rather than an
          empty calendar — see src/lib/dayRange.ts. The blockers below the
          fields still refuse it, so widening the grid cannot let a bad day
          through. */}
      <DateSheet
        visible={pick === 'due'}
        value={dueText}
        range={{ min: today }}
        heading="Due Date"
        note="When you expect to be paid. It cannot fall before today, which is the day this one is issued."
        onCancel={() => setPick(null)}
        onPick={(iso) => { setDueText(iso); setPick(null); }}
      />
      <DateSheet
        visible={pick === 'settle'}
        value={settleDay}
        fallback={today}
        /* Both ends of `settleDayBlocker`, drawn rather than said. Money cannot
           have arrived before the document existed, and money recorded as
           arriving tomorrow is a figure in a ledger about a day that has not
           happened. */
        range={{ min: settleTarget?.issuedOn ?? null, max: today }}
        heading="The Day It Arrived"
        note="Your own record of when the money reached you. Nothing before the invoice was written, and nothing after today."
        onCancel={() => setPick(null)}
        onPick={(iso) => { setSettleDay(iso); setPick(null); }}
      />
      <DateSheet
        visible={pick === 'chase'}
        value={chaseDay}
        fallback={today}
        /* One end only, matching `chaseFromDayBlocker`. There is deliberately no
           ceiling: a coach who has agreed to wait until March sets March. */
        range={{ min: chaseTarget?.issuedOn ?? null }}
        heading="Chase It From"
        note="Your own note about your own list. Nothing before the invoice was written."
        onCancel={() => setPick(null)}
        onPick={(iso) => { setChaseDay(iso); setPick(null); }}
      />
    </SafeAreaView>
  );
}
