// Coach · Marketplace. Sell a ready-made program, made from one of your saved
// templates, to the members of your gym. The listing keeps a copy of the
// program as it was when listed; a member who buys it has it assigned to them
// by the server once Stripe says they paid (supabase/parts/3310).
//
// Priced in the coach's one currency (`fetchMyCurrency`: the gym's, or their
// own when they have no gym), exactly as packages are. There is no second
// currency to pick from: a listing in a currency the coach does not charge in
// is the reprice src/lib/coachCurrency.ts refuses everywhere else.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ListRow, PageHead, Notice, Cta, Ghost, Field, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { isStarterId } from '../../src/lib/templateLibrary';
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import { myCurrencyLine } from '../../src/lib/currencySource';
import { readMinorAmount, minorMoney } from '../../src/lib/coachMoney';
import { fmtDay } from '../../src/lib/format';
import { listingBlocker, nextAction, priceLabel, salesTotals, statusLabel, type Listing, type MarketPurchase } from '../../src/lib/marketplace';
import { fetchMyListings, fetchMarketPurchases, createListing, setListingStatus } from '../../src/lib/marketplaceData';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import type { MyCurrency } from '../../src/lib/currencySource';

export default function CoachMarketplace() {
  const t = useTheme();
  const lib = useProgramTemplates();
  const own = useMemo(() => lib.templates.filter((x) => !isStarterId(x.id)), [lib.templates]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<MarketPurchase[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [cur, setCur] = useState<MyCurrency | null>(null);
  const [making, setMaking] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, s, c] = await Promise.all([fetchMyListings(), fetchMarketPurchases('coach'), fetchMyCurrency()]);
    // An abandoned checkout is not a sale.
    setListings(l.rows); setSales(s.rows.filter((p) => p.status !== 'pending')); setCur(c);
    setStatus(l.status === 'error' || s.status === 'error' ? 'error' : l.status === 'partial' || s.status === 'partial' ? 'partial' : 'ready');
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pull = usePullToRefresh(load);
  useRefreshOnFocus(load);

  const currency = cur?.currency ?? null;
  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const totals = useMemo(() => salesTotals(sales), [sales]);
  const field = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md };

  const save = async () => {
    setError(null);
    const read = currency ? readMinorAmount(price, currency) : null;
    if (read && !read.ok) { setError(read.reason); return; }
    const cents = read && read.ok ? read.minorUnits : null;
    const blocked = listingBlocker({ title, description, priceCents: cents, currency, templateId });
    if (blocked) { setError(blocked); return; }
    const tpl = own.find((x) => x.id === templateId);
    if (!tpl) { setError('That program is not in your library any more.'); return; }
    setBusy(true);
    const why = await createListing({ templateId: tpl.id, program: tpl.program, title, description, priceCents: cents!, currency: currency! });
    setBusy(false);
    if (why) { setError(why); return; }
    setMaking(false); setTemplateId(null); setTitle(''); setDescription(''); setPrice('');
    void load();
  };

  const flip = (l: Listing) => {
    const next = nextAction(l.status);
    const go = async () => {
      const why = await setListingStatus(l.id, next.to);
      if (why) Alert.alert('Not Changed', why);
      void load();
    };
    if (next.to === 'live') {
      Alert.alert('Put This On Sale?', `Members of your gym will be able to buy “${l.title}” for ${priceLabel(l) ?? 'the price shown'}.`,
        [{ text: 'Not Yet', style: 'cancel' }, { text: next.label, onPress: go }]);
    } else {
      Alert.alert('Retire This Program?', 'Members who bought it keep it. Nobody new can buy it.',
        [{ text: 'Keep On Sale', style: 'cancel' }, { text: 'Retire', style: 'destructive', onPress: go }]);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false} refreshControl={pull} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        <PageHead title="Marketplace" subtitle="Sell Your Programs to Members of Your Gym" />

        {status === 'error' ? (
          <Notice kicker="Not Loaded" title="Your listings could not be read" note="Pull down to try again. Nothing has been changed." />
        ) : null}
        {cur && !currency && cur.gap ? (
          <Notice kicker="No Currency" title="Programs cannot be priced yet" note={myCurrencyLine(cur.gap, 'a program cannot be put on sale')} />
        ) : null}

        {making ? (
          <Section>
            <SectionHead title="New Listing" />
            <Field label="Program" style={{ marginBottom: sp.md }}>
              {own.length === 0 ? (
                <Text style={{ ...ty.caption, color: t.ink3 }}>Save a program template first. The built-in starters cannot be sold.</Text>
              ) : own.map((x) => (
                <ListRow key={x.id} icon={templateId === x.id ? 'check' : 'grid'} tone={templateId === x.id ? 'brand' : 'neutral'} title={x.name}
                  onPress={() => { setTemplateId(x.id); if (!title.trim()) setTitle(x.name); }} />
              ))}
            </Field>
            <Field label="Title" style={{ marginBottom: sp.md }}>
              <TextInput value={title} onChangeText={setTitle} placeholder="8 Week Strength" placeholderTextColor={t.ink3}
                accessibilityLabel="Listing title" style={field} maxLength={120} />
            </Field>
            <Field label="Description" style={{ marginBottom: sp.md }}>
              <TextInput value={description} onChangeText={setDescription} placeholder="Who it is for and what it involves" placeholderTextColor={t.ink3}
                accessibilityLabel="Listing description" style={[field, { minHeight: 80 }]} multiline maxLength={2000} />
            </Field>
            <Field label="Price" hint={currency ?? undefined} style={{ marginBottom: sp.md }}>
              <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.ink3}
                accessibilityLabel={currency ? `Price in ${currency}` : 'Price'} editable={!!currency} style={{ ...field, ...numeric }} />
            </Field>
            {error ? <Flag tone={t.crit} style={{ marginBottom: sp.md }}>{error}</Flag> : null}
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <Ghost label="Cancel" onPress={() => { setMaking(false); setError(null); }} />
              <Cta label={busy ? 'Saving' : 'Save as Draft'} onPress={save} disabled={busy || !currency} />
            </View>
          </Section>
        ) : (
          <Section>
            <Cta label="New Listing" onPress={() => { setMaking(true); setError(null); }} wide disabled={!currency} />
          </Section>
        )}

        <Section>
          <SectionHead title="Your Listings" />
          {isWhole(status) && listings.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3 }}>Nothing listed yet. A listing starts as a draft that only you can see.</Text>
          ) : null}
          {listings.map((l) => (
            <ListRow key={l.id} icon="grid" tone={l.status === 'live' ? 'brand' : 'neutral'} title={l.title}
              note={`${priceLabel(l) ?? 'Price unreadable'} · ${statusLabel(l.status)}`}
              meta={nextAction(l.status).label} onPress={() => flip(l)} />
          ))}
        </Section>

        <Section>
          <SectionHead title="Sales" note={totals.map((x) => `${minorMoney(x.cents, x.currency)} from ${x.count}`).join(' · ') || undefined} />
          {isWhole(status) && sales.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3 }}>No sales yet.</Text>
          ) : null}
          {sales.map((p) => (
            <View key={p.id} style={{ paddingVertical: sp.sm }}>
              <Text style={{ ...ty.head, color: t.ink }}>{byId.get(p.listingId)?.title ?? 'A program'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                {minorMoney(p.amountCents, p.currency) ?? 'Amount unreadable'} · {statusLabel(p.status)} · {fmtDay(p.paidAt ?? p.createdAt)}
              </Text>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
