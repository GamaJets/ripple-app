// Trainer · Payments (Stripe Connect). Onboard a payout account, then create
// packages (memberships / session-packs) clients can buy. Money goes to the
// trainer's connected account minus the platform fee. Credential-ready: activates
// once Stripe Connect is enabled and keys are set. No card details in-app.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every Stripe/Connect call, handler, conditional and route
// was untouched in that pass — only the presentation changed: the four bordered cards became
// hairline-separated sections, the one card left is the payout decision itself,
// and the Georgia serif header is gone.
//
// Nothing here reports a balance, a payout or a transaction: every figure is a
// price the trainer typed, stored in `trainer_packages`. There is no earnings
// number on this screen because the app is not told one.
//
// Two things are new. A package can now bill EVERY month or year rather than
// once (part 97), which is the biggest difference between two rows on this
// screen and so is stated on every one of them — "one-off" is written out
// rather than implied by the absence of the word "month". And a coach can see
// who is subscribed, because a recurring charge nobody can list is a recurring
// charge nobody can check.
//
// Prices are printed in the package's OWN currency, with the code spelled out
// — "AED 600.00", not "$600". `money()` in src/lib/billing.ts maps everything
// it does not recognise onto a dollar sign, and a coach in Dubai has been
// showing their clients a price in a currency they do not take.
//
// New packages are priced in the GYM's currency (tenants.currency, part 99) and
// in nothing else. There is no picker and no default: Repple is white-labelled,
// so a currency this screen chose would be wrong for half the gyms running it.
// A gym that has not set one cannot put a package on sale, and is told that,
// rather than being given a price with a unit invented for it.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { startTrainerOnboarding, fetchMyConnect, fetchMyPackages, createPackage, deactivatePackage, type ConnectStatus, type TrainerPackage } from '../../src/lib/connect';
import { fetchMySubscribers, myTenantCurrency, pkgMoney, pkgPriceLine, statusLabel, isLive, type BillingInterval, type Subscriber } from '../../src/lib/subscriptions';

