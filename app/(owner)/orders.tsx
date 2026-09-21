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
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Flag, fig, PageHead, Donut, Legend, TonedChip, type Slice } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, font } from '../../src/theme/scale';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { fmtDay } from '../../src/lib/format';
import { money } from '../../src/lib/gymRecord';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { readState, hasRows, staleNote, failedNote } from '../../src/lib/staleRead';
import {
  fetchGymOrders, orderLine, orderTrouble, paidPots, unspellablePaid,
  ORDER_STATUS_LABEL, type GymOrderRow, type UnspellablePaid,
} from '../../src/lib/gymOrders';

/** How far back the order book is read. Ninety days is a quarter — long enough
 *  to cover a Stripe payout cycle and every dispute window an owner is likely
 *  to be asked about, and a bound rather than a cap: `fetchGymOrders` PAGES,
 *  so a busy quarter is finished rather than refused. */
const WINDOW_DAYS = 90;

/**
 * The paid orders no pot could hold, said as three facts with three fixes.
 *
 * Word for word the same builder as studio-web/app/orders/page.tsx. It is a
 * deliberate copy and not a shared export, because src/lib/gymOrders.ts is the
 * pure counter and this is one screen's wording — but the two screens are one
 * fact about one gym, so the two copies say the same thing in the same order
 * and change together.
 *
 * `unspellablePaid` splits the exclusion by fault precisely so a screen does
 * not flatten it back into one number, and this is the sentence that keeps it
 * split. An order with no currency recorded, one whose currency is not a code
 * this app can name, and one whose amount cannot be read are three different
 * things that went wrong in three different places, and an owner told only
 * "4 excluded" has been handed a number and no next step.
 *
 * Each arm carries where the value came from, which is what makes it a fix:
 *
 *   · unstated — supabase/functions/gym-checkout refuses the sale outright when
 *     the plan or pass type states no currency, and the Stripe webhook never
 *     writes the column, only reads it. So an EMPTY currency cannot have come
 *     from a checkout this product ran; it was imported or entered by hand.
 *   · notACode — gym-checkout copies `membership_plans.currency` /
 *     `gym_pass_types.currency` onto the order when the session is created, and
 *     neither column has a format check. `'pounds'` in the price book is
 *     `'POUNDS'` on every order sold from it, so the price book is where it
 *     stops — and rewriting the order would be rewriting the quote.
 *   · notAnAmount — the amount is ours and unreadable; Stripe's own record of
 *     the charge is the one that still says what was taken.
 *
 * The counts are COUNTS. Nothing here adds them to anything, including to each
 * other's money.
 */
function unspellableReasons(u: UnspellablePaid): string {
  const parts: string[] = [];
  if (u.unstated > 0) {
    parts.push(`${u.unstated} ${u.unstated === 1 ? 'records' : 'record'} no currency at all, which no checkout `
      + `this product runs can produce (those were imported or entered by hand)`);
  }
  if (u.notACode > 0) {
    parts.push(`${u.notACode} ${u.notACode === 1 ? 'names' : 'name'} something that is not a three-letter `
      + `currency code, such as “pounds”. That spelling is copied from the plan or pass type at checkout, `
      + `so it is the price book that fixes it`);
  }
  if (u.notAnAmount > 0) {
    parts.push(`${u.notAnAmount} ${u.notAnAmount === 1 ? 'carries' : 'carry'} an amount that cannot be read `
      + `as a number, so Stripe’s record of the charge is the only one that still states it`);
  }
  return parts.join('; ');
}

