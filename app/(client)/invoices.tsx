// Client · Invoices. What the member's gym says they owe it.
//
// ── The notification with nowhere to go ────────────────────────────────────
//
// supabase/parts/146 writes a member a notification the moment a gym invoice
// leaves draft — "An invoice from your gym" — and src/lib/notifyInbox.ts
// carries it with `route: null` and the note "there is no member screen for
// `gym_invoices` yet". That notification deliberately states no amount either
// (part 146 argues it: `gym_invoices.currency` was `not null default 'AED'`,
// and a default is not a choice). So a charge appeared against somebody's name,
// they were told a document existed, they were not told what it was for or how
// much, and the only way to find out was to ask at the desk.
//
// This is the screen it now opens. `gym_invoices_own_r` — `using (member_id =
// auth.uid())` — has admitted the member since part 29 was written; nothing had
// ever read it from this side.
//
// ── The invoice from a COACH is not here, and that is not a bug ────────────
//
// The same wording exists for a personal trainer's invoice: "An invoice from
// your coach", also routeless. `coach_invoices` is NOT readable by the client
// and the decision is argued at length in supabase/parts/138, which does not
// merely omit a client policy but names and DROPS one so that a later rebuild
// cannot leave one standing. The client is handed that document by the coach
// through the share sheet, and a read of the coach's ledger would hand them the
// per-coach sequence number of every other document in it.
//
// So this screen reads one table, says so in its own title, and
// `COACH_INVOICE_NOT_HERE` tells the member where a trainer's invoice actually
// comes from — because an Invoices screen that does not contain theirs reads as
// an app that lost their bill. Widening that policy is a schema decision for
// somebody holding the whole argument, not a side effect of building a screen.
//
// ── What this screen will not do ───────────────────────────────────────────
//
// It will not take a payment: this app has no gym payment rail, and a "Pay now"
// button that opens nothing is worse than the sentence explaining there is not
// one. It will not compute a debt from a partial read, it will not call a draft
// a bill, and it will not tell somebody they owe nothing on the strength of a
// read that failed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Ghost, Flag, Notice, PartialRead, fig, PageHead } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { isWhole } from '../../src/ui/loadStatus';
import { useAuth } from '../../src/ui/auth';
import { useToday } from '../../src/ui/today';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../../src/lib/readCache';
import { amount, fetchMyInvoices } from '../../src/lib/memberRecord';
import {
  invoiceStanding, invoiceStandingLabel, invoiceNote, isOwed, owedByCurrency, owedEmptyLine,
  invoicesEmptyLine, invoiceCopyText,
  AMOUNT_AS_RECORDED, COACH_INVOICE_NOT_HERE, NO_PAYMENT_HERE,
  type InvoiceStanding, type MemberInvoice,
} from '../../src/lib/memberInvoices';
// The system share sheet with a message in it — already shipped, already used
// by six screens, and the reason this needs no new dependency. See
// `invoiceCopyText` for why the copy is text and not a PDF.
import { shareText } from '../../src/lib/exportShare';
import { appLocale } from '../../src/lib/locale';
import { localDate } from '../../src/lib/localDate';

/** A bare 'YYYY-MM-DD' as a member reads it. Built locally — an invoice is
 *  dated a calendar day, and `new Date('2026-09-01')` is the 31st of August
 *  west of Greenwich (src/lib/localDate.ts). */
