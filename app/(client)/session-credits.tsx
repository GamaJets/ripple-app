// Client · Session credits. What paid for the sessions you have had, and what
// is going to pay for the ones you have booked.
//
// ── Why this screen exists ────────────────────────────────────────────────
//
// The balance was already on two screens — Memberships & Packs and Personal
// Training — and the DATES were on neither. A client could read "4 sessions
// remaining" and had no way to answer either of the two questions that
// actually come next: which hours used the other six, and which of the ones in
// my diary are going to use the four.
//
// The link has existed since supabase/parts/193 (`sessions.pack_drawn_at`,
// `pack_drawn_purchase_id`) and nothing rendered it. Part 370 extends it to a
// gym-sold pass and to the one-offs a coach books, so there is now one ledger
// that reads the same whether the pack came from the coach or from the gym.
//
// ── Past and future are different sentences ───────────────────────────────
//
// A drawn credit is a fact with a date. An upcoming booking is an EXPECTATION,
// and a cancellation can still change it. Part 135's header refuses to draw
// credits 56 days ahead precisely because a ten-pack would look empty inside a
// fortnight, and the same argument forbids this screen from printing an
// upcoming session as though its credit were already gone. Every sentence here
// comes from `src/lib/sessionCredits.ts`, so the promise made at the moment of
// booking and the wording in this list cannot drift apart.
//
// ── Three states, never two ───────────────────────────────────────────────
//
// `left` is `number | null` and the ledger is `Ledger | null`. A read that
// failed is a dash and a written reason, never a zero and never an empty list:
// "0 left" tells somebody who has paid that they have used everything, and an
// empty ledger under a failed read tells somebody who has had nine sessions
// that they have never had one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Hero, Card, Ghost, Flag, Notice, fig } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { appLocale } from '../../src/lib/locale';
import { fmtFullDay } from '../../src/lib/format';
import { sessionPacks, myPtPasses, mySessionCredits, type PtPassRow } from '../../src/lib/connect';
import { bookableCredits, creditsHeroNote, routeReason,
  buildLedger, expectedDraws, clientLedgerLine, shortfallLine,
  type CreditRoute, type CreditSession, type Ledger, type LedgerRow } from '../../src/lib/sessionCredits';
import type { PackBalance } from '../../src/lib/packDraw';
import { withDeadline } from '../../src/lib/readDeadline';
import { packDeadline, bookedBy } from '../../src/lib/packDeadline';
import { useToday } from '../../src/ui/today';
import { Fetched } from '../../src/ui/fetched';
import { useReadStamp } from '../../src/ui/readStamp';
import type { LoadStatus } from '../../src/ui/loadStatus';

// The day used to judge whether a gym pass is still live was a private copy of
// `todayIso` built here — local, correctly, because a pass expires on a date at
// the gym and not at an instant in UTC, but computed ONCE per render on a screen
// that has no reason to render again.
//
// That is the shape src/ui/today.ts exists to replace, and this screen is a
// sharper case than the label it looked like. `today` is the argument to
// `gymPtLines`, which is what `chooseRoute` weighs against the coach's pack —
// so the stale day does not merely mislabel a pass, it decides WHOSE MONEY pays
// for the next session. A gym pass that ran out at midnight goes on being
// offered as the payer, and the booking made against it is one the gym will
// refuse at the door while the member's coach pack sits unspent beside it.
//
// `useToday` re-reads the day at the next local midnight and on every return to
// the foreground, which is when this screen is actually being looked at.

const when = (iso: string) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  // `appLocale()`, never a literal tag — a client in Milan reads their own
  // dates, and `check:locale` fails on a hardcoded one.
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
};