export default function OwnerOrders() {
  const t = useTheme();
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
  // The paid orders `paidPots` could not put in any pot. A COUNT, split by
  // fault — never a sum, and never subtracted from a pot.
  const unspellable = unspellablePaid(list);

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
        <PageHead title="Online Orders" />

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
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>{staleNote('order book', reason)}</Flag>
        ) : null}

        {/* The figure is the count of orders that need a person, and not the
            money. A gym reading "GBP 4,300 taken" over three members who paid
            and got nothing has been told the comfortable half of the fact.

            A card rather than the kit's bare `Hero`, which is the one block on
            this screen the board does not draw. The Hero's tone was a dot
            beside the note; it still is, and it is the alarm colour only when
            somebody paid and got nothing. */}
        {(() => {
          const figure = fig(loaded ? needsAPerson : null);
          const note = state === 'failed'
            // The most important sentence on the screen: the figure is a count
            // of members who paid and got nothing, and a dash over it must
            // never be read as a zero.
            ? `${failedNote('order book', reason)} This is NOT an all-clear.`
            : state === 'loading'
            ? 'Reading your online orders…'
            : list.length === 0
            ? `Nothing has been bought online in ${WINDOW_DAYS} days. If that is a surprise, check that card payments are switched on in Operations.`
            : needsAPerson === 0
            ? `${list.length} order${list.length === 1 ? '' : 's'} in ${WINDOW_DAYS} days, and every paid one produced what it was for.`
            : `${needsAPerson} member${needsAPerson === 1 ? '' : 's'} paid and did not get what they bought.`;
          // The book by state, as the ring the figure sits in. The four are a
          // partition — see the long note that used to head the "By State"
          // tiles, kept below — so the ring is the whole book and the red
          // slice IS the figure in its centre. Nothing is drawn until the read
          // is in hand: an unread book is a track and a dash, never four
          // noughts.
          const slices: Slice[] = loaded ? [
            { label: 'Paid and Granted', tone: 'brand', value: list.filter((o) => o.status === 'paid').length - trouble.paidWithNothing.length },
            { label: 'Awaiting Payment', tone: 'blue', value: list.filter((o) => o.status === 'pending').length },
            { label: 'Abandoned', tone: 'neutral', value: list.filter((o) => o.status === 'abandoned').length },
            { label: 'Not Granted', tone: 'red', value: needsAPerson },
          ].map((x) => ({ ...x, shown: String(x.value) } as Slice)) : [];
          return (
            <Section>
              <SectionHead title="Need Attention" note={loaded ? `${list.length} in ${WINDOW_DAYS} Days` : undefined} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.lg }}>
                <Donut slices={slices} centre={loaded ? String(needsAPerson) : null} sub="need you" size={120}
                  spoken={`Need attention, ${figure === '—' ? 'no figure' : figure}, ${note}`} />
                <View style={{ flex: 1, minWidth: 140, gap: sp.sm }}>
                  {/* The alarm colour only when somebody paid and got nothing,
                      and always with its word. */}
                  {loaded ? <TonedChip label={needsAPerson > 0 ? 'Needs You' : 'All Granted'} tone={needsAPerson > 0 ? 'red' : 'brand'} icon={needsAPerson > 0 ? 'info' : 'check'} /> : null}
                  <Text style={{ ...ty.label, color: t.ink2 }}>{note}</Text>
                </View>
              </View>
              {loaded && list.length > 0 ? (
                <View style={{ marginTop: sp.lg }}><Legend items={slices} /></View>
              ) : null}
              {loaded && needsAPerson > 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Not granted: {trouble.failed.length} recorded, {trouble.paidWithNothing.length} silent.
                </Text>
              ) : null}
            </Section>
          );
        })()}

        <Fetched at={fetchedAt} onRefresh={() => { void load(); }} busy={busy} />

        {/* Said above the money, because it is more urgent than the money. */}
        {loaded && needsAPerson > 0 ? (
          <Flag tone={t.crit}>
            Stripe took this money and the membership or pass was never written. Nothing on this
            screen can grant it (every write to the order book is made by the checkout and
            webhook functions, never by an app), so open Stripe, confirm the charge, and add the
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

        {/* ── the paid orders Taken Online could not hold ───────────────────
            Word for word what studio-web/app/orders/page.tsx says, from the
            same counter, in the same place in the same stack. One gym, one
            fact; a console that disagrees with the phone is worse than either.

            Before this, neither screen said anything at all in the case that
            matters most: `paidPots` drops a paid order whose currency is not a
            code and whose amount is not a number, and a gym with one good GBP
            pot and four rows written 'pounds' read one line under Taken Online
            and no mention of the four. A withheld total presented as a complete
            one.

            `warn` and not `crit`. Nobody is owed anything: supabase/parts/281
            defines 'paid' as "checkout.session.completed arrived and the
            entitlement below was written", so the money arrived AND the member
            got what they bought. `crit` on this screen means a member who paid
            and got nothing — the opposite fact — and spending it on a
            bookkeeping gap is how it stops being read.

            Never netted off the lines below, never called missing money. The
            only honest figure over rows in moneys that cannot be named is how
            many there are. */}
        {loaded && unspellable.orders > 0 ? (
          <Flag tone={t.warn}>
            {unspellable.orders} paid {unspellable.orders === 1 ? 'order is' : 'orders are'} not in
            any figure on this screen. The money arrived and the{' '}
            {unspellable.orders === 1 ? 'member has' : 'members have'} what they bought. What
            cannot be done is add {unspellable.orders === 1 ? 'it' : 'them'} up:{' '}
            {unspellableReasons(unspellable)}. So this is a count and never a total: an amount in a
            money this app cannot name cannot be added to another one, or to a figure that names its
            own. {unspellable.orders === 1 ? 'It is' : 'All of them are'} still in the order book,
            marked Paid. Nothing on this screen rewrites an order. Every write to the order book is
            made by the checkout and webhook functions.
          </Flag>
        ) : null}


        {/* ── what was taken ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Taken Online" note={`Last ${WINDOW_DAYS} Days`} />
          {!loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {state === 'failed'
                ? 'Not known. The order book could not be read. This is not a quarter in which nothing sold.'
                : 'Reading…'}
            </Text>
          ) : pots.length === 0 ? (
            // ── an empty set of pots is three different facts ──────────────
            // This was one sentence — "Nothing has been paid for online in this
            // window" — and `paidPots` has an exit it did not describe: it
            // drops a paid order whose currency is not a code this app can
            // name, and one whose amount is not a finite number, because
            // neither can be added to money. `gym_orders.currency` is
            // `not null` with no format check of any kind (supabase/parts/281),
            // so an imported or hand-written row satisfies the column and still
            // says nothing an amount can be spelled in.
            //
            // So a gym whose online takings were ALL filed without a usable
            // currency read "nothing has been paid for online" over a book of
            // paid orders. That is the defect this screen exists against
            // wearing a figure's clothes: a withheld total presented as a nil.
            // studio-web/app/orders/page.tsx says the same three arms under its
            // own empty tile; the flag above carries the detail on both.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {list.length === 0
                ? `No online orders at all in the last ${WINDOW_DAYS} days.`
                : unspellable.orders === 0
                ? 'Nothing has been paid for online in this window.'
                : `${unspellable.orders} paid order${unspellable.orders === 1 ? '' : 's'} in this window, and not `
                  + `one states both an amount and the currency it was taken in, so there is no figure to `
                  + 'write here. They are counted above, never guessed at.'}
              {' '}That is not the same as no income. Payments taken at the desk are on Members.
            </Text>
          ) : pots.map((p) => (
            // One line per currency. They are never added: a gym that changed
            // its currency has two moneys in this list and a total over them
            // would be a bigger number rather than a sum.
            <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.md, marginBottom: sp.sm }}>
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {p.count} order{p.count === 1 ? '' : 's'} in {p.currency}
              </Text>
              <Text style={{ ...ty.body, ...numeric, ...font('600'), color: t.ink }}>
                {money(p.cents, p.currency)}
              </Text>
            </View>
          ))}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Paid orders only. Money Stripe took but the gym never granted is under Need Attention, not here.
          </Text>
        </Section>


        {/* ── four tiles that add up to the book ──────────────────────────
            The Paid tile was `status === 'paid'` and the Not Granted tile is
            `failed + paidWithNothing`, and `paidWithNothing` is a subset of
            the first: a row marked paid with neither a membership nor a pass
            behind it was counted in BOTH. So a gym with 45 orders read
            40 + 2 + 3 + 2 and could add the row of tiles to 47 — under a
            heading reading "By State", beside a section head reading
            "Orders · 45".

            Which of the two tiles was wrong is not a matter of taste. Part 281
            defines 'paid' as "checkout.session.completed arrived AND the
            entitlement below was written", so a paid row with nothing behind
            it does not meet the column's own definition and is not one of the
            gym's completed sales. It belongs to Not Granted alone, and Paid is
            now the orders that produced what they were for. The four are then
            a partition of the book, which is what a row of tiles under this
            heading claims to be.

            Drawn as the ring in the figure card at the top now, from the same
            four counts; this note stays where the argument was made. */}


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
                <Text style={{ ...ty.label, ...font('600'), color: t.ink2 }}>Try Again</Text>
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
                  <Text style={{ ...ty.body, ...font('500'), color: t.ink, flex: 1 }} numberOfLines={1}>
                    {o.memberName ?? 'Name Not Readable'}
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
