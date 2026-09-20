// Client · Payments. What the gym has recorded taking from this member.
//
// `gym_payments` (supabase/parts/29-gym-operating-record.sql) is described in
// its own schema as "money the gym actually received. Recorded, never inferred:
// a row here means somebody took money, and there is no other way for one to
// appear." Until now the only people who could see it were the gym's owners.
// The member it was taken from had no screen at all — not a total, not a date,
// not a list — which is the one record you want when a charge looks wrong.
//
// ── Why the totals can disappear while the list stays ──────────────────────
//
// Three things have to be true before this screen puts a total on the page, and
// each of them has cost somebody a wrong number somewhere in this codebase:
//
//   · the read landed          — 'error' means UNKNOWN, and "No payments yet"
//                                said under a refused read is a lie about
//                                somebody's money;
//   · it came back whole       — PostgREST stops at 1000 rows and says nothing,
//                                so a sum over a truncated read is a subtotal
//                                presented as a total (src/lib/rowCap.ts);
//   · and every row in the sum is in the same currency — Repple is white-label
//                                and `gym_payments.currency` is per row, so one
//                                figure over mixed currencies is a number in no
//                                currency that exists.
//
// The third is why the hero is a per-currency list rather than one figure. A
// member who paid a Dubai gym in dirhams and a London one in pounds gets two
// lines and both are true; they never get their sum.
//
// ── And why one table was never the answer ────────────────────────────────
//
// This screen totalled `gym_payments` and nothing else, under a heading that
// says what you have paid. The gym's own console has never done that: /members
// joins memberships, payments, passes, one-to-ones and packs into one figure
// through `paidTotal` (src/lib/gymPaidTotal.ts). So the gym could see four
// sources and the person the money came out of could see one — and the three
// that were missing are the ones somebody actually queries: a ten-pack bought
// once, a coaching subscription that has renewed eleven times, the day passes
// bought before they joined.
//
// All four are read here now and `memberPaid` (src/lib/memberPaid.ts) is what
// adds them up — or refuses to, by name, when any one of the four reads did not
// come back whole. A fifth source exists and this app may not read it: the cash
// a coach was handed is in `coach_receipts`, which supabase/parts/190 keeps
// private to that coach on purpose. `PAID_EXCLUDES_CASH` is on the screen
// saying so, because a total that is silently short is worse than one that
// names the part it cannot see — and the member is the only person who can
// supply that part from memory.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Flag, Notice, PartialRead, fig, PageHead } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { isWhole } from '../../src/ui/loadStatus';
import { useAuth } from '../../src/ui/auth';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../../src/lib/readCache';
import {
  amount, fetchMyPayments, fetchMyPasses, fetchMyCoachSales, fetchMyCoachRenewals,
  methodLabel, totalsByCurrency, passUsesLine,
  type MemberPayment, type MemberPass, type MemberCoachSale, type MemberCoachRenewal,
} from '../../src/lib/memberRecord';
import {
  memberPaid, paidEmptyLine, refundedLine, unstatedLine,
  PAID_EXCLUDES_CASH, PAID_IS_EVERY_SOURCE,
} from '../../src/lib/memberPaid';
import { num } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';
import { localDate } from '../../src/lib/localDate';

/** A timestamptz as the day it happened, in the reader's own zone. A payment
 *  carries an instant, not a calendar date, so this one is parsed normally. */
function paidOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A bare 'YYYY-MM-DD' as a member reads it. Local, because a date column means
 *  a calendar day in the reader's own life and `new Date('2026-02-01')` is the
 *  31st of January west of Greenwich — see src/lib/localDate.ts. */
