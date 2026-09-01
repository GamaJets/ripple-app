// Trainer · Assistant — a conversation about the coach's own book.
//
// ── What the coach had ────────────────────────────────────────────────────
//
// Three one-shot buttons. Draft a nudge (dashboard), summarise a client
// (dashboard), and a Monday digest (analytics). Each takes a fixed prompt this
// app wrote, answers once, and cannot be asked a follow-up. The MEMBER has had
// a full conversational screen since app/(client)/coach.tsx shipped — the
// person with the simpler questions got the better interface.
//
// So this is that screen, on the coach's side, over the coach's own figures.
// Nothing new goes to the model that the digest did not already send; what
// changes is that the coach can ask a second question.
//
// ── The one thing this screen is careful about ────────────────────────────
//
// It never names a client. Not in the context, not in the reply, not in the
// suggestions. `askAboutMyBusiness` filters by allowlist (the coach-side half
// of src/lib/coachShare.ts) and every field it admits is a count, a rate or an
// amount — a fact about the coach's business rather than about a person in it.
//
// That is a real constraint and it is worth being straight about what it costs:
// this assistant cannot answer "who should I message first". It can answer "how
// many are drifting and what should I do about it", and the coach reads the
// names off their own roster, which is on the next screen and has never left
// their phone. A model that ranks a coach's clients by name is a model that has
// been given a list of named people's adherence, and nobody asked those people.
//
// The per-client questions ARE answerable — `askAboutClient` exists and the
// dashboard's Draft and Summary both use it — and they go through a filter that
// carries no name, no measurement and nothing off a document. This screen does
// not open that door as well, because a chat box with a client picker beside it
// is exactly where somebody would later paste a name into the prompt.
//
// ── Every figure is gated on a whole read ─────────────────────────────────
//
// The same rule analytics.tsx keeps, for a sharper reason: prose is not a
// dashboard. A dash on a screen is visibly missing; a paragraph written from a
// null is a confident sentence about a business that does not exist, and the
// coach has nothing to doubt about it. So the composer is withheld — not
// warned about — until the roster and the sessions have both come back whole.
import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Notice, Flag, Ghost } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
import { useRoster } from '../../src/ui/roster';
import { useSessions } from '../../src/ui/sessions';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { atRiskClient } from '../../src/lib/trainerMock';
import { myTenantCurrency } from '../../src/lib/subscriptions';
import { askAboutMyBusiness, coachAvailable, type ChatMsg } from '../../src/lib/coach';
import {
  COACH_ASK_WHAT_GOES, COACH_ASK_WHAT_NEVER_GOES, COACH_ASK_NOT_ADVICE,
} from '../../src/lib/coachShare';
import { useEffect } from 'react';

const SUGGESTIONS = [
  'How is my month going?',
  'What should I do about the clients who are drifting?',
  'Where is my time going, and is it worth it?',
  'What is the one thing to fix this week?',
];

const SYSTEM =
  'You are a business assistant for a self-employed fitness coach. Answer only from the figures in the context. '
  + 'Never invent a figure, never name a client (you have not been given any names), and never state an amount of money '
  + 'unless the currency field gives you an ISO code — write the code before the amount and never a currency symbol. '
  + 'Where a figure is null or says "unknown", say you were not given it rather than guessing. Be short and specific.';