function day(iso: string | null): string {
  const d = localDate(iso);
  if (!d) return fig(null);
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The colour of the mark beside a standing. Tone marks the row; the words stay
 *  ink, because a tone as text does not clear 4.5:1 at every theme. */
function toneOf(s: InvoiceStanding, t: ReturnType<typeof useTheme>): string {
  switch (s.kind) {
    case 'overdue': return t.crit;
    case 'due': return t.warn;
    case 'paid': return t.good;
    // A draft, a cancellation, a write-off and a status this app cannot read
    // are all things the member needs no colour about. A grey mark says "read
    // the line" rather than "act on this".
    default: return t.ink3;
  }
}

export default function Invoices() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const uid = auth.user?.id || '';
  // `useToday`, never `todayIso(new Date())` in the render body or a memo with
  // an empty dependency list. This screen is registered `href: null`, so it
  // mounts once and is never torn down: an invoice due at midnight would go on
  // reading "due" for as long as the phone stayed in a pocket, on the one
  // screen whose whole job is to say whether something is late.
  const today = useToday();

  const [rows, setRows] = useState<MemberInvoice[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  /** When the list was last confirmed, or null when it just was. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    if (!uid) { if (!auth.loading) setStatus('error'); return; }

    // The same cache the payments screen keeps, on the same terms and for the
    // same reason: a member opening this in a basement gym with no signal
    // should see the invoice they were notified about rather than a blank
    // screen that reads as "you have no invoices". A cached page is NEVER
    // 'ready', so the outstanding figure below is withheld over it — a total
    // over a week-old copy could be missing the invoice raised this morning.
    try {
      const cached = readCache<MemberInvoice>(await AsyncStorage.getItem(cacheKey('invoices', uid)));
      if (cached.rows && cached.rows.length && withinHorizon(cached.at)) {
        setRows(cached.rows);
        setCachedAt(cached.at);
      }
    } catch { /* no usable cache; the read below is the only source */ }

    const res = await fetchMyInvoices(supabase, uid);
    if (!res.ok) {
      reportError('invoices.load', new Error(res.reason));
      // Deliberately NOT clearing `rows`: whatever is on screen is the last
      // thing we knew, and the banner says it is not confirmed current.
      setStatus('error');
      return;
    }
    setRows(res.value.rows);
    setStatus(res.value.truncated ? 'partial' : 'ready');
    setCachedAt(null);
    if (!res.value.truncated) {
      AsyncStorage.setItem(cacheKey('invoices', uid), packCache(res.value.rows))
        .catch(() => { /* the list is right this session either way */ });
    }
  }, [uid, auth.loading]);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(async () => { await load(); }, [load]);
  const pull = usePullToRefresh(refresh);

  // Null under anything but a whole read — including 'partial', where the rows
  // are real and there are more of them than arrived. A debt summed over a
  // prefix is not a smaller debt.
  const owed = useMemo(() => owedByCurrency(rows, today, status), [rows, today, status]);
  const owedCount = useMemo(
    () => (isWhole(status) ? rows.filter((r) => isOwed(invoiceStanding(r, today))).length : 0),
    [rows, today, status],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
      >
        <PageHead title="Invoices" />
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>What your gym has billed you for</Text>


        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not read" title="We couldn’t read your invoices"
              note={rows.length
                ? (cachedAtLine(cachedAt) ?? 'What is listed below is what we had before the read failed. It is not confirmed current, and there may be invoices missing from it.')
                : 'This is not a record with nothing in it — it is a record we could not open. Pull down to try again, or ask your gym for a copy.'} >
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void load(); }} /></View>
            </Notice>
          </Section>
        ) : null}

        {status === 'partial' ? (
          <Section><PartialRead what="invoices" shown={rows.length} onPress={() => { void load(); }} /></Section>
        ) : null}

        {/* ── what is still being asked for ───────────────────────────────── */}
        <Section>
          <SectionHead title={(owed?.pots.length ?? 0) > 1 ? 'Still Owed, by Currency' : 'Still Owed'} />
          {owed && owed.pots.length ? (
            owed.pots.map((p, i) => (
              <View key={p.currency}
                style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {p.count} invoice{p.count === 1 ? '' : 's'} unpaid
                </Text>
                <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{amount(p.minorUnits, p.currency)}</Text>
              </View>
            ))
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {/* NOT `rows.length ? 'nothing is outstanding' : …`. An unpaid
                  invoice that states no amount or no currency produces no pot
                  — `sumTaken` counts it and refuses to add it — so "nothing is
                  outstanding" was being printed as a fact directly above the
                  flag saying two unpaid invoices are missing from the figure.
                  A draft was miscounted the same way. `owedEmptyLine` reads the
                  standings rather than the pots; see its header. */}
              {owed ? owedEmptyLine(rows, today, status) : invoicesEmptyLine(status)}
            </Text>
          )}
          {owed && owed.unpriced + owed.unlabelled > 0 ? (
            <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
              {owed.unpriced + owed.unlabelled} unpaid invoice{owed.unpriced + owed.unlabelled === 1 ? '' : 's'} state
              {owed.unpriced + owed.unlabelled === 1 ? 's' : ''} no amount, or no currency, so {owed.unpriced + owed.unlabelled === 1 ? 'it is' : 'they are'} not
              in the figure above. Ask reception what {owed.unpriced + owed.unlabelled === 1 ? 'it' : 'they'} cover{owed.unpriced + owed.unlabelled === 1 ? 's' : ''}.
            </Flag>
          ) : null}
          {owedCount > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{NO_PAYMENT_HERE}</Text>
          ) : null}
        </Section>


        {/* ── every invoice ───────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Every Invoice" note={isWhole(status) && rows.length ? `${rows.length}` : undefined} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your invoices…</Text>
          ) : rows.length === 0 ? (
            // Never said under 'error' — the banner above owns that case, and
            // "your gym has not invoiced you" over a read that failed is the
            // one sentence this screen must never print.
            isWhole(status) ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>{invoicesEmptyLine(status)}</Text>
            ) : null
          ) : (
            rows.map((inv, i) => {
              const s = invoiceStanding(inv, today);
              return (
                <View key={inv.id}
                  style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
                    <View style={{ flex: 1 }}>
                      {/* The number is what a member quotes on a bank transfer
                          (part 180). Rows raised before the column existed were
                          never numbered and are not given one here. */}
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                        {inv.number == null ? day(inv.issuedOn) : `No. ${inv.number} · ${day(inv.issuedOn)}`}
                      </Text>
                      {/* The gym's own statement of what the charge is for. A
                          bill with no description is a bill nobody can check,
                          and the absence is stated rather than papered over. */}
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {inv.note ?? 'Your gym did not record what this is for.'}
                      </Text>
                    </View>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>
                      {amount(inv.amountCents, inv.currency)}
                    </Text>
                  </View>
                  <Flag tone={toneOf(s, t)} style={{ marginTop: sp.sm }}>
                    {invoiceStandingLabel(s)} — {invoiceNote(s)}
                  </Flag>
                </View>
              );
            })
          )}
          {isWhole(status) && rows.length ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{AMOUNT_AS_RECORDED}</Text>
          ) : null}

          {/* ── the copy the member could not take away ──────────────────────
              Every comparable product — Mindbody, Glofox, Wodify, PushPress —
              lets a member get a billing document out of the app and into an
              email, a note or an accountant's hands. This one said "ask your
              gym for a copy" and stopped, on a record the member is already
              permitted to read. `shareText` is the phone's own share sheet and
              has shipped for six other screens, so nothing new is needed.

              Offered over ANY list with rows in it, including a cached one and
              a truncated one, because those are exactly the moments somebody
              wants the copy — standing at a desk, arguing about a charge. What
              they get is qualified in its own second line rather than withheld:
              `invoiceCopyText` writes the read's status above the rows, so a
              prefix forwarded to somebody else still says it is a prefix. */}
          {rows.length ? (
            <View style={{ flexDirection: 'row', marginTop: sp.md }}>
              <Ghost label="Send Yourself a Copy"
                a11yLabel="Send yourself a copy of these invoices"
                onPress={() => { void shareText(invoiceCopyText(rows, today, status), 'Invoices from your gym'); }} />
            </View>
          ) : null}
        </Section>


        {/* ── the two things this screen is not ───────────────────────────── */}
        <Section>
          <SectionHead title="An Invoice From a Trainer" />
          <Text style={{ ...ty.label, color: t.ink3 }}>{COACH_INVOICE_NOT_HERE}</Text>
          <View style={{ marginTop: sp.md }}>
            <Ghost label="What You Have Paid" onPress={() => router.push('/(client)/receipts')} />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