function dayOn(iso: string | null): string {
  const d = localDate(iso);
  if (!d) return fig(null);
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** What a pack was: ten sessions, or a one-off. `sessions_total` is null for
 *  anything that is not a pack, which is a fact rather than a zero. */
function saleLabel(p: MemberCoachSale): string {
  if (p.sessionsTotal == null) return 'Bought from your trainer';
  // The null before the count, not after it. `sessions_used` used to arrive as
  // a settled 0, so a pack half delivered read as one nobody had started —
  // beside the price the member paid for it.
  if (p.sessionsUsed == null) return `${num(p.sessionsTotal)}-session pack · we couldn’t read how many are used`;
  return `${num(p.sessionsTotal)}-session pack · ${num(p.sessionsUsed)} used`;
}

/** A row on the breakdown: one source, what it came to, or why it did not.
 *
 *  The status word is not decoration. Under anything but a whole read the
 *  figure beside a source is absent, and a blank there reads as nought — which
 *  is the substitution this entire screen is built to refuse. */
function SourceLine({ t, label, taken, status, first }: {
  t: ReturnType<typeof useTheme>;
  label: string;
  taken: { pots: { currency: string; minorUnits: number }[] };
  status: LoadStatus;
  first?: boolean;
}) {
  const said = isWhole(status)
    ? (taken.pots.length ? taken.pots.map((p) => amount(p.minorUnits, p.currency)).join(' · ') : 'Nothing recorded')
    : status === 'error' ? 'Not read'
      : status === 'partial' ? 'Too many to total'
        : 'Reading…';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3, flex: 1 }}>{label}</Text>
      <Text style={{ ...ty.body, ...numeric, color: isWhole(status) ? t.ink : t.ink3 }}>{said}</Text>
    </View>
  );
}

