// Client · Marketplace. Ready-made programs the coaches at your gym sell. Buy
// opens Stripe's checkout in the browser, exactly as buying a package does; once
// Stripe says the payment went through, the server puts the program on your
// Train tab (supabase/parts/3310). Nothing is assigned by this screen.
//
// A coach who is not set up to take payments is said so by the server, in the
// same sentence the package screen shows, and nothing is charged.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ListRow, PageHead, Notice, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { fmtDay } from '../../src/lib/format';
import { minorMoney } from '../../src/lib/coachMoney';
import { buyBlocker, priceLabel, statusLabel, type Listing, type MarketPurchase } from '../../src/lib/marketplace';
import { useClientData } from '../../src/ui/clientData';
import { fetchLiveListings, fetchMarketPurchases, listingsByIds, buyListing } from '../../src/lib/marketplaceData';
import type { LoadStatus } from '../../src/ui/loadStatus';

export default function ClientMarketplace() {
  const t = useTheme();
  const [live, setLive] = useState<Listing[]>([]);
  const [mine, setMine] = useState<MarketPurchase[]>([]);
  const [bought, setBought] = useState<Map<string, Listing>>(new Map());
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, p] = await Promise.all([fetchLiveListings(), fetchMarketPurchases('buyer')]);
    setLive(l.rows); setMine(p.rows);
    setStatus(l.status === 'error' || p.status === 'error' ? 'error' : 'ready');
    // What they bought may have been retired since; read those by id.
    const have = new Set(l.rows.map((x) => x.id));
    const missing = [...new Set(p.rows.map((x) => x.listingId))].filter((id) => !have.has(id));
    const extra = await listingsByIds(missing);
    setBought(new Map([...l.rows, ...extra].map((x) => [x.id, x])));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pull = usePullToRefresh(load);
  useRefreshOnFocus(load);

  const owned = useMemo(() => mine.filter((p) => p.status !== 'pending'), [mine]);
  // A member with a coach buys from that coach only (marketplace-checkout says
  // why), so only their programs are offered.
  const cd = useClientData();
  const offered = useMemo(() => (cd.trainerId ? live.filter((l) => l.coachId === cd.trainerId) : live), [live, cd.trainerId]);

  const buy = async (l: Listing) => {
    const blocked = buyBlocker(l, mine);
    if (blocked) { Alert.alert('Cannot Buy This', blocked); return; }
    setBusy(l.id);
    const r = await buyListing(l.id);
    setBusy(null);
    if (!r.ok) Alert.alert('Could Not Start Checkout', r.error || 'Try again in a moment.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="Marketplace" subtitle="Programs from the coaches at your gym" />

        {status === 'error' ? (
          <Notice kicker="Not Loaded" title="Programs could not be read" note="Pull down to try again." />
        ) : null}

        <Section>
          <SectionHead title="On Sale" />
          {status === 'ready' && offered.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3 }}>No programs are on sale at your gym right now.</Text>
          ) : null}
          {offered.map((l) => {
            const blocked = buyBlocker(l, mine);
            return (
              <View key={l.id}>
                <ListRow icon="grid" tone="brand" title={l.title} note={priceLabel(l) ?? 'Price unavailable'}
                  meta={blocked ? 'Owned' : undefined} onPress={() => setOpen(open === l.id ? null : l.id)} />
                {open === l.id ? (
                  <View style={{ paddingBottom: sp.md }}>
                    {l.description ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>{l.description}</Text> : null}
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                      Buying it replaces the program on your Train tab. The one you have now is kept in your history.
                    </Text>
                    {blocked ? <Flag tone={t.good} style={{ marginBottom: sp.md }}>{blocked}</Flag> : null}
                    <View style={{ flexDirection: 'row', gap: sp.md }}>
                      <Ghost label="Close" onPress={() => setOpen(null)} />
                      <Cta label={busy === l.id ? 'Opening Checkout' : `Buy for ${priceLabel(l) ?? ''}`.trim()}
                        onPress={() => buy(l)} disabled={!!blocked || busy !== null || !priceLabel(l)}
                        a11yLabel={`Buy ${l.title}`} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Section>

        <Section>
          <SectionHead title="My Purchases" />
          {status === 'ready' && owned.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3 }}>Nothing bought yet. A program you pay for appears here and on your Train tab.</Text>
          ) : null}
          {owned.map((p) => (
            <View key={p.id} style={{ paddingVertical: sp.sm }}>
              <Text style={{ ...ty.head, color: t.ink }}>{bought.get(p.listingId)?.title ?? 'A program'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                {minorMoney(p.amountCents, p.currency) ?? 'Amount unavailable'} · {statusLabel(p.status)} · {fmtDay(p.paidAt ?? p.createdAt)}
              </Text>
            </View>
          ))}
        </Section>

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
          Payments are processed securely by Stripe. Your card details are never stored in this app.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
