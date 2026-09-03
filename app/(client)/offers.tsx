// Client · Offers. Redeem a code your gym has given you, and see the ones you
// have already used.
//
// ── What this screen does NOT do ───────────────────────────────────────────
//
// It does not take money off anything. Repple records that you used a code and
// tells your gym; applying the discount is the gym's billing, not ours. That is
// stated on the screen rather than left to be discovered, because a screen that
// says "20% off applied" over a payment it never touched is the kind of lie
// this codebase keeps having to remove.
//
// The Membership screen's "Offers" row used to point at Explore — a list of
// what else the app can do, which is not an offer. It points here now.
import { useCallback, useEffect, useState } from 'react';
import { BRAND } from '../../src/lib/brands';
import { appLocale } from '../../src/lib/locale';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Notice, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import type { LoadStatus } from '../../src/ui/loadStatus';

/**
 * The ceiling `my_promo_redemptions()` takes, mirrored so a read that came back
 * at it can be reported as a prefix.
 *
 * Inside the function body, which is what makes it invisible: src/lib/rowCap.ts
 * detects truncation by asking for one row more than it will accept and the
 * server can never answer with 201. `>= cap` rather than `> cap` for the reason
 * src/lib/challenges.ts sets out — two hundred rows back from a `limit 200` is
 * already the ceiling and there is no probe row to find.
 *
 * The order is `redeemed_at desc`, so what a cut list loses is the oldest
 * codes. That matters here more than the count does: this list is what tells a
 * member a code is already spent, and a code that fell off the end reads as one
 * they have never used.
 */
const REDEMPTION_ROW_CAP = 200;

interface Redeemed {
  code: string;
  /** The percentage off, or NULL when the row did not carry a number we could
   *  read. `Number(r.discount) || 0` collapsed those two into one, and the
   *  screen then printed "0% off" beside a code the member had spent — a
   *  specific, wrong claim about what their gym owes them, and one they would
   *  take to the desk. See the note on the row below. */
  discount: number | null;
  redeemedAt: string;
}

/** A percentage, or null when there is not one. Zero is a real answer here — a
 *  gym may record a code worth nothing off — so it is kept, and only an absent,
 *  unparseable or nonsensical figure becomes null. */
function discountOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/** Why a code was refused, in words the person holding the phone can act on. */
function refusal(reason: string | undefined, code: string): string {
  switch (reason) {
    case 'no-such-code': return `Your gym has no code called “${code}”. Check the spelling with them.`;
    case 'inactive':     return `“${code}” is no longer running.`;
    case 'already':      return `You have already used “${code}”. A code works once per person.`;
    case 'no-gym':       return 'Your account is not attached to a gym yet, so there is nothing to redeem against.';
    case 'signed-out':   return 'You appear to be signed out. Sign in and try again.';
    default:             return 'That could not be redeemed just now. Try again in a moment.';
  }
}

