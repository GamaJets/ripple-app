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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { useAuth } from '../../src/ui/auth';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { amount, fetchMyPayments, methodLabel, totalsByCurrency, type MemberPayment } from '../../src/lib/memberRecord';

/** A timestamptz as the day it happened, in the reader's own zone. A payment
 *  carries an instant, not a calendar date, so this one is parsed normally. */
function paidOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Receipts() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const uid = auth.user?.id || '';

  const [rows, setRows] = useState<MemberPayment[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    if (!uid) { if (!auth.loading) setStatus('error'); return; }
    const res = await fetchMyPayments(supabase, uid);
    if (!res.ok) {
      reportError('receipts.load', new Error(res.reason));
      // Deliberately NOT clearing `rows`. Under 'error' whatever is on screen is
      // the last thing we knew, and the banner below says it is not confirmed
      // current — which beats replacing a member's payment history with
      // nothing at the moment the network drops.
      setStatus('error');
      return;
    }
    setRows(res.value.rows);
    setStatus(res.value.truncated ? 'partial' : 'ready');
  }, [uid, auth.loading]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };

  // Only ever computed from a whole read. 'partial' is excluded here for the
  // same reason 'error' is: the rows are real, the total over them is not.
  const totals = useMemo(() => (status === 'ready' ? totalsByCurrency(rows) : []), [rows, status]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={t.ink3} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Membership</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Payments</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>What your gym has recorded taking from you</Text>

        <Rule />

        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not read" title="We couldn’t read your payments"
              note={rows.length
                ? 'What is listed below is what we had before the read failed. It is not confirmed current, and there may be payments missing from it.'
                : 'This is not a record with nothing in it — it is a record we could not open. Pull down to try again, or ask your gym for a statement.'} >
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void load(); }} /></View>
            </Notice>
          </Section>
        ) : null}

        {status === 'partial' ? (
          <Section><PartialRead what="payments" shown={rows.length} onPress={() => { void load(); }} /></Section>
        ) : null}

        {/* ── the totals, per currency, and only from a whole read ────────── */}
        {status === 'ready' && totals.length ? (
          <Section>
            <SectionHead title={totals.length > 1 ? 'Paid, by currency' : 'Paid in total'} />
            {totals.map((c, i) => (
              <View key={c.currency ?? 'none'}
                style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {c.count} payment{c.count === 1 ? '' : 's'}{c.currency ? '' : ' with no currency recorded'}
                </Text>
                <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{amount(c.cents, c.currency)}</Text>
              </View>
            ))}
            {totals.length > 1 ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Shown separately because they are different currencies. There is no single figure that adds them up.
              </Text>
            ) : null}
          </Section>
        ) : null}

        {status === 'ready' && totals.length ? <Rule /> : null}

        {/* ── the list ────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Every Payment" note={status === 'ready' && rows.length ? `${rows.length}` : undefined} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your payments…</Text>
          ) : rows.length === 0 ? (
            // Said ONLY under 'ready'. Under 'error' the banner above has the
            // page and this sentence never appears.
            status === 'ready' ? (
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
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            This is your gym’s own record of what it took. It does not include anything you bought from a personal trainer through the app — those are under Memberships & Packs.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
