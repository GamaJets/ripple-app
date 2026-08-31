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
  invoiceBook, money, kindLabel,
  type CoachInvoice, type InvoiceDraft, type InvoiceKind,
} from '../../src/lib/coachInvoice';
import { minorMoney } from '../../src/lib/coachMoney';
import {
  fetchMyInvoices, fetchInvoiceIssuer, fetchInvoiceCurrency, issueInvoice, voidInvoice,
  type InvoiceCurrency,
} from '../../src/ui/coachInvoices';
import type { LoadStatus } from '../../src/ui/loadStatus';

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
  const [ccy, setCcy] = useState<InvoiceCurrency>({ currency: null, source: null, status: 'loading' });

  const [open, setOpen] = useState(false);
  const [billTo, setBillTo] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
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

  // The date the DEVICE is on, not the server's UTC date. A coach in Auckland
  // issuing at 10am would otherwise date their document yesterday. Part 138
  // allows a day's grace either side for exactly this.
  const today = isoToday(new Date());

  const draft = (): InvoiceDraft => ({
    billTo, description, amountText, currency: ccy.currency, kind, issuedOn: today, note: note.trim() || null,
  });
  const blockers = invoiceBlockers(draft());
  const canIssue = blockers.length === 0 && !busy;

  const reset = () => { setBillTo(''); setClientId(null); setDescription(''); setAmountText(''); setKind('requested'); setNote(''); };

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
    Alert.alert(
      `Invoice ${invoiceNumber(issued.seq)} issued`,
      `${money(issued) ?? DASH} to ${issued.billTo}. It is in your list now. Send it whenever you like.`,
      [{ text: 'Later', style: 'cancel' }, { text: 'Send it', onPress: () => { void send(issued); } }],
    );
  };

  const send = async (inv: CoachInvoice) => {
    const doc = coachInvoiceDoc({ invoice: inv, issuer: { status: issuer.status, name: issuer.name, brand: appName } });
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

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const G = layout.gutter;

  // The gate. Said as a sentence a coach can act on, naming who sets it —
  // never as a silent fallback to a currency nobody chose.
  const currencyBlocker = ccy.status === 'error'
    ? 'Your currency could not be read just now, so nothing can be issued. This is not a setting that is missing — it is a read that failed. Pull back and open this again in a moment.'
    : !ccy.currency
      ? 'No currency has been set for you. Repple is white-labelled, so there is no default that would be right for every gym — and an invoice with the wrong currency on it is worse than no invoice. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.'
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

        <Section>
          <SectionHead title={rows.length ? `${rows.length} issued` : 'Nothing issued yet'} />
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
          <Cta label="Issue an invoice" wide disabled={!!currencyBlocker} onPress={() => setOpen(true)} />
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
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                It will be number {invoiceNumber((rows[0]?.seq ?? 0) + 1)} in your own sequence, dated {invoiceDayLabel(today)}
                {ccy.currency ? `, in ${ccy.currency}` : ''}.
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
                <Cta label="Keep it" tone={t.surface2} wide onPress={() => { setVoidTarget(null); setVoidReason(''); }} />
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
