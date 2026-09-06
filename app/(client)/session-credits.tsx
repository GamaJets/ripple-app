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
import { coachPackLines, gymPtLines, chooseRoute, routeReason, creditsLeft, payingLines,
  buildLedger, expectedDraws, clientLedgerLine, shortfallLine,
  entitlementWindowLine, creditsEmptyLine, creditsHeroNote,
  type CreditRoute, type CreditSession, type Entitlement, type Ledger, type LedgerRow } from '../../src/lib/sessionCredits';
import type { PackBalance } from '../../src/lib/packDraw';

/** The day used to judge whether a gym pass is still live. Local, because a
 *  pass expires on a date at the gym and not at an instant in UTC. */
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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

  const load = useCallback(async () => {
    const [p, g, s] = await Promise.all([sessionPacks(), myPtPasses(), mySessionCredits()]);
    setPacks(p); setPasses(g); setSessions(s);
  }, []);
  useEffect(() => { load(); }, [load]);
  const pull = usePullToRefresh(load);

  const today = todayISO();

  const coachLines: Entitlement[] | null = useMemo(
    () => (packs === undefined ? null : coachPackLines(packs?.lines ?? null)), [packs]);
  const gymLines: Entitlement[] | null = useMemo(
    () => (passes === undefined ? null : gymPtLines(passes, today)), [passes, today]);

  // The choice, made once, by the same rule the database makes it: an
  // entitlement that names both parties wins, and an EMPTY coach pack still
  // beats a live gym pass rather than quietly spending the gym's money.
  const route: CreditRoute = useMemo(
    () => chooseRoute(coachLines == null ? null : coachLines.length > 0,
                      gymLines == null ? null : gymLines.length > 0),
    [coachLines, gymLines]);

  const lines = useMemo(() => payingLines(route, coachLines, gymLines), [route, coachLines, gymLines]);
  const left = useMemo(() => creditsLeft(lines), [lines]);
  const ledger: Ledger | null = useMemo(
    () => (sessions === undefined ? null : buildLedger(sessions, route)), [sessions, route]);
  const expected = useMemo(() => expectedDraws(ledger), [ledger]);
  const shortfalls = useMemo(() => shortfallLine(ledger), [ledger]);
  // Why the balance is nought, when the reason is a window that closed rather
  // than a pack somebody used up. Null in every other case, including the
  // ordinary nought of a pack fully spent, which needs no explaining.
  const emptyReason = useMemo(() => creditsEmptyLine(lines), [lines]);

  const loading = packs === undefined || passes === undefined || sessions === undefined;
  // Named separately from `loading`, because "still reading" and "we asked and
  // could not get an answer" are different sentences and only one of them is
  // about somebody's money.
  const unread = !loading && (packs === null || passes === null || sessions === null);

  const labelFor = (row: LedgerRow): string | null => {
    if (!row.entitlementId || !lines) return null;
    return lines.find((l) => l.id === row.entitlementId)?.label ?? null;
  };

  // One entitlement and its own window. A pack whose window has closed is
  // LISTED rather than hidden, because part 370 still picks it and a screen
  // that dropped it would name a different payer from the server. The price of
  // listing it is that it must not read like a live one: dimmed to the quiet
  // ink the rest of this screen uses for what is no longer in play, and its
  // caption flagged, because "Expires 14 Aug 2026" printed in September beside
  // "0 of 10" is this app promising a member something it cannot give them.
  const Line = ({ l }: { l: Entitlement }) => {
    const windowLine = l.expiresOn ? entitlementWindowLine(l, fmtFullDay(l.expiresOn)) : null;
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.md }}>
        <View style={{ flex: 1, paddingRight: sp.md }}>
          <Text style={{ ...ty.label, color: l.expired ? t.ink3 : t.ink }}>{l.label}</Text>
          {windowLine == null ? null : l.expired ? (
            // A mark in the warn tone beside ink-coloured text, never warn as
            // the text colour itself — the rule `Flag` exists to keep.
            <Flag tone={t.warn} style={{ marginTop: 3 }}>{windowLine}</Flag>
          ) : (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{windowLine}</Text>
          )}
        </View>
        <Text style={{ ...ty.label, color: l.expired ? t.ink3 : t.ink2 }}>{`${l.left} of ${l.sessions_total}`}</Text>
      </View>
    );
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

        {loading ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>Reading what pays for your sessions…</Text>
        ) : null}

        {/* A hero only over a figure the database actually gave us. `left` is
            null for an unread balance, and a hero reading 0 would tell a client
            holding ten that they have none. */}
        {!loading && left != null && lines && lines.length > 0 ? (
          <Hero label="Sessions Remaining" figure={fig(left)}
            note={creditsHeroNote(lines, expected) ?? undefined} />
        ) : null}

        {unread ? (
          <Notice tone={t.warn} kicker="Not read" title="We could not read your credits"
            note="This is our end, not a statement about what you have bought. Nothing below is a figure you should plan against until it loads.">
            <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={load} /></View>
          </Notice>
        ) : null}

        {!loading && !unread && route === 'none' ? (
          <Card style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.label, color: t.ink }}>You are not on a session pack.</Text>
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: 4 }}>
              Nothing comes off a balance when you train. You settle sessions with your coach or your gym
              directly, which is an ordinary way to pay and not something to fix.
            </Text>
          </Card>
        ) : null}

        {!loading && !unread && route !== 'none' ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{routeReason(route)}</Text>
        ) : null}

        {/* The sentence that explains the nought above it, and only when a
            closed window is what made it nought. It sits under the figure and
            over the list, because both of those are the nought it is about. */}
        {emptyReason ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.warn}>{emptyReason}</Flag>
          </View>
        ) : null}

        {/* The one line that needs acting on, and it is never a reassuring
            zero: `shortfallLine` is null both for no shortfalls and for a
            ledger nobody could read. */}
        {shortfalls ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.warn}>{shortfalls} Your coach delivered those hours and nothing paid for them.</Flag>
          </View>
        ) : null}

        {lines && lines.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="What Is Left" />
            {lines.map((l) => <Line key={l.id} l={l} />)}
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
