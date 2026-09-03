// Owner · Online orders. What members bought from the gym's own Stripe
// account, and the ones that need a person.
//
// ── Why this screen did not exist ─────────────────────────────────────────
//
// `gym_orders` shipped with supabase/parts/281. It is written by
// supabase/functions/gym-checkout and updated by the Stripe webhook, and the
// only reader anywhere in the product was `fetchMyGymOrders` in
// src/lib/memberBuy.ts — scoped to `member_id = auth.uid()`, the BUYER.
//
// So the gym took card money through an account it owns and had no order list.
// No way to see what sold, no way to find a member's receipt, no line to
// reconcile against the Stripe payout, and no answer at the desk to the
// question a member actually asks: did my payment go through?
//
// ── Nothing here needed a policy ──────────────────────────────────────────
//
// `gym_orders_owner_r` — `for select using (is_owner_of(tenant_id))` — has been
// on the table since part 281. The rows were readable the whole time and nobody
// was reading them. This screen changes no policy and asks for none.
//
// ── The state this screen exists for ──────────────────────────────────────
//
// Part 281 on 'failed': "Stripe took the money and the entitlement could not be
// written. A state that must exist so it can be found and fixed by hand, rather
// than a paid member with nothing to show for it and nothing anywhere recording
// that we know."
//
// It was recorded. Nothing looked at it. That row is now the first thing on
// this screen, above the money, because a member who paid and got nothing is
// more urgent than a total.
//
// ── No total across currencies ────────────────────────────────────────────
//
// A white-label gym that changed its currency has both in its order book, and
// one figure over the two is not a bigger number — it is not a number. Taken is
// stated per currency, one line each, however many there are.
//
// ── Read-only, and it says so ─────────────────────────────────────────────
//
// There is no INSERT, UPDATE or DELETE policy on `gym_orders` for anybody: every
// write is made by the service role from the two edge functions. A button here
// that appeared to grant a failed order would be a button that silently did
// nothing, so the screen tells the owner what to do instead of pretending it
// can do it.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Flag, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { fmtDay } from '../../src/lib/format';
import { money } from '../../src/lib/gymRecord';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { readState, hasRows, staleNote, failedNote } from '../../src/lib/staleRead';
import {
  fetchGymOrders, orderLine, orderTrouble, paidPots,
  ORDER_STATUS_LABEL, type GymOrderRow,
} from '../../src/lib/gymOrders';
import { FORWARD_ICON } from '../../src/ui/direction';

/** How far back the order book is read. Ninety days is a quarter — long enough
 *  to cover a Stripe payout cycle and every dispute window an owner is likely
 *  to be asked about, and a bound rather than a cap: `fetchGymOrders` PAGES,
 *  so a busy quarter is finished rather than refused. */
const WINDOW_DAYS = 90;