export default function Offers() {
  const t = useTheme();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Redeemed[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    const { data, error } = await supabase.rpc('my_promo_redemptions');
    if (error) { setStatus('error'); return; }
    const rows = Array.isArray(data) ? data : [];
    setMine(rows.map((r: any) => ({
      code: String(r.code), discount: discountOf(r.discount), redeemedAt: String(r.redeemed_at),
    })));
    // 'ready' was set over the page unconditionally, and the page has a ceiling
    // this side could not see: `my_promo_redemptions()` ends `limit 200` inside
    // the function body (supabase/parts/104-promo-redemptions.sql), so
    // src/lib/rowCap.ts is blind to it — a cut list and a whole one arrive
    // identically. The heading beside this list prints `mine.length` as a
    // count, and 'partial' is what withholds it; the rows themselves are real
    // and still shown. See src/ui/loadStatus.ts.
    setStatus(rows.length >= REDEMPTION_ROW_CAP ? 'partial' : 'ready');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // A failed read used to strand this screen for the whole session — the only
  // way to ask again was to leave and come back. Pull to refresh is the gesture
  // people already try; see src/ui/pullToRefresh.tsx.
  const pull = usePullToRefresh(useCallback(() => { void refresh(); }, [refresh]));

  const redeem = async () => {
    const c = code.trim().toUpperCase();
    if (!c || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('redeem_promo', { p_code: c });
    setBusy(false);
    if (error) { Alert.alert('Not redeemed', 'That could not be redeemed just now. Try again in a moment.'); return; }
    const res = (data ?? {}) as { ok?: boolean; reason?: string; discount?: number; code?: string };
    if (!res.ok) { Alert.alert('Not redeemed', refusal(res.reason, c)); return; }
    setCode('');
    await refresh();
    // Same rule one line later: the RPC's own `discount` goes through the same
    // reader, so a response that carried no figure says the code is recorded
    // rather than announcing "undefined% off" — or a nought.
    const pct = discountOf(res.discount);
    Alert.alert(
      'Code redeemed',
      pct == null
        ? `${res.code ?? c} is recorded against your account and your gym has been told. We couldn’t read how much it takes off — your gym applies it to your billing and can tell you.`
        // `res.code ?? c`, like the branch above it. The RPC is not obliged to
        // echo the code back, and one of these two lines defended against that
        // while the other did not — so the same response produced "undefined ·
        // 20% off is recorded against your account", about somebody's billing,
        // in a confirmation they are meant to trust. `c` is what they typed and
        // is the right thing to name when the server does not name it.
        : `${res.code ?? c} · ${pct}% off is recorded against your account and your gym has been told. They apply the discount to your billing.`,
    );
  };

  const when = (iso: string) => {
    const d = new Date(iso);
    // `appLocale()`, never `undefined`. `undefined` is the DEVICE's locale, and
    // this app is white-label: the same binary runs in Dubai, London and Tokyo,
    // and app/(client)/membership.tsx records fixing this exact pattern as a
    // defect — "two dates on one screen were written two different ways". Every
    // sibling screen (receipts, membership) already reads through it.
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} refreshControl={pull}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Membership</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Offers</Text>
          </View>
        </View>

        <Section style={{ marginTop: sp.lg }}>
          <SectionHead title="Redeem a Code" />
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            A code from your gym. It works once, and only at the gym that issued it.
          </Text>
          <TextInput
            value={code} onChangeText={setCode}
            autoCapitalize="characters" autoCorrect={false}
            placeholder="SUMMER20" placeholderTextColor={t.ink3}
            style={{
              ...ty.head, color: t.ink, letterSpacing: 2,
              borderBottomWidth: hairline, borderBottomColor: t.ring,
              paddingVertical: sp.md, marginTop: sp.md,
            }}
          />
          <View style={{ marginTop: sp.lg }}>
            <Cta label={busy ? 'Redeeming…' : 'Redeem'} onPress={redeem} disabled={busy || !code.trim()} wide />
          </View>
        </Section>

        <Notice tone={t.ink3} kicker="How this works" title={`${BRAND.label} records it, your gym applies it`}
          note={`Redeeming tells your gym you have used the code. The discount comes off through their billing, not through the app — ${BRAND.label} never touches the payment.`} />

        <Rule />

        <Section>
          <SectionHead title="Codes You Have Used" note={status === 'ready' && mine.length ? String(mine.length) : undefined} />
          {status === 'error' ? (
            // Empty under 'error' means we could not read it, which is not the
            // same as never having used one — and this list is what tells
            // somebody a code is already spent.
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              This could not be read just now. It is not a statement that you have used none.
            </Text>
          ) : mine.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {status === 'loading' ? 'Loading.' : 'None yet. Codes you redeem appear here.'}
            </Text>
          ) : mine.map((r, i) => (
            <View key={`${r.code}-${i}`} style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.sm,
              paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, letterSpacing: 1 }}>{r.code}</Text>
                {/* The code is what the member takes to the desk; the
                    percentage is what they expect off. An unreadable figure
                    says so rather than printing a nought, which is a number
                    somebody would argue with reception about. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {r.discount == null ? 'Redeemed — we couldn’t read how much off' : `${r.discount}% off`}
                </Text>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{when(r.redeemedAt)}</Text>
            </View>
          ))}

          {/* The list stops where the server's `limit 200` stops, and nothing
              said so. The count beside the heading is already withheld under
              'partial'; this is the part the heading cannot say, which is that
              the oldest codes are the ones missing — and an old code missing
              from this list reads as a code never used. */}
          {status === 'partial' ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Only your {REDEMPTION_ROW_CAP} most recent codes are listed here, so this is not all of them. A code you used long ago may be missing from it rather than unused.
            </Text>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
