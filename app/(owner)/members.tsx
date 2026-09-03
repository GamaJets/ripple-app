// Owner · Members. The desk work: who is on what, freeze and cancel, and take
// a payment.
//
// Every table this touches shipped with 29-gym-operating-record.sql and every
// rule lives in src/lib/gymRecord.ts. Until now there was no surface over any
// of it, so a gym could hold memberships it could not administer.
//
// One deliberate limit, stated plainly on the screen rather than hidden: this
// opens a membership for someone who already has a Repple account. It cannot
// create an account for a walk-in who has never used the app — memberships
// reference profiles, and making a profile means making an auth user, which is
// an invite flow (see 11-coach-invites.sql for the shape) rather than an insert.
// Pretending otherwise would mean writing a member row that points at nobody.
//
// MRR is read from the library, which returns null when no active membership
// sits on a priced plan. A gym with unpriced plans has an unknown recurring
// revenue, which is not the same as zero, so the screen prints a dash.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { isoDate } from '../../src/lib/format';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { readState, hasRows, canSayEmpty, staleNote, failedNote } from '../../src/lib/staleRead';
import {
  fetchPlans, fetchMemberships, fetchPayments, createMembership,
  setMembershipStatus, recordPayment, summarise, money,
  type Membership, type MembershipPlan, type GymPayment, type MembershipStatus, type PaymentMethod,
} from '../../src/lib/gymRecord';
import { FORWARD_ICON } from '../../src/ui/direction';

/**
 * Today, on the CALENDAR THE PERSON IS STANDING IN.
 *
 * This was `new Date().toISOString().slice(0, 10)`, which is the UTC day. A
 * membership opened at 5pm in Los Angeles was filed as starting TOMORROW — so
 * the billing anniversary is a day out, the member is counted in the wrong
 * month's joiners, and a gym east of Greenwich gets the same error in the other
 * direction before 8am.
 *
 * `isoDate` reads the local calendar and writes the `YYYY-MM-DD` the column
 * holds. It is the same helper /accounting already uses and it is deliberately
 * not localised — this is a storage key, not a sentence.
 *
 * The wider question — that "local" here means the phone's timezone and not the
 * GYM's, because `tenants` has no timezone column at all — is a separate item
 * and a schema change. This is strictly the half that is wrong for everybody
 * outside UTC, including an owner standing in their own gym.
 */
const today = () => isoDate(new Date());

const STATUS_TONE = (t: Theme, s: MembershipStatus) =>
  s === 'active' ? t.brand : s === 'frozen' ? t.s3 : t.ink3;

const STATUS_LABEL: Record<MembershipStatus, string> = {
  active: 'Active', frozen: 'Frozen', cancelled: 'Cancelled', expired: 'Expired',
};

/** How far back the payments read goes. The figure it feeds is a desk count,
 *  not a ledger — /accounting and the console's own screens are where a gym's
 *  full payment history is read, and both of them page rather than cap. */
const PAYMENTS_WINDOW_DAYS = 30;

const METHODS: PaymentMethod[] = ['card', 'cash', 'transfer', 'direct_debit', 'other'];
const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'Card', cash: 'Cash', transfer: 'Transfer', direct_debit: 'Direct debit', other: 'Other',
};

interface Candidate { id: string; name: string }

