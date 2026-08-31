// Client · Invite friends. Share a referral code, and see what happened to the
// people who used it.
//
// Uses the core React Native Share sheet (OTA-safe, no native module).
//
// ── What changed ───────────────────────────────────────────────────────────
//
// The code used to be derived here, in JavaScript, from the user's name and id
// — and the server had never seen that derivation, so a recorded referral was a
// row carrying a STRING with no person attached to it. The header of this file
// said as much: the code "can be credited once reward attribution is wired on
// the backend". It never could be, because nothing knew whose code it was.
//
// The code now comes from `my_referral_code()`, which derives the same string
// with the same algorithm (transcribed into SQL in
// supabase/parts/128-a-cohort-and-a-credit.sql, and checked against this
// file's old `codeFrom` on six cases including the empty-name and hyphenated
// edges), stores it, and can therefore resolve it back to a person. Codes
// already shared before this shipped keep working.
//
// ── The two things this screen must not do ─────────────────────────────────
//
// 1. Invent a reward. Nobody — not the gym, not the coach — has agreed what a
//    referral is worth, and Repple is white-label, so it is not Repple's to
//    decide. The screen records the fact and says out loud that the value is
//    the business's to set. REWARD_NOTE in src/lib/referralCredit is that
//    sentence, and it is tested.
//
// 2. Turn a failed read into a fact. "Nobody has used your code yet" is a claim
//    about whether anybody accepted an invitation; printed off a dropped
//    connection it tells somebody their invitations went nowhere. Every count
//    on this screen goes through summaryLine(), which states nothing unless the
//    read was whole.
//
// A signup is also not a conversion, and the screen is explicit about which one
// it counts: a friend has converted when they log their first workout.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Share, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useBrand } from '../../src/ui/brand';
import { myReferralCode, myReferrals, myReferralSummary } from '../../src/lib/referrals';
import {
  CONVERSION_RULE, REFERRAL_PRIVACY_NOTE, REWARD_NOTE, friendLine, shapeReferrals,
  summaryLine, type ReferralRow,
} from '../../src/lib/referralCredit';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { Rule, Section, SectionHead, Card, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, hairline, radius, type as ty, numeric, value } from '../../src/theme/scale';

export default function Referral() {
  const t = useTheme();
  const router = useRouter();
  const { appName } = useBrand();

  const [code, setCode] = useState<string | null>(null);
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [joined, setJoined] = useState<number | null>(null);
  const [converted, setConverted] = useState<number | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    // The code is asked for first and on its own: it is the thing the screen
    // exists to hand over, and a failure to get it is a different failure from
    // a failure to count what it has done.
    const c = await myReferralCode();
    setCode(c);
    const [list, sum] = await Promise.all([myReferrals(), myReferralSummary()]);
    if (!c || !sum) { setStatus('error'); return; }
    setRows(shapeReferrals(list));
    setJoined(sum.joined);
    setConverted(sum.converted);
    // A null list with a good summary is still a failed read of the list, and
    // the list is what the rows below are drawn from — so the whole screen says
    // 'error' rather than showing counts above an empty list that would read as
    // "and here they are".
    setStatus(list ? 'ready' : 'error');
  }, []);

  useEffect(() => { load(); }, [load]);

  const shareMsg = code
    ? `Join me on ${appName} — the app I use to plan workouts, track progress and dial in my nutrition. Use my code ${code} when you sign up.`
    : '';

  const invite = async () => {
    if (!code) return;
    try { await Share.share({ message: shareMsg }); } catch { /* user cancelled */ }
  };

  const steps = [
    { n: '1', label: 'Share Your Code', note: 'Send it to a friend or training partner.' },
    { n: '2', label: 'They Join ' + appName, note: 'They enter your code when they sign up.' },
    { n: '3', label: 'They Start Training', note: 'The referral counts once they log their first workout.' },
  ];

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Training is easier with company</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Invite Friends</Text>
          </View>
        </View>

        {/* ── the one card: the thing you act on ─────────────────────────── */}
        <Section>
          <Card>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your code</Text>

            {code ? (
              <Text style={{ ...value(30), color: t.ink, letterSpacing: 1.5, marginTop: 6 }}>{code}</Text>
            ) : status === 'loading' ? (
              <View style={{ marginTop: sp.md, alignItems: 'flex-start' }}><ActivityIndicator color={t.ink3} /></View>
            ) : (
              // No invented fallback. A code this screen made up is a code the
              // server has not registered, so anything a friend did with it
              // would be credited to nobody — and the reader would never know.
              // "It hasn't changed" asserted a code the reader may never have
              // seen: `setCode(c)` runs before this branch, so this is what a
              // FIRST load failure shows too, and with no referral code issued
              // yet a first load is the common case. The sentence now claims
              // only what is true either way.
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
                We couldn’t reach your code just now. Nothing has been changed or cancelled — try again in
                a moment.
              </Text>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status === 'ready' && (joined || 0) > 0 ? t.brand : t.ink3 }} />
              <Text style={{ ...ty.label, ...numeric, color: t.ink2 }} numberOfLines={2}>
                {summaryLine(status, joined, converted)}
              </Text>
            </View>

            <View style={{ marginTop: sp.lg }}>
              {code ? (
                <Cta label="Share My Invite" wide onPress={invite} />
              ) : (
                <Ghost label="Try Again" onPress={load} />
              )}
            </View>
          </Card>
        </Section>

        <Rule />

        {/* ── who actually came ───────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Invites" />

          {status === 'error' ? (
            <Text style={{ ...ty.label, color: t.ink2 }}>
              We couldn’t check who has joined. This is a connection problem — nobody has been removed.
            </Text>
          ) : null}

          {/* The summary line in the card above already says "Nobody has used
              your code yet." — `summaryLine('ready', 0, 0)` is that exact
              sentence — so this repeated it word for word two hundred pixels
              down. One fact, twice, in two registers, reads as two facts. This
              says only the part the card cannot: what this list is for. */}
          {status === 'ready' && rows.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Anyone who joins on your code appears here, with the date they came.
            </Text>
          ) : null}

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading who has joined…</Text>
          ) : null}

          {status === 'ready' ? rows.map((r, i) => (
            <View key={r.joinedAt + r.name + i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: r.converted ? t.brand : t.ink3 }}>{r.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{friendLine(r)}</Text>
              </View>
            </View>
          )) : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="How It Works" />
          {steps.map((s, i) => (
            <View key={s.n} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink2 }}>{s.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{s.label}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.note}</Text>
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── what is and is not being promised ───────────────────────────── */}
        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{CONVERSION_RULE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{REWARD_NOTE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{REFERRAL_PRIVACY_NOTE}</Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
