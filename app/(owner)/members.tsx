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
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import {
  fetchPlans, fetchMemberships, fetchPayments, createMembership,
  setMembershipStatus, recordPayment, summarise, money,
  type Membership, type MembershipPlan, type GymPayment, type MembershipStatus, type PaymentMethod,
} from '../../src/lib/gymRecord';

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE = (t: Theme, s: MembershipStatus) =>
  s === 'active' ? t.brand : s === 'frozen' ? t.s3 : t.ink3;

const STATUS_LABEL: Record<MembershipStatus, string> = {
  active: 'Active', frozen: 'Frozen', cancelled: 'Cancelled', expired: 'Expired',
};

const METHODS: PaymentMethod[] = ['card', 'cash', 'transfer', 'direct_debit', 'other'];
const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'Card', cash: 'Cash', transfer: 'Transfer', direct_debit: 'Direct debit', other: 'Other',
};

interface Candidate { id: string; name: string }

export default function OwnerMembers() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [rows, setRows] = useState<Membership[] | null>(null);
  const [payments, setPayments] = useState<GymPayment[]>([]);
  const [failed, setFailed] = useState(false);   // the register read itself failed
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

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    try {
      const [p, m, pay] = await Promise.all([
        fetchPlans(supabase, tenant.id),
        fetchMemberships(supabase, tenant.id),
        fetchPayments(supabase, tenant.id),
      ]);
      setPlans(p); setRows(m); setPayments(pay);
      setFailed(false);
    } catch (e) {
      reportError('members.fetch', e);
      // NOT `setRows([])`. That flipped `loaded` true with nothing behind it,
      // so a failed read rendered as "Nobody on the register yet" over KPIs of
      // 0 active, 0 frozen, 0 payments logged — a gym owner told, in the
      // screen's own confident voice, that they have no members and have taken
      // no money. The three reads land together or not at all, so null here
      // covers all three, and `failed` is what separates "we could not ask"
      // from "we asked and the register is empty".
      setRows(null);
      setFailed(true);
    }
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  const loaded = rows !== null;
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
        try { await setMembershipStatus(supabase, m.id, next); await load(); }
        catch (e) { reportError('members.status', e); }
      } },
    ]);
  };

  const commitPayment = async () => {
    if (!payFor || !tenant?.id) return;
    const major = parseFloat(amount.replace(/,/g, ''));
    if (!Number.isFinite(major) || major <= 0) return;
    setBusy(true);
    try {
      await recordPayment(supabase, tenant.id, {
        memberId: payFor.memberId,
        amountCents: Math.round(major * 100),
        method,
        takenAt: new Date().toISOString(),
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
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron" size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Members</Text>
        </View>

        <Hero
          label="Recurring revenue (monthly)"
          figure={money(sum.mrrCents) ?? '—'}
          note={failed
            ? 'The register could not be read, so recurring revenue is not known. This is a failed read, not a gym with no members.'
            : sum.mrrCents == null
            ? loaded && list.length === 0
              ? 'No memberships on the register yet.'
              : 'No active membership sits on a priced plan, so this is not known — which is not the same as nothing.'
            : `${sum.activeMembers} active${frozen ? ` · ${frozen} frozen` : ''}`}
        />

        <Rule />

        <Section>
          <SectionHead title="The register" />
          <KpiRow items={[
            { label: 'Active', value: !loaded ? '—' : String(sum.activeMembers) },
            { label: 'Frozen', value: !loaded ? '—' : String(frozen) },
            { label: 'Payments logged', value: !loaded ? '—' : String(sum.payments) },
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

          {failed ? (
            <Text style={{ ...ty.label, color: t.crit }}>
              The register could not be read. Nobody has been removed and no membership has
              lapsed — this screen simply has nothing to show you. Check your connection and try
              again.
            </Text>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : list.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody on the register yet. Open a membership for someone who already has a Repple
              account, or import your history from a CSV.
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
                        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                        <Text style={{ ...ty.label, fontWeight: '600', color: t.crit }}>Cancel</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </Section>

        <View style={{ marginTop: sp.lg }}>
          <Cta label="Open a membership" wide onPress={() => { setAddOpen(true); setSearch(''); setFound(null); setSearchFailed(false); setPicked(null); }} />
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
            <Text style={{ ...ty.head, color: t.ink }}>Open a membership</Text>
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
                  <Text style={{ ...ty.caption, color: t.crit, marginTop: sp.sm }}>
                    The lookup failed, so this cannot tell you whether they have an account. Do
                    not read it as “not found” — check your connection and type the name again.
                  </Text>
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
            {failed && plans.length === 0 ? (
              // The price book rides on the same read as the register, so when
              // that read failed there is no basis for "no plans set up yet" —
              // an owner who has plans would be told they have none and open
              // the membership unpriced, which is how a paying member ends up
              // contributing nothing to MRR.
              <Text style={{ ...ty.caption, color: t.crit }}>
                Your plans could not be read, so none can be offered here. Opening a membership
                now would leave it with no plan attached even if you have one.
              </Text>
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

            <Text style={lab}>Amount (AED)</Text>
            <TextInput value={amount} onChangeText={setAmount} autoFocus keyboardType="numeric"
              placeholder="0.00" placeholderTextColor={t.ink3} returnKeyType="done"
              onSubmitEditing={() => { void commitPayment(); }} style={inp} accessibilityLabel="Amount in dirhams" />

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
              <Pressable disabled={!amount.trim() || busy} onPress={commitPayment}
                style={{ backgroundColor: amount.trim() && !busy ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
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
