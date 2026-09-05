// Coach · Your Code. The six characters a coach reads out to somebody standing
// in front of them.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Asked "where is the coach's code to give to clients?", the honest answer was:
// open the Clients tab, press Invite a Client, and read it off a modal sheet
// whose title is about adding a client. Nothing on any screen said the sheet
// held it. The two other places that render the same codes — /(trainer)/money
// and /(trainer)/ad-spend — answer a different question entirely: what each code
// RETURNED. That is a question asked at a desk with a coffee. This one is asked
// on a gym floor with a person waiting, and it needed a screen of its own.
//
// It is one tap from the coach's home tab (the first chip in SHORTCUTS on
// app/(trainer)/dashboard.tsx), it is in TRAINER_NAV so Explore finds it, and it
// is declared `href: null` in app/(trainer)/_layout.tsx.
//
// ── What this file is allowed to decide ────────────────────────────────────
//
// Almost nothing. Every sentence below comes from src/lib/handOutCode.ts, which
// is pure and is asserted on under `npm test` with no device and no network.
// This file reads, draws and shares. The one rule worth repeating here because
// it is the reason both files exist:
//
//   AN UNREAD CODE IS NOT A MISSING ONE.
//
// `my_join_code()` allocates on first ask and is stable after, so a signed-in
// coach with a trainer profile always HAS a code. A screen that cannot show one
// is describing itself, not the coach — and a screen that says "you have no code
// yet" sends a coach to press New Code, which ROTATES: the string on their
// printed cards and in the hands of everybody they met last week stops working,
// to fix what was a dropped request. `codeToGive` never produces that sentence
// and src/lib/handOutCode.test.ts holds it shut.
//
// ── No QR code ─────────────────────────────────────────────────────────────
//
// A QR would be the right affordance here and there is no encoder in
// package.json — react-native-svg can draw one but cannot compute one. Adding a
// dependency for it would mean a native-ish bundle change on a product that
// ships over the air, so the text, the link and the system share sheet are what
// this screen offers. The share sheet already reaches every messaging app on the
// phone, which is how most of these actually get handed over.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { fetchMyJoinCode, fetchMyJoinCodes, type JoinCodesRead } from '../../src/ui/joinCode';
import { shareText } from '../../src/lib/exportShare';
import { HAS_NATIVE_CLIPBOARD, copyToClipboard } from '../../src/ui/nativeModules';
import {
  codeToGive, codesToHandOut, namedCodesLine, handOut,
  copyBlockedNote, copiedNote, copyFailedNote,
  HOW_THEY_USE_IT, type CodeRead,
} from '../../src/lib/handOutCode';
import { codeCountLine } from '../../src/lib/joinCodes';
import { BACK_ICON } from '../../src/ui/direction';