export default function TrainerAssistant() {
  const t = useTheme();
  const router = useRouter();
  const { ref: barRef, lift } = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);

  const { roster, status: rosterStatus } = useRoster();
  const { sessions, status: sessionsStatus } = useSessions();
  const { sessionFee } = useMyTrainerProfile();

  // The same gate analytics.tsx uses, and the same reason: every figure here is
  // a sum or a count over one of these two sets, and a sum over part of a set
  // is not a smaller sum, it is a wrong one.
  const figureStatus = worstStatus(rosterStatus, sessionsStatus);
  const figuresWhole = isWhole(figureStatus);

  const [gymCur, setGymCur] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    myTenantCurrency().then((r) => { if (alive) setGymCur(r.currency); });
    return () => { alive = false; };
  }, []);

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const deliveredMo = sessions.filter((sx) => sx.status === 'booked'
    && Date.parse(sx.startsAt) >= monthStart.getTime()
    && Date.parse(sx.startsAt) <= Date.now());
  const sessionsMo = figuresWhole ? deliveredMo.length : null;
  const clients = figuresWhole ? roster.length : null;
  const adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  const avgAdh = figuresWhole && adhKnown.length
    ? Math.round(adhKnown.reduce((a, x) => a + x, 0) / adhKnown.length) : null;
  const revenue = sessionFee == null || sessionsMo == null ? null : sessionsMo * sessionFee;

  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showsDetail, setShowsDetail] = useState(false);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || busy || !figuresWhole) return;
    const next: ChatMsg[] = [...msgs, { role: 'user', content: body }];
    setMsgs(next); setInput(''); setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 40);
    // Composed here and filtered in `askAboutMyBusiness`. Every value is
    // already null-or-real: a null reaches the model as an absent field and the
    // system prompt tells it to say so rather than fill the gap.
    const ctx = {
      sessionsDeliveredThisMonth: sessionsMo,
      revenueAtOwnRate: revenue ?? 'unknown — no session rate set',
      currency: gymCur ?? 'unknown — the gym has not set one, so state no amount',
      clients,
      avgAdherence: avgAdh != null ? avgAdh + '%' : 'no check-ins yet',
      atRiskClients: figuresWhole ? roster.filter(atRiskClient).length : null,
      onTrack: figuresWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 85).length : null,
      watch: figuresWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 70 && c.adherence < 85).length : null,
      atRiskLow: figuresWhole ? roster.filter((c) => c.adherence != null && c.adherence < 70).length : null,
      unreadThreads: figuresWhole && !roster.some((c) => c.unread == null)
        ? roster.filter((c) => (c.unread ?? 0) > 0).length : null,
    };
    const answer = await askAboutMyBusiness([{ role: 'user', content: SYSTEM }, ...next], ctx);
    setBusy(false);
    setMsgs((p) => [...p, {
      role: 'assistant',
      content: answer.ok ? answer.reply
        : answer.reason === 'unavailable'
          ? 'The assistant is not switched on for this build, so nothing was sent and there is no answer. Every figure it would have used is on your Analytics screen.'
          : 'That did not reach the assistant, so nothing came back. Nothing about your business was left half-sent — try again in a moment.',
    }]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 40);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ flex: 1, paddingBottom: lift }}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
            <Icon name="back" size={20} color={t.ink2} />
          </Pressable>
          <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={t.brandInk} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.head, color: t.ink }}>Assistant</Text>
            {/* A claim about what the model has, so it answers to the reads. */}
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {figuresWhole ? 'Working from your own figures' : 'Waiting on your figures'}
            </Text>
          </View>
        </View>
        <Rule />

        <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} keyboardShouldPersistTaps="handled">

          {/* Withheld rather than warned about. A paragraph written from nulls
              is a confident answer about a business that does not exist, and
              there is nothing on it for a coach to doubt. */}
          {!figuresWhole ? (
            <Notice tone={t.warn} kicker="Your figures" title="Not enough has been read to answer from"
              note={figureStatus === 'loading'
                ? 'Still reading your roster and your sessions. Nothing is asked until both have come back, because an answer written from half of them would read exactly like an answer written from all of them.'
                : figureStatus === 'partial'
                  ? 'Your roster or your sessions came back at the row limit, so every count here would be a count of what happened to load. Prose does not show its own gaps the way a dash does, so nothing is asked until the whole set can be read.'
                  : 'Your roster or your sessions did not come back at all. That is unknown rather than zero, and an assistant told zero would write you a paragraph about a business with nobody in it.'} />
          ) : null}

          {!coachAvailable() ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              The assistant is not switched on for this build. Nothing is sent anywhere and no question is answered — your figures are all on the Analytics screen.
            </Flag>
          ) : null}

          {msgs.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: sp.md }}>
              <View style={{ maxWidth: '82%', backgroundColor: m.role === 'user' ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                <Text style={{ ...ty.body, color: m.role === 'user' ? t.brandInk : t.ink }}>{m.content}</Text>
              </View>
            </View>
          ))}

          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 2 }}>
              <ActivityIndicator color={t.brand} size="small" />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Working through your figures…</Text>
            </View>
          ) : null}

          {figuresWhole && msgs.length === 0 ? (
            <View style={{ marginTop: sp.md, gap: sp.sm }}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => { void send(s); }} accessibilityRole="button" accessibilityLabel={s}
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* What leaves the phone, said on the screen that sends it. The
              member's coach carries the same disclosure for the same reason:
              a list of what is sent that lives only in a source file is a list
              nobody has been shown. */}
          <View style={{ marginTop: sp.xl, borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              No client is named to the assistant, so it cannot tell you who to message — it can tell you how many and what to do, and the names are on your own roster.
            </Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center' }}>
              <Ghost label={showsDetail ? 'Hide the Detail' : 'What Gets Sent'} onPress={() => setShowsDetail((v) => !v)} />
            </View>
            {showsDetail ? (
              <View style={{ marginTop: sp.sm, gap: sp.sm }}>
                <Text style={{ ...ty.caption, color: t.ink2 }}>{COACH_ASK_WHAT_GOES}</Text>
                <Text style={{ ...ty.caption, color: t.ink2 }}>{COACH_ASK_WHAT_NEVER_GOES}</Text>
                <Text style={{ ...ty.caption, color: t.ink3 }}>{COACH_ASK_NOT_ADVICE}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* No composer until there is something honest to answer from. A box a
            coach can type into is a promise that send will do something. */}
        {figuresWhole ? (
          <View>
            <Rule />
            <View ref={barRef} style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'flex-end' }}>
              <TextInput value={input} onChangeText={setInput} placeholder="Ask about your book…" placeholderTextColor={t.ink3} multiline
                style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md, maxHeight: 120 }} />
              <Pressable onPress={() => { void send(input); }} disabled={!input.trim() || busy}
                accessibilityRole="button" accessibilityLabel="Send question"
                style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: input.trim() && !busy ? t.brand : t.surface3, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.head, color: t.brandInk }}>↑</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
