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
//
// ── The conversation is kept now, and on the same terms as the member's ───
//
// This screen held its thread in one `useState` and nothing else, exactly as
// app/(client)/coach.tsx did, so a coach who asked what to fix this week could
// not reread the answer on Friday. Both halves are fixed together and by the
// same store (`useCoachChat`), because "does this product keep an answer" is
// not a question the two sides of it are allowed to answer differently.
//
// The side is part of the key, and that is not tidiness: a trainer trains, and
// this app deliberately has them self-track on the client screens rather than
// being promoted out of them, so one uid can legitimately hold a client-side
// thread about their own sleep and a coach-side thread about their own revenue.
// Keying on the account alone would let one screen restore the other's
// conversation. See src/lib/coachChat.ts.
import { useState, useRef, useMemo, useCallback } from 'react';
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
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import { type MyCurrency } from '../../src/lib/currencySource';
import { currencyForModel } from '../../src/lib/currencyForModel';
import { deliveredValue, monthToDate, sessionMonth } from '../../src/lib/coachRevenue';
import { askAboutMyBusiness, coachAvailable, type ChatMsg } from '../../src/lib/coach';
import { useCoachChat } from '../../src/ui/coachChat';
import { COACH_THREAD_KEPT_NOTE } from '../../src/lib/coachChat';
import {
  COACH_ASK_WHAT_GOES, COACH_ASK_WHAT_NEVER_GOES, COACH_ASK_NOT_ADVICE,
} from '../../src/lib/coachShare';
import { useEffect } from 'react';
import { BACK_ICON } from '../../src/ui/direction';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

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
  + 'Where a figure is null or says "unknown", say you were not given it rather than guessing. '
  // The same two rules the Monday digest carries, in the same words, because
  // they are about the same two fields and a second wording is a second
  // definition. sessionsDeliveredThisMonth is counted from recorded outcomes
  // now, not from the clock, and the unmarked ones are their own state.
  + 'sessionsDeliveredThisMonth counts only sessions whose outcome was recorded as completed — never describe it as '
  + 'sessions booked. sessionsStillUnmarked are sessions that happened and have no outcome recorded: they are neither '
  + 'delivered nor missed, so never add them to the delivered figure, and if there are any, say they are waiting to be '
  + 'marked. revenueAtOwnRate is those delivered sessions multiplied by the coach own session rate and is the coach own '
  + 'arithmetic, not a payout. Be short and specific.';