export default function CoachJoinCode() {
  const t = useTheme();
  const router = useRouter();

  // The coach's own code, and the named codes beside it, are two separate
  // reads and are held as two separate states on purpose: one of them failing
  // must not be reported as the other failing. `namedCodesLine('error', …)`
  // says outright that the code above is unaffected, and it can only be true
  // if the two are never collapsed into one status.
  const [read, setRead] = useState<CodeRead>({ status: 'loading' });
  const [codes, setCodes] = useState<JoinCodesRead>({ status: 'loading', rows: [] });

  const load = useCallback(async () => {
    const r = await fetchMyJoinCode();
    setRead(r.ok ? { status: 'ready', code: r.code } : { status: 'error', reason: r.reason });
    setCodes(await fetchMyJoinCodes());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pull = usePullToRefresh(load);

  const give = codeToGive(read);
  const named = codesToHandOut(codes.rows);
  const namedLine = namedCodesLine(codes.status, codes.rows);
  const clipboardNote = copyBlockedNote(HAS_NATIVE_CLIPBOARD);

  /**
   * The bare link onto the clipboard, and the destination sentence after it.
   *
   * Both halves are src/lib/handOutCode.ts's, and they are the same two
   * sentences app/(trainer)/dashboard.tsx has always shown — held in one place
   * so the two screens cannot drift into telling a coach different things about
   * where a paid ad must point.
   */
  const copyLink = useCallback(async (code: string, label: string) => {
    const link = handOut(code).link;
    if (!(await copyToClipboard(link))) {
      Alert.alert('Not copied', copyFailedNote(link), [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Link copied', copiedNote(label), [{ text: 'Done' }]);
  }, []);

  /** The whole invite, into whichever app the coach is about to use. Core React
   *  Native, so it is there on every build this OTA can land on. */
  const shareInvite = useCallback((code: string) => {
    void shareText(handOut(code).message, 'Join me on Repple');
  }, []);

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Bring somebody in</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Your Code</Text>
          </View>
        </View>

        {/* ── the code itself ─────────────────────────────────────────────── */}
        <Section>
          {give.give ? (<>
            {/* Read out loud, so it is set at the size somebody can read across
                an arm's length, and labelled one character at a time for
                VoiceOver — "K7M2QX" is otherwise announced as a word, and this
                is a string whose entire purpose is being transcribed correctly
                by somebody who cannot see it. */}
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Your coaching code, ${give.hand.spoken}`}
              style={{
                backgroundColor: t.surface2, borderRadius: radius.md,
                paddingVertical: sp.xl, paddingHorizontal: sp.lg, alignItems: 'center',
              }}
            >
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Your main code</Text>
              <Text selectable style={{ ...value(40), color: t.ink, letterSpacing: 6 }}>
                {give.hand.code}
              </Text>
            </View>

            <View style={{ marginTop: sp.lg }}>
              <Cta label="Share the Invite" wide onPress={() => shareInvite(give.hand.code)} />
            </View>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
              {HAS_NATIVE_CLIPBOARD ? (
                <View style={{ flex: 1 }}>
                  <Ghost label="Copy the Link" onPress={() => { void copyLink(give.hand.code, 'your main code'); }} />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Ghost label="What It Brought In" onPress={() => router.push('/(trainer)/money')} />
              </View>
            </View>

            {/* No clipboard on this build: the address goes on the screen as
                selectable text rather than behind a button that does nothing.
                Same answer the Clients sheet already gives. */}
            {clipboardNote ? (
              <View style={{ marginTop: sp.lg }}>
                <Text selectable style={{ ...ty.body, ...numeric, color: t.ink2 }}>{give.hand.link}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{clipboardNote}</Text>
              </View>
            ) : null}
          </>) : give.why === 'reading' ? (
            // Still in flight. Not a failure, and deliberately not the same
            // sentence as one — a coach told the read failed while it is still
            // coming retries something that was going to arrive.
            <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.lg }}>
              <Text style={{ ...ty.head, color: t.ink }}>{give.head}</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{give.note}</Text>
            </View>
          ) : (
            // The whole reason this module exists. `give.note` states what is
            // NOT true — that the code is gone — and names what pressing New
            // Code would cost. There is deliberately no rotate button anywhere
            // on this screen: the one place it is offered is the Clients sheet,
            // where the read that would justify it has succeeded.
            <Notice tone={t.crit} kicker="Not read" title={give.head} note={give.note}>
              <View style={{ marginTop: sp.md }}>
                <Ghost label="Try Again" onPress={() => { void load(); }} />
              </View>
            </Notice>
          )}
        </Section>

        <Rule />

        {/* ── what the person in front of them does next ──────────────────── */}
        <Section>
          <SectionHead title="What They Do With It" />
          <Text style={{ ...ty.label, color: t.ink2 }}>{HOW_THEY_USE_IT}</Text>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Coaching Requests" onPress={() => router.push('/(trainer)/notifications')} />
          </View>
        </Section>

        <Rule />

        {/* ── the named codes, live ones only ─────────────────────────────── */}
        <Section>
          <SectionHead title="Your Named Codes" note={codes.status === 'ready' ? `${named.length}` : undefined} />
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{namedLine}</Text>

          {codes.status === 'partial' ? (
            <View style={{ marginBottom: sp.md }}>
              <PartialRead what="codes" shown={named.length} onPress={() => { void load(); }} />
            </View>
          ) : null}

          {named.map((r, i) => (
            <View
              key={r.code}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${r.label}. Code ${handOut(r.code).spoken}. ${codeCountLine(codes.status, r)}`}
              style={{
                paddingVertical: sp.md,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.label}</Text>
                  <Text selectable style={{ ...ty.head, ...numeric, color: t.ink2, letterSpacing: 2, marginTop: 2 }}>{r.code}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{codeCountLine(codes.status, r)}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                <View style={{ flex: 1 }}>
                  <Ghost label="Share" a11yLabel={`Share the invite for ${r.label}`} onPress={() => shareInvite(r.code)} />
                </View>
                {HAS_NATIVE_CLIPBOARD ? (
                  <View style={{ flex: 1 }}>
                    <Ghost label="Copy Link" a11yLabel={`Copy the link for ${r.label}`} onPress={() => { void copyLink(r.code, r.label); }} />
                  </View>
                ) : null}
              </View>
              {/* Without a clipboard the address is written out instead of
                  hidden — press and hold to select it. */}
              {clipboardNote ? (
                <Text selectable style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.sm }}>{handOut(r.code).link}</Text>
              ) : null}
            </View>
          ))}

          {/* Making one lives on the Clients tab, in the sheet that already
              creates them. Named rather than duplicated, because two screens
              that both create a code are two screens that can disagree about
              the cap. */}
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Make a Named Code" onPress={() => router.push('/(trainer)/dashboard')} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            On the Clients tab, under Invite a Client.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