const INTERVALS: { key: BillingInterval | null; label: string }[] = [
  { key: null, label: 'One-off' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
];

/** How a package bills, in words, for a row in a list. Never blank: "one-off"
 *  said out loud is the point — a coach scanning their price list has to be
 *  able to see which of these charges again. */
const billingWords = (p: TrainerPackage): string => {
  const price = pkgPriceLine(p.price_cents, p.currency, p.billing_interval);
  const what = p.billing_interval ? '' : p.sessions ? ` · ${p.sessions} sessions` : ' · one-off membership';
  return `${price ?? fig(null)}${what}`;
};

export default function TrainerPayments() {
  const t = useTheme();
  const router = useRouter();
  const [conn, setConn] = useState<ConnectStatus | null>(null);
  // null is not []. [] is a trainer who sells nothing; null is a price list we
  // could not read, and telling someone they have no packages when they do is
  // how a duplicate price list gets built.
  const [pkgs, setPkgs] = useState<TrainerPackage[] | null>(null);
  const [pkgErr, setPkgErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sessions, setSessions] = useState('');
  const [interval, setInterval] = useState<BillingInterval | null>(null);
  // The gym's own currency, and no fallback. Repple is white-labelled: null
  // here means the gym has not set one, and a price is not offered until it
  // has — a package priced in a currency nobody chose is a wrong number in
  // front of every client who ever sees it.
  const [currency, setCurrency] = useState<string | null>(null);
  const [currencyErr, setCurrencyErr] = useState<string | null>(null);
  // Who is paying this coach every month. 'ready' with nothing means nobody has
  // subscribed; 'error' with nothing means we could not find out, and those are
  // not the same fact about somebody's income.
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [subsStatus, setSubsStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p, s, cur] = await Promise.all([fetchMyConnect(), fetchMyPackages(), fetchMySubscribers(), myTenantCurrency()]);
    setConn(c); setPkgs(p); setPkgErr(p === null);
    setSubs(s.rows); setSubsStatus(s.status);
    setCurrency(cur.currency); setCurrencyErr(cur.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const onboard = async () => { setBusy(true); const r = await startTrainerOnboarding(); setBusy(false); if (!r.ok) Alert.alert('Payouts setup', r.error || 'Could not start setup. Make sure Stripe Connect is enabled.'); };

  const addPkg = async () => {
    const nm = name.trim(); const amount = parseFloat(price);
    if (!nm) { Alert.alert('Name it', 'Give the package a name.'); return; }
    if (!(amount > 0)) { Alert.alert('Set a price', 'Enter a price greater than 0.'); return; }
    // Nothing is priced in a currency nobody chose. There is no sensible
    // default in a white-label product — see tenants.currency, part 99.
    if (!currency) {
      Alert.alert('No currency set', currencyErr
        ? 'We could not read what your gym charges in, so a price would have no unit. Try again in a moment.'
        : 'Your gym has not set a currency yet, so there is nothing to price this in. An owner sets it in the gym settings.');
      return;
    }
    // A recurring package is never also a session pack — the constraint in part
    // 97 and the guard in createPackage both refuse it, and the form does not
    // offer the field at all, so this is belt and braces on a typed value.
    const sess = interval ? null : sessions.trim() ? parseInt(sessions, 10) : null;
    const cents = Math.round(amount * 100);
    // The last thing before a recurring price goes on sale is the coach reading
    // it back in the currency it will actually be charged in. A subscription
    // priced by accident in the wrong currency is not one wrong sale, it is a
    // wrong sale every month to everybody who ever buys it.
    const confirmLine = `${pkgPriceLine(cents, currency, interval) ?? fig(null)} — ${nm}`;
    const go = async () => {
      setBusy(true);
      const r = await createPackage({ name: nm, price_cents: cents, sessions: sess && sess > 0 ? sess : null, currency, billing_interval: interval });
      setBusy(false);
      if (!r.ok) { Alert.alert('Could not save', r.error || 'Try again.'); return; }
      setName(''); setPrice(''); setSessions(''); setInterval(null); load();
    };
    if (!interval) { go(); return; }
    Alert.alert('Charge this every ' + (interval === 'month' ? 'month' : 'year') + '?',
      `${confirmLine}\n\nClients who subscribe are charged again every ${interval === 'month' ? 'month' : 'year'} until they cancel.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Put On Sale', onPress: go }]);
  };

  const remove = (id: string) => Alert.alert('Remove package?', 'Clients will no longer see it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
    // deactivatePackage used to return void and swallow the error, so this
    // refreshed and said nothing — a package the trainer believes is withdrawn
    // stays on sale until a client buys it.
    const ok = await deactivatePackage(id);
    if (!ok) { Alert.alert('Not removed', 'That package is still on sale — the change did not save. Try again in a moment.'); return; }
    load();
  } }]);

  const active = conn?.charges_enabled;
  const G = layout.gutter;
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  /** One row of mutually exclusive choices, drawn from the same tokens as the
   *  inputs beside it. Local rather than in the kit because it is one form. */
  const Pick = ({ label, options, chosen, onPick }: {
    label: string; options: { key: string | null; label: string }[]; chosen: string | null; onPick: (k: any) => void;
  }) => (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: sp.xs, flexWrap: 'wrap' }}>
        {options.map((o) => {
          const on = o.key === chosen;
          return (
            <Pressable key={o.label} onPress={() => onPick(o.key)} accessibilityRole="button"
              accessibilityState={{ selected: on }} accessibilityLabel={label + ': ' + o.label}
              style={{
                paddingHorizontal: sp.md, paddingVertical: 9, borderRadius: radius.pill,
                backgroundColor: on ? t.brand : t.surface2,
              }}>
              <Text style={{ ...ty.caption, fontWeight: '600', color: on ? t.bg : t.ink2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const liveSubs = subs.filter((s) => isLive(s.status));
  // The typed price read back in the gym's currency, or null when either half
  // is missing. Never a number with a unit put on it for the look of the thing.
  const typed = parseFloat(price);
  const priceEcho = currency && typed > 0 ? pkgMoney(Math.round(typed * 100), currency) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Getting paid</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Payments</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Get paid by your clients — memberships &amp; session packs.
        </Text>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} /> : (
          <>
            {/* ── payout status: the one decision on this screen ──────────── */}
            {!active ? (
              <View style={{ marginTop: sp.xl }}>
                <Notice tone={t.warn} kicker="Payouts" title="Set Up Payouts"
                  note={conn?.stripe_account_id ? 'Finish verifying with Stripe to go live.' : 'Connect a payout account with Stripe.'}>
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label={busy ? 'Opening…' : (conn?.stripe_account_id ? 'Continue Setup' : 'Set Up Payouts')} wide disabled={busy} onPress={onboard} />
                  </View>
                </Notice>
              </View>
            ) : (
              <Section>
                <SectionHead title="Payouts" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Payouts active</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>You can accept client payments.</Text>
                  </View>
                </View>
              </Section>
            )}

            <Rule />

            {/* ── what clients can buy ───────────────────────────────────── */}
            <Section>
              <SectionHead title="Your Packages" note={(pkgs ?? []).filter((p) => p.active).length ? String((pkgs ?? []).filter((p) => p.active).length) : undefined} />
              {pkgErr ? (
                <Flag tone={t.crit}>
                  Your packages could not be read, so this is not a list of what you sell. Do not add
                  them again from here — reopen the screen once you have signal.
                </Flag>
              ) : (pkgs ?? []).filter((p) => p.active).length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>No packages yet. Add one below — a monthly membership or a pack of sessions.</Text>
              ) : null}
              {(pkgs ?? []).filter((p) => p.active).map((p, i) => (
                <View key={p.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{billingWords(p)}</Text>
                  </View>
                  <Pressable onPress={() => remove(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + p.name} style={{ padding: 6 }}>
                    <Icon name="minus" size={17} color={t.ink3} />
                  </Pressable>
                </View>
              ))}
            </Section>

            <Rule />

            {/* ── who is subscribed ──────────────────────────────────────── */}
            <Section>
              {/* The count is only printed under 'ready'. Under 'partial' the
                  rows are real but there are more of them, so a number beside
                  the title would be a total computed from part of the set —
                  and this particular total is somebody's recurring income. */}
              <SectionHead title="Subscribers" note={subsStatus === 'ready' && liveSubs.length ? String(liveSubs.length) : undefined} />
              {subsStatus === 'error' ? (
                <Flag tone={t.crit}>
                  We could not read your subscribers, so this is not a list of who is paying you. It is
                  not a statement that nobody is — anyone subscribed still is.
                </Flag>
              ) : subsStatus === 'partial' ? (
                <PartialRead what="subscribers" shown={subs.length} onPress={load} />
              ) : liveSubs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Nobody is subscribed yet. Add a monthly or yearly package below and it appears on your
                  clients&apos; Memberships screen.
                </Text>
              ) : null}
              {(subsStatus === 'error' ? [] : liveSubs).map((s, i) => (
                <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                    {/* A name we could not read is a dash, never 'Client' —
                        the money beside it is real either way. */}
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(s.client_name)}</Text>
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(pkgPriceLine(s.amount_cents, s.currency, s.billing_interval))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'past_due' ? t.crit : s.cancel_at_period_end ? t.warn : t.brand }} />
                    <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                      {statusLabel(s.status)}
                      {s.current_period_end
                        ? ` · ${s.cancel_at_period_end ? 'ends' : 'renews'} ${new Date(s.current_period_end).toLocaleDateString()}`
                        : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </Section>

            <Rule />

            {/* ── add a package ──────────────────────────────────────────── */}
            <Section>
              <SectionHead title="Add a Package" />
              <TextInput value={name} onChangeText={setName} placeholder="Name — e.g. 10-Session Pack" placeholderTextColor={t.ink3} style={input} />

              <View style={{ marginTop: sp.md }}>
                <Pick label="Billing" options={INTERVALS.map((i) => ({ key: i.key, label: i.label }))} chosen={interval}
                  onPick={(k: BillingInterval | null) => { setInterval(k); if (k) setSessions(''); }} />
              </View>

              {/* The gym's currency, stated rather than picked — and dashed
                  rather than guessed. Repple is white-labelled, so there is no
                  currency this screen could assume that is not simply wrong for
                  half the gyms running it. Null is a missing setting an owner
                  fixes, not a value to fill in here. */}
              {!currency ? (
                <View style={{ marginTop: sp.md }}>
                  <Flag tone={t.warn}>
                    {currencyErr
                      ? 'We could not read what your gym charges in, so a price here would have no unit. Nothing can go on sale until we can.'
                      : 'Your gym has not set a currency yet, so a price here would have no unit. An owner sets it in the gym settings, then packages can go on sale.'}
                  </Flag>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Price ({fig(currency)})</Text>
                  <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="500" placeholderTextColor={t.ink3} style={input} />
                </View>
                {/* Not offered at all on a recurring package. `sessions` is a
                    balance granted once and drawn down; nothing renews it, so
                    "10 sessions, monthly" would charge again in month two for
                    credits already spent in month one. Part 97 refuses the
                    combination outright. */}
                {interval ? null : (
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Sessions (blank = membership)</Text>
                    <TextInput value={sessions} onChangeText={setSessions} keyboardType="number-pad" placeholder="10" placeholderTextColor={t.ink3} style={input} />
                  </View>
                )}
              </View>

              {/* Read back exactly what will be charged, in the unit it will be
                  charged in — or nothing at all. A preview that says "AED" on a
                  gym that has not set a currency is the invention this whole
                  screen is avoiding. */}
              {interval ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {priceEcho
                    ? `Clients are charged ${priceEcho} every ${interval === 'month' ? 'month' : 'year'} until they cancel.`
                    : `Clients are charged every ${interval === 'month' ? 'month' : 'year'} until they cancel.`}
                </Text>
              ) : null}

              <View style={{ height: sp.lg }} />
              <Cta label={busy ? 'Saving…' : interval ? 'Add Subscription' : 'Add Package'} wide disabled={busy || !currency} onPress={addPkg} />
            </Section>

            <Rule />

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
              Payments are processed by Stripe. A platform fee applies to each sale. You never handle card details.
            </Text>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