export default function TrainerAssistant() {
  const t = useTheme();
  const router = useRouter();
  const { ref: barRef, lift } = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);

  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  const { sessions, status: sessionsStatus, refresh: refreshSessions } = useSessions();
  const { sessionFee, reload: reloadProfile } = useMyTrainerProfile();

  // The same gate analytics.tsx uses, and the same reason: every figure here is
  // a sum or a count over one of these two sets, and a sum over part of a set
  // is not a smaller sum, it is a wrong one.
  const figureStatus = worstStatus(rosterStatus, sessionsStatus);
  const figuresWhole = isWhole(figureStatus);

  /**
   * What this coach is priced in, through the one resolver.
   *
   * Was `myTenantCurrency()`, which answers about a GYM. That was the whole
   * answer until part 940 gave a coach with no gym a currency of their own on
   * `trainers.currency`; since then this screen has been telling the model that
   * an independent coach's gym had not set one — about a gym that does not
   * exist — and the model, correctly following its instruction to state no
   * amount, wrote about that coach's business with every figure of money
   * removed from it. `fetchMyCurrency` applies the precedence rule in
   * src/lib/currencySource.ts: the gym first, always, and the coach's own
   * column only when there is provably no gym.
   *
   * The whole answer is held, not just the code, because the model is told
   * WHICH of six things is true when there is no code — see
   * src/lib/currencyForModel.ts. `null` is the read still in flight, which is
   * its own answer and not one of the six.
   */
  const [cur, setCur] = useState<MyCurrency | null>(null);
  const loadCurrency = useCallback(async () => { setCur(await fetchMyCurrency()); }, []);
  useEffect(() => { void loadCurrency(); }, [loadCurrency]);

  /* ── pull to refresh ─────────────────────────────────────────────────────
   *
   * This screen refuses to ask anything at all until the roster and the
   * sessions have both come back whole, and it says so in the notice below. A
   * coach whose roster read was refused therefore had an assistant that would
   * not answer for the rest of the session and no way to make it try again —
   * the one shape this gesture exists for. The session rate comes from the
   * profile and the currency from the tenant; both are read once and both are
   * asked for again here, because a refreshed roster paired with a stale rate
   * is a revenue figure with halves from different minutes.
   *
   * The stored conversation is not re-read: it lives on this handset, this
   * screen is the only thing that writes it, and there is no other copy of it
   * for a refresh to go and find. */
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([refreshRoster(), refreshSessions(), reloadProfile(), loadCurrency()]),
    [refreshRoster, refreshSessions, reloadProfile, loadCurrency],
  ));

  /**
   * The month, counted from what the record says became of each session.
   *
   * This screen was the last place in the app still inferring delivery from the
   * clock: `status === 'booked'` with a start time in the past, which counts a
   * no-show, a late cancellation and an hour nobody has marked as work that
   * happened. That is verbatim the inference src/lib/coachRevenue.ts was
   * written to end, and 33-session-outcomes.sql before it — and here it fed
   * PROSE and was then multiplied by the coach's own rate. A wrong figure in a
   * cell can be caught by a dash; a wrong figure in a paragraph a coach reads
   * on a Monday morning cannot be caught by anything.
   *
   * `now` is fixed for the render: the window's upper bound is "now", and a
   * bound that moved on every re-render would recompute the month against a
   * different instant each time.
   */
  const now = useMemo(() => new Date(), []);
  const { from: monthFrom, to: monthTo } = useMemo(() => monthToDate(now), [now]);
  const month = useMemo(
    () => sessionMonth(sessions, sessionsStatus, monthFrom, monthTo),
    [sessions, sessionsStatus, monthFrom, monthTo],
  );
  // Null unless the read was whole — `sessionMonth` enforces that itself, so no
  // caller can forget. `figuresWhole` still gates the roster-derived figures
  // below, which have no such guard of their own.
  const sessionsMo = month.delivered;
  /** Sessions that happened and carry no outcome. Its own field, never added to
   *  the one above and never dropped: a model handed only "delivered: 4" from a
   *  month with nine unmarked sessions writes a sentence about a quiet month. */
  const unmarkedMo = month.unmarked;
  const clients = figuresWhole ? roster.length : null;
  const adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  const avgAdh = figuresWhole && adhKnown.length
    ? Math.round(adhKnown.reduce((a, x) => a + x, 0) / adhKnown.length) : null;
  const revenue = deliveredValue(month, sessionFee);

  // Kept between visits, on this phone, under this account and under this side
  // of the app. `ready` is unconditionally true and `health` unconditionally
  // false: there is no consent question in front of this screen because there is
  // no health tier in what it sends — every field `askAboutMyBusiness` admits is
  // a count, a rate or an amount, and no client is named.
  const thread = useCoachChat('coach', { ready: true, health: false });
  const msgs = thread.msgs;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showsDetail, setShowsDetail] = useState(false);

  const send = async (text: string) => {
    const body = text.trim();
    // `thread.status` joins the gate: a question asked before the stored
    // conversation has come back would be answered against an empty history and
    // then have the restored one land underneath it.
    if (!body || busy || !figuresWhole || thread.status === 'loading') return;
    const next: ChatMsg[] = [...msgs, { role: 'user', content: body }];
    thread.set(next); setInput(''); setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 40);
    // Composed here and filtered in `askAboutMyBusiness`. Every value is
    // already null-or-real: a null reaches the model as an absent field and the
    // system prompt tells it to say so rather than fill the gap.
    const ctx = {
      sessionsDeliveredThisMonth: sessionsMo,
      sessionsStillUnmarked: unmarkedMo,
      revenueAtOwnRate: revenue ?? 'unknown — no session rate set',
      // Was `gymCur ?? 'unknown — the gym has not set one, so state no amount'`
      // — one sentence for six different states. Four of them it describes
      // wrongly, and the commonest since part 940 is a coach with NO GYM, who
      // was being described to the model as waiting on an owner who does not
      // exist. `currencyForModel` says which of the six it is, in the third
      // person, and every one of them still ends in "state no amount".
      currency: currencyForModel(cur),
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
    // `next` and not the current state: this function is the only writer of the
    // thread, and reading it back through a setter would race the write that
    // `set` has already started.
    thread.set([...next, {
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
            <Icon name={BACK_ICON} size={20} color={t.ink2} />
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

        <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} keyboardShouldPersistTaps="handled" refreshControl={pull}>

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

          {/* The stored conversation is still being read. Said rather than
              drawn as an empty thread under a row of opening suggestions,
              which would be this screen claiming the coach has never asked it
              anything. */}
          {thread.status === 'loading' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
              <ActivityIndicator color={t.brand} size="small" />
              <Text style={{ ...ty.caption, color: t.ink3 }}>Fetching your last conversation from this phone…</Text>
            </View>
          ) : null}

          {thread.status === 'partial' ? (
            <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
              An earlier conversation is saved on this phone and could not be read this time. It has been left alone rather than written over, so anything you ask now is not being kept — try again after the next restart.
            </Flag>
          ) : null}

          {figuresWhole && thread.status !== 'loading' && msgs.length === 0 ? (
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
            {/* Where the conversation itself is. Said here for the same
                reason the member's screen says it: a record nobody has been
                told about is a record nobody can decide to clear. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {thread.kept
                ? COACH_THREAD_KEPT_NOTE
                : 'This conversation is not being kept — it goes when you leave the screen, and it is not stored on our servers either.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              <Ghost label={showsDetail ? 'Hide the Detail' : 'What Gets Sent'} onPress={() => setShowsDetail((v) => !v)} />
              {msgs.length ? <Ghost label="Clear This Chat" onPress={() => thread.clear()} /> : null}
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