export default function OwnerOrders() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  /**
   * Null is "nothing has ever landed here".
   *
   * NOT `[]`. An empty array renders as "this gym has sold nothing online" — a
   * specific claim about somebody's business, in the screen's own confident
   * type, arrived at by a query that failed.
   *
   * And it is not set back to null by a refresh that fails, which is what it
   * used to do. See the catch below and src/lib/staleRead.ts.
   */
  const [rows, setRows] = useState<GymOrderRow[] | null>(null);
  /** Whether the most recent ATTEMPT failed. Orthogonal to `rows`: the pair is
   *  what `readState` turns into the four things that can be true here. */
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
      const r = await fetchGymOrders(supabase as any, tenantId, since);
      setRows(r);
      setFailed(false);
      setReason(null);
      setFetchedAt(Date.now());
    } catch (e: any) {
      reportError('ownerOrders.fetch', e);
      // The rows that landed are KEPT. `setRows(null)` was here, and it was the
      // right answer while this screen read once on mount — there was nothing
      // to lose. Pull-to-refresh made failure-after-success an ordinary path,
      // and a refresh fails for reasons that say nothing about the order book:
      // an owner in the back office pulls down, the signal drops for a second,
      // and a correct quarter of orders — including the ones flagged as paid
      // with nothing granted, which is why this screen exists — disappears.
      //
      // What is lost instead is the CLAIM that they are current, which is
      // `readState`'s 'stale' and is said once, at the top.
      setFailed(true);
      // The message is carried through because `readAll` throws a named
      // TruncatedRead whose text is written to be read by a gym owner, and
      // replacing it with "something went wrong" would throw away the one
      // sentence that says which thing went wrong.
      setReason(e?.message ?? null);
    } finally {
      setBusy(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // The order book is the one read on this screen; the hero, the KPIs and the
  // trouble list are all derived from it.
  const pull = usePullToRefresh(load);

  // Two facts, four states: src/lib/staleRead.ts. `loaded` was `rows !== null`
  // and carried both.
  const state = readState(rows, failed);
  const loaded = hasRows(state);
  const list = rows ?? [];
  const trouble = orderTrouble(list);
  const needsAPerson = trouble.failed.length + trouble.paidWithNothing.length;
  const pots = paidPots(list);

  const shown = (() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((o) =>
      (o.memberName ?? '').toLowerCase().includes(needle)
      || o.id.toLowerCase().includes(needle));
  })();

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={pull}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name={FORWARD_ICON} size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Online Orders</Text>
        </View>

        <Fetched at={fetchedAt} onRefresh={() => { void load(); }} busy={busy}
          style={{ marginTop: 0, marginBottom: sp.md }} />

        {/* Said once, for the whole screen: the hero, the per-currency pots,
            the four KPIs and the book are all derived from this one read, so
            three copies of "not confirmed current" would be three sentences to
            keep in step rather than one fact.

            `warn` and not `crit`. The orders below are real and the read that
            produced them was whole; the failure is in the attempt to confirm
            them. `crit` on this screen already means something specific and
            worse — a member who paid and got nothing — and spending it on a
            dropped connection is how it stops being read. */}
        {state === 'stale' ? (
          <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{staleNote('order book', reason)}</Flag>
        ) : null}

        {/* The hero is the count of orders that need a person, and not the
            money. A gym reading "GBP 4,300 taken" over three members who paid
            and got nothing has been told the comfortable half of the fact. */}
        <Hero
          label="Need Attention"
          figure={fig(loaded ? needsAPerson : null)}
          tone={needsAPerson > 0 ? t.crit : undefined}
          note={state === 'failed'
            // The most important sentence on the screen: the hero figure is a
            // count of members who paid and got nothing, and a dash over it must
            // never be read as a zero.
            ? `${failedNote('order book', reason)} This is NOT an all-clear.`
            : state === 'loading'
            ? 'Reading your online orders…'
            : list.length === 0
            ? `Nothing has been bought online in ${WINDOW_DAYS} days. If that is a surprise, check that card payments are switched on in Operations.`
            : needsAPerson === 0
            ? `${list.length} order${list.length === 1 ? '' : 's'} in ${WINDOW_DAYS} days, and every paid one produced what it was for.`
            : `${needsAPerson} member${needsAPerson === 1 ? '' : 's'} paid and did not get what they bought.`}
        />

        {/* Said above the money, because it is more urgent than the money. */}
        {loaded && needsAPerson > 0 ? (
          <Flag tone={t.crit}>
            Stripe took this money and the membership or pass was never written. Nothing on this
            screen can grant it — every write to the order book is made by the checkout and
            webhook functions, never by an app — so open Stripe, confirm the charge, and add the
            membership or pass by hand on Members.
          </Flag>
        ) : null}
        {loaded && trouble.stuck.length > 0 ? (
          <Flag tone={t.warn}>
            {trouble.stuck.length} order{trouble.stuck.length === 1 ? ' has' : 's have'} been waiting
            for payment far longer than a Stripe checkout stays open. Stripe closes an unpaid session
            within a day, so these are orders our webhook was never told about rather than members
            still deciding.
          </Flag>
        ) : null}

        <Rule />

        {/* ── what was taken ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Taken Online" note={`Last ${WINDOW_DAYS} days`} />
          {!loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {state === 'failed'
                ? 'Not known — the order book could not be read. This is not a quarter in which nothing sold.'
                : 'Reading…'}
            </Text>
          ) : pots.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing has been paid for online in this window. That is not the same as no income —
              payments taken at the desk are on Members.
            </Text>
          ) : pots.map((p) => (
            // One line per currency. They are never added: a gym that changed
            // its currency has two moneys in this list and a total over them
            // would be a bigger number rather than a sum.
            <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.md, marginBottom: sp.sm }}>
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {p.count} order{p.count === 1 ? '' : 's'} in {p.currency}
              </Text>
              <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>
                {money(p.cents, p.currency)}
              </Text>
            </View>
          ))}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Paid orders only. Money that Stripe took but the gym never granted is counted above,
            under Need Attention, rather than in this total — putting it in here is how it stops
            being visible as something to fix.
          </Text>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="By State" />
          <KpiRow items={[
            { label: 'Paid', value: fig(loaded ? list.filter((o) => o.status === 'paid').length : null) },
            { label: 'Awaiting', value: fig(loaded ? list.filter((o) => o.status === 'pending').length : null) },
            { label: 'Abandoned', value: fig(loaded ? list.filter((o) => o.status === 'abandoned').length : null) },
            { label: 'Not Granted', value: fig(loaded ? needsAPerson : null) },
          ]} />
        </Section>

        <Rule />

        {/* ── the book ───────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title={loaded && list.length ? `Orders · ${list.length}` : 'Orders'} />

          {loaded && list.length > 0 ? (
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search by member or order id"
              placeholderTextColor={t.ink3}
              autoCapitalize="none"
              accessibilityLabel="Search orders"
              style={{
                ...ty.body, color: t.ink, backgroundColor: t.surface2,
                borderRadius: 8, paddingHorizontal: sp.lg, paddingVertical: 10, marginBottom: sp.md,
              }}
            />
          ) : null}

          {/* 'failed', not `failed`: a refresh that failed over orders that did
              land is 'stale' and keeps the book below. The old wording — "this
              screen simply does not know what sold" — was written for a screen
              holding nothing, and is false of one holding a complete earlier
              read. */}
          {state === 'failed' ? (
            <View>
              <Flag tone={t.crit}>
                {failedNote('order book', reason)} This screen does not know what sold, which is
                not the same as nothing having sold.
              </Flag>
              <Pressable
                onPress={() => { void load(); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Try reading the order book again"
                style={{ alignSelf: 'flex-start', marginTop: sp.md, backgroundColor: t.surface2, borderRadius: 8, paddingHorizontal: sp.lg, paddingVertical: 7 }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try Again</Text>
              </Pressable>
            </View>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading…</Text>
          ) : list.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No online orders in the last {WINDOW_DAYS} days.
            </Text>
          ) : shown.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Nothing matches “{q.trim()}”.</Text>
          ) : shown.map((o, i) => {
            // A row that needs a person is marked with a dot, never with
            // coloured text — src/theme/scale.ts reserves the status colours
            // for marks and t.crit fails AA as 12pt ink on every palette.
            const bad = o.status === 'failed' || (o.status === 'paid' && o.membershipId == null && o.passId == null);
            return (
              <View key={o.id} style={{
                paddingVertical: sp.md,
                borderTopWidth: i === 0 ? 0 : hairline,
                borderTopColor: t.ring,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  {bad ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }} numberOfLines={1}>
                    {o.memberName ?? 'Name not readable'}
                  </Text>
                  <Text style={{ ...ty.body, ...numeric, color: t.ink }}>
                    {/* `money` returns null without a currency and React draws
                        null as nothing, which reads as a broken row rather than
                        as a record with a gap. The dash says which. */}
                    {money(o.amountCents, o.currency) ?? '—'}
                  </Text>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                  {orderLine(o)} · {ORDER_STATUS_LABEL[o.status]} · {fmtDay(o.createdAt)}
                </Text>
              </View>
            );
          })}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