export default function OwnerMembers() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();
  // The gym's own currency, and NOTHING when it has not set one.
  //
  // This was `tenant?.currency || GYM_CURRENCY`, and the fallback was the last
  // path in the owner app that wrote a guessed currency to disk: the payment
  // form below sends `cur` straight into `recordPayment`, so a gym that had
  // never chosen one had its takings stored as dirhams — permanently, and read
  // back as its own answer by the accounting and month-end screens that
  // reconcile against a bank statement. A fallback is defensible for something
  // being DISPLAYED and never for something being RECORDED, and this one value
  // was doing both.
  //
  // Part 99 made `tenants.currency` nullable on purpose: NULL means the gym has
  // not told us. So null here, a dash on the figures, and the payment form
  // refuses rather than guesses. Ops has the control that sets it.
  const cur = tenant?.currency ?? null;

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [rows, setRows] = useState<Membership[] | null>(null);
  const [payments, setPayments] = useState<GymPayment[]>([]);
  // The most recent ATTEMPT failed. Not "there is nothing" — `rows` says that,
  // separately, and the two together are what `readState` turns into the four
  // things that can be true here. See src/lib/staleRead.ts.
  const [failed, setFailed] = useState(false);
  /** Why the last attempt failed, where the read gave a sentence worth showing
   *  — `fetchMemberships` throws a TruncatedRead whose text is written to be
   *  read by a gym owner. */
  const [reason, setReason] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  // add-a-membership sheet
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);   // the lookup errored, ≠ no matches
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);

  // take-a-payment sheet
  const [payFor, setPayFor] = useState<Membership | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');

  /** When the three reads last LANDED, and whether one is in flight. Not moved
   *  by a refresh that failed: the rows on screen are still the earlier read's. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setReloading(true);
    try {
      /**
       * ── The payments read is BOUNDED now ──────────────────────────────
       *
       * It was `fetchPayments(supabase, tenant.id)` — every payment the gym
       * has ever taken — inside a `Promise.all` whose catch runs
       * `setRows(null); setFailed(true)`. src/lib/gymRecord.ts caps that read
       * at a thousand rows and throws past it, and a 600-member gym crosses a
       * thousand payments in under two months. After that, an owner standing
       * at the desk could not freeze or cancel anybody, because the MEMBERSHIP
       * list was blanked by an unrelated five-year payments read being too big.
       *
       * Thirty days, and the KPI beside it says thirty days. The old label was
       * "Payments Logged" over a lifetime count, and swapping the window
       * underneath a label that does not say so would trade a dead screen for
       * a quietly wrong figure — which is the worse of the two.
       */
      const since = new Date(Date.now() - PAYMENTS_WINDOW_DAYS * 86400000).toISOString();
      const [p, m, pay] = await Promise.all([
        fetchPlans(supabase, tenant.id),
        fetchMemberships(supabase, tenant.id),
        fetchPayments(supabase, tenant.id, since),
      ]);
      setPlans(p); setRows(m); setPayments(pay);
      setFailed(false);
      setReason(null);
      setFetchedAt(Date.now());
    } catch (e: any) {
      reportError('members.fetch', e);
      // NOT `setRows([])`. That flipped `loaded` true with nothing behind it,
      // so a failed read rendered as "Nobody on the register yet" over KPIs of
      // 0 active, 0 frozen, 0 payments logged — a gym owner told, in the
      // screen's own confident voice, that they have no members and have taken
      // no money. The three reads land together or not at all, so `failed` is
      // what separates "we could not ask" from "we asked and the register is
      // empty".
      //
      // And NOT `setRows(null)` either, which is what it used to do. That was
      // right while this screen read exactly once, on mount. Pull-to-refresh
      // made a second read routine, and a second read fails for reasons that
      // say nothing about the register — a lift, a basement, a tunnel — so an
      // owner who pulled down out of habit watched a correct roster empty in
      // front of them and could no longer freeze or cancel anybody. The rows
      // that landed are kept and labelled: `stale`, in `readState` below.
      //
      // `plans` and `payments` were already kept on this path. Keeping the
      // memberships makes the three consistent — before this, a failed refresh
      // left the price book and the takings from the earlier read on screen
      // beside a register that had been emptied.
      setFailed(true);
      setReason(typeof e?.message === 'string' ? e.message : null);
    } finally {
      setReloading(false);
    }
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  // `load` reads all three of this screen's sources together — plans,
  // memberships and the thirty-day payments — so the gesture asks for all three.
  const pull = usePullToRefresh(load);

  // What this screen holds, and whether the last attempt landed — two facts,
  // four states, src/lib/staleRead.ts. `loaded` used to be `rows !== null` and
  // carried both.
  const state = readState(rows, failed);
  const loaded = hasRows(state);
  const list = rows ?? [];
  const sum = useMemo(() => summarise(payments, list, plans), [payments, list, plans]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((m) =>
      (m.memberName ?? '').toLowerCase().includes(needle) ||
      (m.planName ?? '').toLowerCase().includes(needle));
  }, [list, q]);

  const frozen = list.filter((m) => m.status === 'frozen').length;

  /** Look up people in this gym who could be given a membership. */
  const runSearch = async (text: string) => {
    setSearch(text);
    const needle = text.trim();
    if (needle.length < 2 || !tenant?.id) { setFound(null); setSearchFailed(false); return; }
    try {
      // supabase-js RESOLVES on a database error rather than rejecting, so
      // `error` has to be read off the result — the catch below only ever
      // covered the network dying. Without this an RLS refusal arrived as
      // `data: null`, fell through `?? []`, and the sheet stated "Nobody
      // matching, or everyone matching already holds an active membership."
      // The owner is standing at the desk with the member in front of them;
      // they conclude that person has no Repple account, and either turn them
      // away or start an account they already have.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('tenant_id', tenant.id)
        .ilike('full_name', `%${needle}%`)
        .limit(12);
      if (error) throw error;
      const held = new Set(list.filter((m) => m.status === 'active').map((m) => m.memberId));
      setFound((data ?? [])
        .map((r: any) => ({ id: String(r.id), name: String(r.full_name || 'Member') }))
        .filter((c: Candidate) => !held.has(c.id)));
      setSearchFailed(false);
    } catch (e) { reportError('members.search', e); setFound(null); setSearchFailed(true); }
  };

  const commitMembership = async () => {
    if (!picked || !tenant?.id) return;
    setBusy(true);
    try {
      await createMembership(supabase, tenant.id, { memberId: picked.id, planId, startedOn: today() });
      setAddOpen(false); setPicked(null); setSearch(''); setFound(null); setSearchFailed(false); setPlanId(null);
      await load();
    } catch (e) {
      reportError('members.create', e);
      Alert.alert('Could not open that membership', 'Nothing was saved. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const changeStatus = (m: Membership, next: MembershipStatus) => {
    const verb = next === 'frozen' ? 'Freeze' : next === 'cancelled' ? 'Cancel' : 'Reactivate';
    Alert.alert(`${verb} this membership?`, `${m.memberName ?? 'This member'} · ${m.planName ?? 'no plan'}`, [
      { text: 'Back', style: 'cancel' },
      { text: verb, style: next === 'cancelled' ? 'destructive' : 'default', onPress: async () => {
        // The failure was silent before this: `setMembershipStatus` could not
        // tell a refused write from a successful one (a PostgREST UPDATE
        // matching zero rows is not an error), and even when it DID throw, the
        // only thing that happened was a line in the error log. The owner saw
        // the dialog close and the list reload, which is exactly what success
        // looks like, and a membership they believe they froze goes on billing.
        // It now counts the rows, and what it says is said out loud.
        try { await setMembershipStatus(supabase, m.id, next); await load(); }
        catch (e) {
          reportError('members.status', e);
          Alert.alert(
            `Could not ${verb.toLowerCase()} that membership`,
            (e instanceof Error && e.message) || 'Nothing was changed. Check your connection and try again.',
          );
        }
      } },
    ]);
  };

  const commitPayment = async () => {
    if (!payFor || !tenant?.id) return;
    // No currency, no write. The form above renders an explanation instead of
    // an amount field when this is null, so in normal running this is
    // unreachable — it is here because `recordPayment` now REQUIRES a currency
    // and the one thing that must never happen is this call site inventing one
    // to satisfy the type.
    if (!cur) return;
    const major = parseFloat(amount.replace(/,/g, ''));
    if (!Number.isFinite(major) || major <= 0) return;
    setBusy(true);
    try {
      // The currency goes with the amount, and it is the gym's own or nothing.
      // The label above this form was corrected to the gym's currency earlier
      // while this write still said 'AED' by default — so a GBP gym's owner
      // read "Amount (GBP)", typed 50, and the row was stored as dirhams,
      // permanently, with nothing on any screen to notice. Before that
      // correction both said AED and were at least consistent: a
      // half-corrected currency is worse than an uncorrected one, because the
      // label is what makes the owner confident.
      await recordPayment(supabase, tenant.id, {
        memberId: payFor.memberId,
        amountCents: Math.round(major * 100),
        method,
        takenAt: new Date().toISOString(),
        currency: cur,
      });
      setPayFor(null); setAmount(''); setMethod('card');
      await load();
    } catch (e) {
      reportError('members.payment', e);
      Alert.alert('Payment not recorded', 'Nothing was saved. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12 } as const;
  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={pull}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name={FORWARD_ICON} size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Members</Text>
        </View>

        {/* When the register was read, whether this phone can reach us, and a
            way to ask again. An owner at a desk in a basement was reading a
            roster with nothing on the page saying how old it was. */}
        <Fetched at={fetchedAt} onRefresh={() => { void load(); }} busy={reloading} style={{ marginTop: 0, marginBottom: sp.md }} />

        {/* One caveat for the whole screen, because staleness is a fact about
            the read and every figure below comes off the same read. Said here
            rather than repeated into each note: three copies of "not confirmed
            current" is how the three come to disagree.

            `warn`, not `crit`. The rows below are real and complete; what
            failed is the attempt to confirm them, and a red mark over a correct
            register is the boy who cried wolf on the one screen an owner uses
            to cancel somebody's billing. */}
        {state === 'stale' ? (
          <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{staleNote('register', reason)}</Flag>
        ) : null}

        <Hero
          label="Recurring Revenue (monthly)"
          // A figure only where there are rows behind it. `summarise` over three
          // empty arrays returns a null MRR today, so this was already a dash
          // under a failed read — by arithmetic rather than on purpose, which is
          // one refactor of `summarise` away from printing a confident 0.
          figure={hasRows(state) ? (money(sum.mrrCents, cur) ?? '—') : '—'}
          note={state === 'failed'
            ? failedNote('register', reason)
            : state === 'loading'
            ? 'Reading your register…'
            : sum.mrrCents != null && !cur
            // The figure is known and the money it is in is not. Printing it
            // bare would be read in whatever currency the owner is thinking in,
            // which is the same wrong number with fewer clues.
            ? 'This gym has not set its currency, so a recurring total cannot be written down. An owner sets it in Ops.'
            : sum.mrrCents == null
            ? canSayEmpty(state) && list.length === 0
              ? 'No memberships on the register yet.'
              : 'No active membership sits on a priced plan, so this is not known — which is not the same as nothing.'
            : `${sum.activeMembers} active${frozen ? ` · ${frozen} frozen` : ''}`}
        />

        <Rule />

        <Section>
          <SectionHead title="The Register" />
          <KpiRow items={[
            { label: 'Active', value: !loaded ? '—' : String(sum.activeMembers) },
            { label: 'Frozen', value: !loaded ? '—' : String(frozen) },
            // Says its window. The read behind it is thirty days, and a label
            // reading "Payments Logged" over a thirty-day count is a figure an
            // owner would reconcile against a lifetime total.
            { label: 'Payments · 30 Days', value: !loaded ? '—' : String(sum.payments) },
          ]} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title={loaded && list.length ? `Memberships · ${list.length}` : 'Memberships'} />

          {loaded && list.length > 0 ? (
            <TextInput
              value={q} onChangeText={setQ}
              placeholder="Search by name or plan"
              placeholderTextColor={t.ink3}
              style={{ ...inp, marginBottom: sp.md }}
              accessibilityLabel="Search memberships"
            />
          ) : null}

          {/* `state === 'failed'`, not `failed`. This branch is for a screen
              holding nothing; a failed refresh over rows that did land is
              'stale', keeps the list below, and is said once at the top.
              The old wording — "this screen simply has nothing to show you" —
              was true of both and is only true of this one. */}
          {state === 'failed' ? (
            <Flag tone={t.crit}>
              {failedNote('register', reason)} Check your connection and try again.
            </Flag>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : list.length === 0 ? (
            /* "…or import your history from a CSV" pointed at nothing twice
               over. There is no CSV import anywhere in the phone app, and the
               importer that does exist — the web console's — says in its own
               header that MEMBERS DO NOT IMPORT: `memberships.member_id` is
               `not null references profiles(id)`, so a membership needs a real
               account behind it and creating one is an invite flow. So the one
               empty state every new gym sees offered a route out of it that
               cannot be walked, in either app. Plans and payments do import,
               which is a true thing to say and a different thing. */
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody on the register yet. Open a membership for someone who already has a Repple
              account — a membership has to point at a real account, so somebody who has never
              used the app is invited rather than imported.
            </Text>
          ) : shown.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No membership matches “{q.trim()}”.</Text>
          ) : shown.map((m, i) => {
            const tone = STATUS_TONE(t, m.status);
            const live = m.status === 'active' || m.status === 'frozen';
            return (
              <View key={m.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ paddingVertical: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>
                        {m.memberName ?? 'Member'}
                      </Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {m.planName ?? 'No plan attached'} · since {m.startedOn}
                        {m.endsOn ? ` · ends ${m.endsOn}` : ''}
                      </Text>
                    </View>
                    <View style={{ borderWidth: hairline, borderColor: tone, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2 }}>
                      <Text style={{ ...ty.micro, color: tone }}>{STATUS_LABEL[m.status]}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                    <Pressable onPress={() => { setPayFor(m); setAmount(''); }} hitSlop={6}
                      accessibilityRole="button" accessibilityLabel={`Take a payment from ${m.memberName ?? 'this member'}`}
                      style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Take payment</Text>
                    </Pressable>
                    {m.status === 'active' ? (
                      <Pressable onPress={() => changeStatus(m, 'frozen')} hitSlop={6}
                        accessibilityRole="button" accessibilityLabel="Freeze membership"
                        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                        <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Freeze</Text>
                      </Pressable>
                    ) : null}
                    {m.status === 'frozen' ? (
                      <Pressable onPress={() => changeStatus(m, 'active')} hitSlop={6}
                        accessibilityRole="button" accessibilityLabel="Reactivate membership"
                        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                        <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>Reactivate</Text>
                      </Pressable>
                    ) : null}
                    {live ? (
                      <Pressable onPress={() => changeStatus(m, 'cancelled')} hitSlop={6}
                        accessibilityRole="button" accessibilityLabel="Cancel membership"
                        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7,
                                 flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        {/* The mark carries the warning, the word stays legible. `t.crit` as
                            label text measured under 4.5:1 on every palette; as a 6px dot it
                            needs 3:1 and clears it everywhere. Destructive intent is not lost
                            — the confirm step is what actually carries it. */}
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                        <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>Cancel</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </Section>

        <View style={{ marginTop: sp.lg }}>
          <Cta label="Open a Membership" wide onPress={() => { setAddOpen(true); setSearch(''); setFound(null); setSearchFailed(false); setPicked(null); }} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, textAlign: 'center' }}>
            For someone who already has a Repple account. Inviting a brand-new member is not built yet.
          </Text>
        </View>
      </ScrollView>

      {/* ── open a membership ─────────────────────────────────────────────── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter }}>
            <Text style={{ ...ty.head, color: t.ink }}>Open a Membership</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              Find someone in your gym who does not already hold an active membership.
            </Text>

            <Text style={lab}>Member</Text>
            {picked ? (
              <Pressable onPress={() => { setPicked(null); setFound(null); setSearchFailed(false); setSearch(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md }}>
                <Icon name="check" size={16} color={t.brand} />
                <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{picked.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3 }}>change</Text>
              </Pressable>
            ) : (
              <>
                <TextInput value={search} onChangeText={runSearch} autoFocus
                  placeholder="Type at least two letters of their name"
                  placeholderTextColor={t.ink3} style={inp} accessibilityLabel="Search for a member" />
                {searchFailed ? (
                  <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
                    The lookup failed, so this cannot tell you whether they have an account. Do
                    not read it as “not found” — check your connection and type the name again.
                  </Flag>
                ) : found !== null ? (
                  found.length === 0 ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                      Nobody matching, or everyone matching already holds an active membership.
                    </Text>
                  ) : (
                    <View style={{ marginTop: sp.sm, maxHeight: 190 }}>
                      <ScrollView keyboardShouldPersistTaps="handled">
                        {found.map((c, i) => (
                          <Pressable key={c.id} onPress={() => setPicked(c)}
                            style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.surface3 }}>
                            <Text style={{ ...ty.body, color: t.ink }}>{c.name}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )
                ) : null}
              </>
            )}

            <Text style={{ ...lab, marginTop: sp.lg }}>Plan</Text>
            {/* Gated on 'failed' rather than on `failed`: a stale screen has
                the price book from the earlier read and can offer it. An owner
                who pulled to refresh in a lift should not then be told their
                plans are unreadable while they are listed two lines down. */}
            {state === 'failed' && plans.length === 0 ? (
              // The price book rides on the same read as the register, so when
              // that read failed there is no basis for "no plans set up yet" —
              // an owner who has plans would be told they have none and open
              // the membership unpriced, which is how a paying member ends up
              // contributing nothing to MRR.
              <Flag tone={t.crit}>
                Your plans could not be read, so none can be offered here. Opening a membership
                now would leave it with no plan attached even if you have one.
              </Flag>
            ) : plans.length === 0 ? (
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                No plans set up yet. The membership can still be opened without one — recurring
                revenue will read as a dash until a priced plan is attached.
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap' }}>
                {plans.filter((p) => p.active).map((p) => {
                  const on = planId === p.id;
                  return (
                    <Pressable key={p.id} onPress={() => setPlanId(on ? null : p.id)}
                      style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 8 }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: on ? t.brandInk : t.ink2 }}>
                        {p.name} · {money(p.priceCents, p.currency) ?? '—'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={{ marginTop: sp.lg }}>
              <Pressable disabled={!picked || busy} onPress={commitMembership}
                style={{ backgroundColor: picked && !busy ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: picked && !busy ? t.brandInk : t.ink3 }}>
                  {busy ? 'Opening…' : 'Open membership'}
                </Text>
              </Pressable>
              <Ghost label="Cancel" onPress={() => setAddOpen(false)} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── take a payment ────────────────────────────────────────────────── */}
      <Modal visible={!!payFor} transparent animationType="slide" onRequestClose={() => setPayFor(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPayFor(null)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter }}>
            <Text style={{ ...ty.head, color: t.ink }}>Take a payment</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              {payFor?.memberName ?? 'Member'} · recorded at the desk, not charged to a card.
            </Text>

            {/* The currency comes from the one place the owner app keeps it,
                so this label cannot drift from what money() prints two lines up
                the screen — or from what the write beside it stores. The label
                and the write coming apart is the whole bug: this label was
                corrected to the gym's currency earlier and `recordPayment` was
                not, so a GBP gym's owner read "Amount (GBP)", typed 50, and 50
                dirhams went into the ledger. They now read the same `cur`, and
                when there is no `cur` there is no form. */}
            {cur ? (
              <>
                <Text style={lab}>Amount ({cur})</Text>
                <TextInput value={amount} onChangeText={setAmount} autoFocus keyboardType="decimal-pad"
                  placeholder="0.00" placeholderTextColor={t.ink3} returnKeyType="done"
                  onSubmitEditing={() => { void commitPayment(); }} style={inp} accessibilityLabel={`Amount in ${cur}`} />
              </>
            ) : (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                This gym has not set its currency, so a payment cannot be recorded yet — an amount
                with no currency is a number, and it would be stored as one permanently. An owner
                sets the currency in Ops, and this form works from that moment on.
              </Text>
            )}

            <Text style={{ ...lab, marginTop: sp.md }}>Method</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap' }}>
              {METHODS.map((m) => {
                const on = method === m;
                return (
                  <Pressable key={m} onPress={() => setMethod(m)}
                    style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 8 }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: on ? t.brandInk : t.ink2 }}>{METHOD_LABEL[m]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: sp.lg }}>
              <Pressable disabled={!amount.trim() || busy || !cur} onPress={commitPayment}
                style={{ backgroundColor: amount.trim() && !busy && cur ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: amount.trim() && !busy ? t.brandInk : t.ink3 }}>
                  {busy ? 'Recording…' : 'Record payment'}
                </Text>
              </Pressable>
              <Ghost label="Cancel" onPress={() => setPayFor(null)} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