export default function Receipts() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const uid = auth.user?.id || '';

  const [rows, setRows] = useState<MemberPayment[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // The other three sources. Each keeps its OWN status because they are four
  // separate reads that fail independently, and `memberPaid` refuses a total
  // when any single one of them did — a member shown three quarters of their
  // money under a heading that says "paid in total" has been told something
  // false about their own account, quietly.
  const [passes, setPasses] = useState<MemberPass[]>([]);
  const [passStatus, setPassStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [sales, setSales] = useState<MemberCoachSale[]>([]);
  const [saleStatus, setSaleStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [renewals, setRenewals] = useState<MemberCoachRenewal[]>([]);
  const [renewalStatus, setRenewalStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  /** When the list was last confirmed, or null when it just was. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) {
      setStatus('ready'); setPassStatus('ready'); setSaleStatus('ready'); setRenewalStatus('ready');
      return;
    }
    if (!uid) {
      // Every source is unknown, not empty. Marking only the payments read
      // failed would leave three sources sitting at 'loading' forever and the
      // total withheld with a reason that says it is still reading.
      if (!auth.loading) {
        setStatus('error'); setPassStatus('error'); setSaleStatus('error'); setRenewalStatus('error');
      }
      return;
    }

    // ── this device's copy, before the network ──────────────────────────
    //
    // "NOT clearing `rows`" below was as far as this could go: it kept what was
    // already on screen, and on a cold launch with no signal there was nothing
    // to keep. A payment history ages more gracefully than almost anything else
    // in this app — a receipt from March is still a receipt from March — so the
    // default week-long horizon applies, and the age is stated either way.
    //
    // A cached page is NEVER 'ready', which matters here more than anywhere
    // else on this screen: the totals below are computed only from a whole read
    // of all four sources, so a cached list shows its rows and no totals rather
    // than a total over a set that may be missing last week's payment.
    //
    // Only the gym's payments are cached, and deliberately only them. A cache
    // per source would have to be invalidated per source, and a stale pass
    // silently rejoining a total is the failure this whole screen is about;
    // the three other reads simply show their own status until they land.
    try {
      const cached = readCache<MemberPayment>(await AsyncStorage.getItem(cacheKey('payments', uid)));
      // `rows === null` taught us nothing, and must not become "your gym has
      // taken nothing from you".
      if (cached.rows && cached.rows.length && withinHorizon(cached.at)) {
        setRows(cached.rows);
        setCachedAt(cached.at);
      }
    } catch { /* no usable cache; the read below is the only source */ }

    // In parallel, and each landing on its own. A `for` loop here would make
    // four round trips on a gym's wifi one after another, and a single early
    // `return` on the first failure — which is what this function used to do —
    // would leave the other three at 'loading' for as long as the screen is
    // open, reported as "still reading" under a total nothing is still reading.
    const [pay, pass, sale, renew] = await Promise.all([
      fetchMyPayments(supabase, uid),
      fetchMyPasses(supabase, uid),
      fetchMyCoachSales(supabase, uid),
      fetchMyCoachRenewals(supabase, uid),
    ]);

    if (!pay.ok) {
      reportError('receipts.load', new Error(pay.reason));
      // Deliberately NOT clearing `rows`. Under 'error' whatever is on screen is
      // the last thing we knew, and the banner below says it is not confirmed
      // current — which beats replacing a member's payment history with
      // nothing at the moment the network drops.
      setStatus('error');
    } else {
      setRows(pay.value.rows);
      setStatus(pay.value.truncated ? 'partial' : 'ready');
      setCachedAt(null);
      // Only a whole read is cached. A truncated page written here would be
      // opened next launch as the member's whole payment history, and the totals
      // this screen prints are the reason that is not acceptable.
      if (!pay.value.truncated) {
        AsyncStorage.setItem(cacheKey('payments', uid), packCache(pay.value.rows))
          .catch(() => { /* the list is right this session either way */ });
      }
    }

    if (!pass.ok) { reportError('receipts.passes', new Error(pass.reason)); setPassStatus('error'); }
    else { setPasses(pass.value.rows); setPassStatus(pass.value.truncated ? 'partial' : 'ready'); }

    if (!sale.ok) { reportError('receipts.sales', new Error(sale.reason)); setSaleStatus('error'); }
    else { setSales(sale.value.rows); setSaleStatus(sale.value.truncated ? 'partial' : 'ready'); }

    if (!renew.ok) { reportError('receipts.renewals', new Error(renew.reason)); setRenewalStatus('error'); }
    else { setRenewals(renew.value.rows); setRenewalStatus(renew.value.truncated ? 'partial' : 'ready'); }
  }, [uid, auth.loading]);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(async () => { await load(); }, [load]);
  // Was four hand-written lines of RefreshControl, with its own spinner colour.
  // The shared hook is the same gesture plus the guard against a second pull
  // firing the read again while the first is still out.
  const pull = usePullToRefresh(refresh);

  // Only ever computed from a whole read of ALL FOUR. `memberPaid` applies that
  // rule; nothing on this screen may apply a looser one.
  const paid = useMemo(
    () => memberPaid(
      {
        payments: rows.map((p) => ({ amountCents: p.amountCents, currency: p.currency, takenAt: p.takenAt })),
        passes: passes.map((p) => ({ paidCents: p.paidCents, currency: p.currency, issuedOn: p.issuedOn })),
        sales: sales.map((p) => ({ amountCents: p.amountCents, currency: p.currency, status: p.status, refundedCents: p.refundedCents, createdAt: p.createdAt })),
        renewals: renewals.map((r) => ({ amountCents: r.amountCents, currency: r.currency, refundedCents: r.refundedCents, paidAt: r.paidAt, createdAt: r.createdAt })),
      },
      { payments: status, passes: passStatus, sales: saleStatus, renewals: renewalStatus },
    ),
    [rows, passes, sales, renewals, status, passStatus, saleStatus, renewalStatus],
  );

  // The gym's own book, on its own, for the section that lists it. Kept because
  // the list below it is that table and nothing else, and a per-currency
  // subtotal over the rows a reader can see is a different claim from the
  // all-sources total at the top of the screen.
  const totals = useMemo(() => (isWhole(status) ? totalsByCurrency(rows) : []), [rows, status]);
  const refunded = refundedLine(paid.refunded);
  const unstated = paid.ledger.total ? unstatedLine(paid.ledger.total) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
      >
        <PageHead title="Payments" />
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>Everything recorded as paid by you, wherever it was taken</Text>


        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not Read" title="We Couldn’t Read Your Payments"
              note={rows.length
                // When the list came off this device, say WHEN. "Not confirmed
                // current" is equally true of a copy from four minutes ago and
                // one from four days ago, and only one of those is worth
                // acting on.
                ? (cachedAtLine(cachedAt) ?? 'What is listed below is what we had before the read failed. It is not confirmed current, and there may be payments missing from it.')
                : 'This is not a record with nothing in it — it is a record we could not open. Pull down to try again, or ask your gym for a statement.'} >
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void load(); }} /></View>
            </Notice>
          </Section>
        ) : null}

        {status === 'partial' ? (
          <Section><PartialRead what="payments" shown={rows.length} onPress={() => { void load(); }} /></Section>
        ) : null}

        {/* ── the total, across every source, and only from four whole reads ── */}
        <Section>
          <SectionHead title={(paid.ledger.total?.pots.length ?? 0) > 1 ? 'Paid, by Currency' : 'Paid in Total'} />
          {paid.ledger.total && paid.ledger.total.pots.length ? (
            paid.ledger.total.pots.map((c, i) => (
              <View key={c.currency}
                style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {c.count} payment{c.count === 1 ? '' : 's'}
                </Text>
                <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{amount(c.minorUnits, c.currency)}</Text>
              </View>
            ))
          ) : (
            // One sentence, and which one depends entirely on the reads. The
            // `reason` is member-voiced on purpose — see `paidReason`.
            //
            // `paid.payments` is passed because four whole reads with no pots
            // is TWO different facts: nothing recorded, or rows recorded that
            // state no amount or no currency. Without the count the second one
            // printed "Nothing has been recorded against your account" an inch
            // above the flag saying three payments were missing from the
            // figure. See `paidEmptyLine`.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {paid.ledger.reason ?? paidEmptyLine(paid.ledger.status, paid.payments)}
            </Text>
          )}
          {(paid.ledger.total?.pots.length ?? 0) > 1 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Shown separately because they are different currencies. There is no single figure that adds them up.
            </Text>
          ) : null}
          {refunded ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{refunded}</Text> : null}
          {/* A `Flag` rather than tinted text: the tone is a mark beside the
              sentence and the sentence itself stays ink, which is the only way
              it clears contrast at every theme (src/lib/a11y.ts). */}
          {unstated ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{unstated}</Flag> : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PAID_IS_EVERY_SOURCE}</Text>
        </Section>


        {/* ── where it came from ──────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Where It Came From" />
          <SourceLine t={t} first label="Paid at Your Gym" taken={paid.gym} status={status} />
          <SourceLine t={t} label="Passes and Drop-ins" taken={paid.passes} status={passStatus} />
          <SourceLine t={t} label="Bought from a Trainer" taken={paid.sales} status={saleStatus} />
          <SourceLine t={t} label="Coaching Renewals" taken={paid.renewals} status={renewalStatus} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PAID_EXCLUDES_CASH}</Text>
        </Section>


        {/* ── what the gym says you owe, which is a different question ─────── */}
        <Section>
          <SectionHead title="What You Have Been Billed" />
          <Text style={{ ...ty.label, color: t.ink3 }}>
            This page is money that has already moved. What your gym has invoiced you for — including anything still outstanding — is its own record.
          </Text>
          <View style={{ marginTop: sp.md }}>
            <Ghost label="Invoices from Your Gym" onPress={() => router.push('/(client)/invoices')} />
          </View>
        </Section>


        {/* ── the gym's own book ──────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Paid at Your Gym" note={isWhole(status) && rows.length ? `${rows.length}` : undefined} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your payments…</Text>
          ) : rows.length === 0 ? (
            // Said ONLY under a whole read. Under 'error' the banner above has
            // the page and this sentence never appears.
            isWhole(status) ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Your gym has not recorded any payments against your account. If you have paid — at the desk, by card, by transfer — it has not been entered here, and reception can add it.
              </Text>
            ) : null
          ) : (
            rows.map((p, i) => (
              <View key={p.id}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{paidOn(p.takenAt)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{methodLabel(p.method)}</Text>
                </View>
                {/* The row's own currency, never a screen-level symbol. */}
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{amount(p.amountCents, p.currency)}</Text>
              </View>
            ))
          )}
          {totals.length > 1 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Your gym has taken {totals.length} different currencies from you, listed on each row above.
            </Text>
          ) : null}
        </Section>


        {/* ── passes ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Passes and Drop-Ins" note={isWhole(passStatus) && passes.length ? `${passes.length}` : undefined} />
          {passStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your passes…</Text>
          ) : passStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              We couldn’t read your passes, so none are listed. That is our end, not a statement that you have never bought one.
            </Text>
          ) : passes.length === 0 ? (
            isWhole(passStatus) ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                No day passes, guest passes or class packs are recorded against your account. One bought at the desk before you had an account is written against a name rather than against you, and will not appear here.
              </Text>
            ) : null
          ) : (
            passes.map((p, i) => (
              <View key={p.id}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{dayOn(p.issuedOn)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {passUsesLine(p)}{p.expiresOn ? ` · expires ${dayOn(p.expiresOn)}` : ''}
                  </Text>
                </View>
                {/* A pass with no price recorded is not a free pass, and a dash
                    is the only honest thing to put where the figure goes. */}
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: p.paidCents == null ? t.ink3 : t.ink }}>
                  {p.paidCents == null ? fig(null) : amount(p.paidCents, p.currency)}
                </Text>
              </View>
            ))
          )}
          {isWhole(passStatus) && passes.some((p) => p.paidCents == null) ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              A dash means your gym did not record what was paid for that pass. It does not mean the pass was free, and nothing with a dash on it is in any total on this screen.
            </Text>
          ) : null}
        </Section>


        {/* ── what a trainer sold you, through Repple ─────────────────────── */}
        <Section>
          <SectionHead title="Bought from a Trainer" note={isWhole(saleStatus) && sales.length ? `${sales.length}` : undefined} />
          {saleStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your purchases…</Text>
          ) : saleStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              We couldn’t read what you have bought from a trainer. That is our end, not a statement that you have bought nothing.
            </Text>
          ) : sales.length === 0 ? (
            isWhole(saleStatus) ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Nothing has been bought from a personal trainer through the app on this account.
              </Text>
            ) : null
          ) : (
            sales.map((p, i) => (
              <View key={p.id}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{paidOn(p.createdAt)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{saleLabel(p)}</Text>
                </View>
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{amount(p.amountCents, p.currency)}</Text>
              </View>
            ))
          )}
        </Section>


        {/* ── coaching renewals ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaching Renewals" note={isWhole(renewalStatus) && renewals.length ? `${renewals.length}` : undefined} />
          {renewalStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your renewals…</Text>
          ) : renewalStatus === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              We couldn’t read your coaching renewals. That is our end, not a statement that none were taken.
            </Text>
          ) : renewals.length === 0 ? (
            isWhole(renewalStatus) ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                No coaching subscription has renewed on this account.
              </Text>
            ) : null
          ) : (
            renewals.map((r, i) => (
              <View key={r.id}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  {/* The date the money moved. A renewal whose date the payment
                      processor never stated shows a dash rather than the day a
                      webhook happened to write the row. */}
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.paidAt ? paidOn(r.paidAt) : fig(null)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Coaching subscription</Text>
                </View>
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{amount(r.amountCents, r.currency)}</Text>
              </View>
            ))
          )}
        </Section>


        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            The figures here are what you were charged. What is left on a pack you bought, and what you are subscribed to, are under Memberships & Packs.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