export default function SessionCredits() {
  const t = useTheme();
  const router = useRouter();

  // Every one of the three reads is three-state. `undefined` is still loading,
  // `null` is a read that did not land, and a value is an answer.
  const [packs, setPacks] = useState<PackBalance | null | undefined>(undefined);
  const [passes, setPasses] = useState<PtPassRow[] | null | undefined>(undefined);
  const [sessions, setSessions] = useState<CreditSession[] | null | undefined>(undefined);

  // ── The read has an ending ────────────────────────────────────────────
  //
  // All three of these swallow their own failures and hand back null, so the
  // only way this screen could stay on "Reading what pays for your sessions…"
  // was a request that never SETTLED at all — and no request in this app
  // carries a timeout (src/lib/readDeadline.ts). On a gym wifi behind a captive
  // portal the socket is accepted and nothing comes back, `Promise.all` waits
  // for ever, all three stay `undefined`, and a member trying to find out
  // whether they have a session left before they book one is shown a sentence
  // that never resolves — with the "Try Again" button below gated on
  // `!loading`, so there is not even a way to ask again.
  //
  // A stall is `null`, which is the same three-state answer a refused read
  // already produces, and the notice with the retry in it is already written.
  const load = useCallback(async () => {
    const got = await withDeadline(Promise.all([sessionPacks(), myPtPasses(), mySessionCredits()]));
    if (!got.answered) {
      // Only where there was nothing to lose. A pull-to-refresh that stalls over
      // a balance already on screen must not blank it — src/lib/staleRead.ts
      // makes that argument in full, and this is somebody's money: an unread
      // refresh does not mean the credits stopped existing.
      setPacks((v) => (v === undefined ? null : v));
      setPasses((v) => (v === undefined ? null : v));
      setSessions((v) => (v === undefined ? null : v));
      return;
    }
    const [p, g, s] = got.value;
    setPacks(p); setPasses(g); setSessions(s);
  }, []);
  useEffect(() => { load(); }, [load]);
  const pull = usePullToRefresh(load);

  const today = useToday();

  // The choice and the count, made once, by the same rule the database makes
  // it: an entitlement that names both parties wins, and an EMPTY coach pack
  // still beats a live gym pass rather than quietly spending the gym's money.
  //
  // This composition used to live here and only here, spelled out in four
  // `useMemo`s — which is exactly why `packages.tsx` and `pt-sessions.tsx`,
  // which had no reason to know it existed, each read `client_purchases` alone
  // and told a gym-pass member they had nothing. It is `bookableCredits` now,
  // and all three call it.
  const book = useMemo(
    () => bookableCredits(packs === undefined ? null : (packs?.lines ?? null),
                          passes === undefined ? null : passes, today),
    [packs, passes, today]);
  const route: CreditRoute = book.route;
  const lines = book.lines;
  const left = book.left;
  const ledger: Ledger | null = useMemo(
    () => (sessions === undefined ? null : buildLedger(sessions, route)), [sessions, route]);
  const expected = useMemo(() => expectedDraws(ledger), [ledger]);
  const shortfalls = useMemo(() => shortfallLine(ledger), [ledger]);

  // ── whether a closing window is actually going to cost this member ─────
  //
  // The list below already prints "Expires 12 Sep" under a pack, which is the
  // fact. The question a member has when they read it is not when it ends but
  // whether they are going to lose any of it, and that needs their diary as
  // well as the date — both of which this screen is already holding and neither
  // of which anything was putting together. src/lib/packDeadline.ts is the
  // arithmetic, and packExpiry's own header is the argument for doing it: a
  // pack that lapses with sessions on it is "a conversation, not a zero", and
  // the coach's half of that conversation was the only half that existed.
  //
  // `bookedByThen` is null unless there is exactly ONE pack with a window. An
  // upcoming booking is not attributed to a pack until it actually draws —
  // `LedgerRow.entitlementId` is null for everything that has not moved — so
  // with two windows in play there is no honest way to say which pack a
  // Thursday session is going to spend, and "all of them are booked" is the one
  // sentence here that could talk somebody out of acting. Null there produces
  // the deadline without the coverage claim.
  const windowed = useMemo(() => (lines ?? []).filter((l) => l.expiresOn), [lines]);
  const soleWindow = windowed.length === 1 ? windowed[0] : null;
  const deadline = useMemo(() => {
    if (!soleWindow) return null;
    // The diary must have been READ to be counted. `ledger` is null for a read
    // that did not land, and counting zero bookings out of that would report
    // the worst case as a fact.
    const booked = ledger ? bookedBy(ledger.upcoming, soleWindow.expiresOn) : null;
    return packDeadline({
      left: soleWindow.left,
      expiresOn: soleWindow.expiresOn,
      today,
      bookedByThen: booked,
    });
  }, [soleWindow, ledger, today]);

  const loading = packs === undefined || passes === undefined || sessions === undefined;

  // ── when this number was last confirmed ───────────────────────────────
  //
  // A read stamp on a money figure is a strong claim, so it is worth saying why
  // this screen earns one and what it is answering.
  //
  // `load` above deliberately does NOT blank what is on screen when a
  // pull-to-refresh stalls: `setPacks((v) => (v === undefined ? null : v))`
  // keeps the balance, on the argument in src/lib/staleRead.ts that an unread
  // refresh does not mean the credits stopped existing. That is right, and it
  // leaves a hole: the member pulls down, the request never lands, the same
  // four sits there, and nothing on the screen has changed. `balanceUnread` is
  // false — the values are real — so not one of the banners fires. The stamp is
  // the only thing that can say "this is the four we read eleven minutes ago",
  // and it comes with the Refresh that failed gesture's affordance beside it.
  //
  // The rule `src/lib/readStamp.ts` keeps is exactly the one this needs: the
  // stamp is the last read that LANDED, never the last attempt. A stall leaves
  // `packs` pointing at the same object it already held, so neither the status
  // nor the token changes and the stamp correctly does not move.
  //
  // The status is synthesised because these three are plain reads rather than a
  // provider — the same three states the rest of the screen already branches
  // on, named once so the stamp cannot disagree with the banners.
  const readStatus: LoadStatus = loading ? 'loading'
    : (packs === null || passes === null || sessions === null) ? 'error' : 'ready';
  // `packs` as the token: `load` reassigns all three together on every read
  // that lands, so its identity moves exactly when a read has landed and at no
  // other time.
  const { at: readAt, busy: readBusy } = useReadStamp(readStatus, packs);
  // Named separately from `loading`, because "still reading" and "we asked and
  // could not get an answer" are different sentences and only one of them is
  // about somebody's money.
  //
  // ── two failures, two sentences ───────────────────────────────────────
  //
  // This was one flag over all three reads, and the banner it raised said
  // "Nothing below is a figure you should plan against until it loads." Two of
  // the reads are the BALANCE and one is the DIARY, and they fail
  // independently: a member whose session history would not load, holding a
  // perfectly readable four sessions, was told not to trust the four. That is
  // the same collapse `PartialRead` exists to stop, pointed at a figure instead
  // of a list — and being wrong in the cautious direction is still being wrong
  // about somebody's money, because the member's next move is to not book.
  const balanceUnread = !loading && (packs === null || passes === null);
  const historyUnread = !loading && sessions === null;

  const labelFor = (row: LedgerRow): string | null => {
    if (!row.entitlementId || !lines) return null;
    return lines.find((l) => l.id === row.entitlementId)?.label ?? null;
  };

  const Row = ({ row }: { row: LedgerRow }) => (
    <View style={{ paddingVertical: sp.md }}>
      <Text style={{ ...ty.label, color: t.ink }}>{when(row.startsAt)}</Text>
      <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3 }}>{clientLedgerLine(row, labelFor(row))}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: sp.xxl * 2 }} refreshControl={pull}>
        <Text style={{ ...ty.title, color: t.ink }}>Session Credits</Text>
        {/* Under the title rather than under the figure: it is a statement
            about everything below it, and a member deciding whether to book is
            owed it before they read the number rather than after. */}
        <Fetched at={readAt} onRefresh={load} busy={readBusy} />

        {loading ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>Reading what pays for your sessions…</Text>
        ) : null}

        {/* A hero only over a figure the database actually gave us. `left` is
            null for an unread balance, and a hero reading 0 would tell a client
            holding ten that they have none. */}
        {!loading && left != null && lines && lines.length > 0 ? (
          /* The note through `creditsHeroNote`, which the other two screens
             also use. It called every entitlement a "pack", including a gym
             PT pass — a pass is not a pack and the gym did not sell them one —
             and the wording now names the business whose credit it is. */
          <Hero label="Sessions Remaining" figure={fig(left)} note={creditsHeroNote(book, expected) ?? ''} />
        ) : null}

        {balanceUnread ? (
          <Notice tone={t.warn} kicker="Not read" title="We could not read your credits"
            note="This is our end, not a statement about what you have bought. There is no balance above to plan against until it loads.">
            <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={load} /></View>
          </Notice>
        ) : null}

        {/* The diary, separately, and only when the balance is fine — with both
            gone the banner above already covers it and two panels stacked say
            less than one. The lists below are absent rather than empty in this
            state, which is the point: an empty ledger under a failed read reads
            as "you have never used a session" to somebody who has used nine. */}
        {historyUnread && !balanceUnread ? (
          <Notice tone={t.warn} kicker="Not read" title="We could not read your session history"
            note="Your balance above did load and is current. What is missing is the list of which sessions used a credit and which of your bookings are due to draw one.">
            <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={load} /></View>
          </Notice>
        ) : null}

        {!loading && !balanceUnread && route === 'none' ? (
          <Card style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.label, color: t.ink }}>You are not on a session pack.</Text>
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: 4 }}>
              Nothing comes off a balance when you train. You settle sessions with your coach or your gym
              directly, which is an ordinary way to pay and not something to fix.
            </Text>
          </Card>
        ) : null}

        {!loading && !balanceUnread && route !== 'none' ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{routeReason(route)}</Text>
        ) : null}

        {/* The one line that needs acting on, and it is never a reassuring
            zero: `shortfallLine` is null both for no shortfalls and for a
            ledger nobody could read. */}
        {shortfalls ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.warn}>{shortfalls} Your coach delivered those hours and nothing paid for them.</Flag>
          </View>
        ) : null}

        {/* Above the list rather than under the row it is about, because it is
            the thing to act on and the list is the working behind it. A
            'covered' deadline is the reassuring answer and is drawn quietly;
            everything else is the member's own money about to go unused. */}
        {deadline && deadline.text ? (
          <View style={{ marginTop: sp.lg }}>
            {deadline.urgent ? (
              <Flag tone={t.warn}>{deadline.text}</Flag>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3 }}>{deadline.text}</Text>
            )}
            {deadline.kind === 'toBook' || deadline.kind === 'tight' ? (
              <View style={{ marginTop: sp.md, flexDirection: 'row' }}>
                {/* 'tight' points at the coach and 'toBook' at the calendar,
                    because at more sessions than days a booking screen is not
                    the thing that helps. */}
                {deadline.kind === 'tight'
                  ? <Ghost label="Message Your Coach" onPress={() => router.push('/(client)/messages')} />
                  : <Ghost label="Book a Session" onPress={() => router.push('/(client)/calendar')} />}
              </View>
            ) : null}
          </View>
        ) : null}

        {lines && lines.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="What Is Left" />
            {lines.map((l) => (
              <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.md }}>
                <View style={{ flex: 1, paddingEnd: sp.md }}>
                  <Text style={{ ...ty.label, color: t.ink }}>{l.label}</Text>
                  {l.expiresOn ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                      {/* `fmtFullDay`, which reads through src/lib/localDate.ts.
                          `gym_passes.expires_on` and a pack's expiry are both
                          bare `YYYY-MM-DD`, and `new Date('2026-08-01')` is UTC
                          midnight — which every local getter west of Greenwich
                          then reads back as 31 July. So a member in New York
                          was told their pack expired the day before it does,
                          about the last session they have paid for. */}
                      Expires {fmtFullDay(l.expiresOn)}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ ...ty.label, color: t.ink2 }}>{`${l.left} of ${l.sessions_total}`}</Text>
              </View>
            ))}
          </Section>
        </>) : null}

        {ledger && ledger.upcoming.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Booked" note="What these are expected to draw" />
            {ledger.upcoming.map((r) => <Row key={r.sessionId} row={r} />)}
          </Section>
        </>) : null}

        {ledger && ledger.past.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Already Had" note="What each one actually cost you" />
            {ledger.past.map((r) => <Row key={r.sessionId} row={r} />)}
          </Section>
        </>) : null}

        {/* Only over a ledger that WAS read. An empty list under a failed read
            would say "you have never used a session" to somebody who has used
            nine, so the unread banner above owns that case instead. */}
        {ledger && ledger.past.length === 0 && ledger.upcoming.length === 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            No sessions yet. Nothing has drawn a credit and nothing is booked to.
          </Text>
        ) : null}

        <Rule />
        <Section>
          <Ghost label="Memberships & Packs" onPress={() => router.push('/(client)/packages')} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Book a Session" onPress={() => router.push('/(client)/calendar')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
