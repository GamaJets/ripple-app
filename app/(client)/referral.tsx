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
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, Share, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useBrand } from '../../src/ui/brand';
import { myReferralCode, myReferrals, myReferralSummary } from '../../src/lib/referrals';
import { referralLink, referralMessage } from '../../src/lib/referralLink';
import { copyToClipboard, HAS_NATIVE_CLIPBOARD } from '../../src/ui/nativeModules';
import {
  CONVERSION_RULE, REFERRAL_PRIVACY_NOTE, rewardNote, friendLine, shapeReferrals,
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

  // The code, the list of people who used it and the two counts over them all
  // come from `load`, so one call brings the whole screen back.
  const pull = usePullToRefresh(load);

  // The message and the bare link, both from src/lib/referralLink.ts so that
  // the thing shared, the thing copied and the thing a friend's app opens are
  // one string built once. This screen used to compose the sentence inline and
  // put NO LINK in it at all — the friend had to read the code off a message
  // and type it into an optional field near the bottom of a sign-up form.
  const shareMsg = code ? referralMessage(code, appName) : '';
  const link = code ? referralLink(code) : '';

  const invite = async () => {
    if (!code) return;
    try { await Share.share({ message: shareMsg }); } catch { /* user cancelled */ }
  };

  /**
   * What was last copied, so the button can say it worked.
   *
   * Held as the label rather than a boolean because there are two things to
   * copy and a confirmation that does not say WHICH is a confirmation the
   * member has to test by pasting. Cleared on a timer so it does not sit there
   * claiming a copy that happened five minutes ago.
   */
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: 'link' | 'code') => {
    const text = what === 'link' ? link : code;
    if (!text) return;
    // Reported, never assumed. expo-clipboard is native and is absent from any
    // build made before it landed — and "copied" is a sentence somebody acts on
    // by pasting, so claiming it when nothing was copied means an empty paste
    // and a message with no link in it.
    const ok = await copyToClipboard(text);
    if (!ok) {
      Alert.alert(
        'Not copied',
        HAS_NATIVE_CLIPBOARD
          ? 'That could not be put on your clipboard just now. Share My Invite sends the same link straight to whichever app you pick.'
          : 'This version of the app cannot use the clipboard. Share My Invite sends the same link straight to whichever app you pick.',
      );
      return;
    }
    setCopied(what === 'link' ? 'Link copied' : 'Code copied');
    setTimeout(() => setCopied(null), 2500);
  };

  const steps = [
    // Step 2 used to read "They enter your code when they sign up", which was
    // an accurate description of the only thing that could happen and also the
    // step that lost most people. The link now carries the code through
    // install and sign-up, so the step says what actually happens.
    { n: '1', label: 'Share Your Link', note: 'Send it to a friend or training partner.' },
    { n: '2', label: 'They Join ' + appName, note: 'Your code travels with the link, so there is nothing for them to type.' },
    { n: '3', label: 'They Start Training', note: 'The referral counts once they log their first workout.' },
  ];

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

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
              <View accessibilityElementsHidden importantForAccessibility="no"
                style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status === 'ready' && (joined || 0) > 0 ? t.brand : t.ink3 }} />
              <Text style={{ ...ty.label, ...numeric, color: t.ink2 }} numberOfLines={2}>
                {summaryLine(status, joined, converted)}
              </Text>
            </View>

            {/* The link, shown as well as sent. A member pasting their invite
                into an Instagram bio or a WhatsApp group needs the URL itself,
                and a share sheet cannot put it there. */}
            {code ? (
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.md }} numberOfLines={2}>{link}</Text>
            ) : null}

            <View style={{ marginTop: sp.lg }}>
              {code ? (
                <Cta label="Share My Invite" wide onPress={invite} />
              ) : (
                <Ghost label="Try Again" onPress={load} />
              )}
            </View>
            {code ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
                <Ghost label="Copy Link" icon="share" onPress={() => copy('link')} />
                <Ghost label="Copy Code" onPress={() => copy('code')} />
                {/* Ink, not a coloured flash. `copied` is a fact about what
                    just happened rather than a state worth a status colour, and
                    t.crit/t.warn are marks in this app and not text anyway. */}
                {copied ? <Text style={{ ...ty.caption, color: t.ink2 }}>{copied}</Text> : null}
              </View>
            ) : null}
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
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{rewardNote(appName)}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{REFERRAL_PRIVACY_NOTE}</Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
