// Trainer · Leaderboard. Orders the roster by the one figure on it that is a
// stated measurement, and shows everything else beside that figure rather than
// inside it. Reached from Analytics.
//
// ── THE COMPOSITE THAT USED TO BE HERE ────────────────────────────────────
//
// `Math.round(adherence + Math.max(0, prog ?? 0) * 4)`, where `adherence` is
// 0–100 and `prog` is a weight delta in KILOGRAMS. Four points per kilogram,
// added to a percentage. The coefficient was written nowhere, derived from
// nothing, and could not be — there is no exchange rate between a kilogram and
// a percentage point, so the number it produced was not a quantity of anything.
// It was then rendered as `score / maxScore` under a progress bar, which reads
// as a proportion of something achievable, and printed at the end of the row in
// the same weight this app prints real figures in.
//
// Two clients could not be compared by it either. A client who lost 3 kg toward
// a fat-loss goal scored twelve points above one who lost none, and a client
// working on strength who GAINED 3 kg scored the same twelve — for the opposite
// movement, because `goalScore` flips the sign. That is defensible as a
// direction and indefensible as an addend: it means the board's order changed
// by an amount nobody chose, in units that do not exist, on a screen a coach
// uses to decide who to ring.
//
// So there is no composite. The order is the client's own most recent check-in
// rating and nothing else, the bar is that rating against its own scale rather
// than against the top of the board, and the weight movement is a fact printed
// beside the name rather than a term in a sum. Nothing here invents a number.
//
// ── AND THE ROW WENT NOWHERE ──────────────────────────────────────────────
//
// Every ranked row pushed `/(trainer)/analytics` — the same screen for every
// client on the board — so a coach who spotted somebody sliding down it tapped
// their name and landed on a page that says nothing about that person. The
// unranked rows below already opened that client's own thread. Both do now.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn } from '../../src/lib/units';
import { deltaLabel } from '../../src/lib/deltaLabel';
import { useRoster } from '../../src/ui/roster';
import { isWhole } from '../../src/ui/loadStatus';

export default function Leaderboard() {
  // The COACH's unit, not the client's. This screen is read by the coach.
  const wu = useSettings().weightUnit;
  const t = useTheme();
  const router = useRouter();
  const { roster, status } = useRoster();

  // ── Who can be ranked at all ──────────────────────────────────────────────
  //
  // `adherence` is null when a client has never submitted a check-in, and
  // `weightDelta` is null when they have never been scanned. This screen used
  // to score those as `adherence ?? 0`, which reads as a real measurement: a
  // client nobody has heard from ranked last, below everybody, indistinguishable
  // from one who checks in every week and reports zero. The comment defending it
  // argued against the OTHER default — an earlier version handed them 100, so
  // strangers outranked people who were training — and both are the same
  // mistake pointing in opposite directions.
  //
  // A ranking is a comparison, so it needs something measured to compare. With
  // no adherence on record there is nothing, and the honest answer is that this
  // client cannot be placed rather than that they came last. They are listed
  // below the board instead, with what is missing, which is also the more
  // useful thing for a coach to see: it names who to chase for a check-in.
  /**
   * Which way this client's weight moving counts as progress — a DIRECTION,
   * never a quantity.
   *
   * True for a fat-loss or toning goal and false otherwise, so a client working
   * on strength who has gained is going the way they meant to. It words the
   * line under the name and draws nothing else: the kilograms it describes are
   * not added to anything, because there is no rate at which a kilogram becomes
   * a percentage point.
   */
  const wantsLoss = (c: (typeof roster)[number]) => /fat|tone/i.test(c.goal);

  /**
   * The board, ordered on the client's own last check-in rating.
   *
   * `roster.adherence` is that rating and nothing more: the client picked 1 to
   * 5 on their most recent check-in and `useRoster` scales it to a percentage
   * because every trainer surface renders it as one. It is a self-report about
   * one day, it is the only figure on this row two clients can be compared by,
   * and the header says both of those things rather than letting the word
   * "leaderboard" imply a measurement nobody took.
   *
   * The tie-break is the name, so two clients on the same rating hold a stable
   * order between renders. Without one the board reshuffles people who have
   * done nothing, which reads as movement.
   */
  const scored = roster
    .filter((c) => c.adherence != null)
    .map((c) => ({ c, rating: c.adherence as number, scanned: c.weightDelta != null }))
    .sort((a, b) => b.rating - a.rating || a.c.name.localeCompare(b.c.name));

  // Everyone the board cannot place. Not a failure state and not a ranking —
  // a list of people nothing has been recorded about yet.
  const unplaced = roster.filter((c) => c.adherence == null);

  /** That client's own thread. The same destination the unranked rows below
   *  have always used, and the one thing a coach who has just spotted somebody
   *  sliding down the board actually wants. */
  const openClient = (c: (typeof roster)[number]) =>
    router.push({ pathname: '/(trainer)/chat', params: { clientId: c.id, name: c.name } });

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your roster</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Leaderboard</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Ordered by the last check-in rating each client gave themselves</Text>

        <Rule />

        <Section>
          <SectionHead title="Ranking" note={scored.length ? `${scored.length} client${scored.length === 1 ? '' : 's'}` : undefined} />
          {/* What the order is, said before anybody reads it as a score. There
              is no composite behind this board and nothing on it was measured
              by the app: it is what each client last said about themselves, and
              a coach ringing somebody at the bottom of it is entitled to know
              that is what they are ringing about. */}
          {scored.length ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
              This is each client’s own rating from their most recent check-in, out of five and shown
              as a percentage. It is what they said about one day rather than something this app
              measured, and nothing else is folded into it. Weight movement is printed beside the
              name and is deliberately not added to it.
            </Text>
          ) : null}

          {/* An unread roster is not an empty one. Without this the screen tells
              a coach with a full book that they have no clients, which is the
              most expensive sentence it can say. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nothing is ranked below because the roster did not come back — it does not mean nobody is on your book." />
          ) : status === 'partial' ? (
            <Notice tone={t.warn} kicker="Roster" title="This board is built from part of your book"
              note="Your roster came back short, so the ranking below leaves people out and the order is not final." />
          ) : status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : null}

          {/* `isWhole`, not `!== 'error'`. `useRoster` starts as `[]` under
              'loading' and stays there through five-plus sequential round
              trips, so for the whole of every normal open this screen greeted a
              coach with "No clients yet" before it had asked — and under
              'partial' it would have said the same about a book that came back
              short. analytics.tsx gates the identical sentence on the identical
              provider with `rosterWhole`; this is that. */}
          {scored.length === 0 && unplaced.length === 0 && isWhole(status) ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No clients yet — your leaderboard fills in as clients join and log their workouts.
            </Text>
          ) : null}

          {scored.length === 0 && unplaced.length > 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody has checked in yet, so there is nothing to rank on. Everyone on your book is
              listed below.
            </Text>
          ) : null}

          {scored.map(({ c, rating, scanned }, i) => (
            <Pressable key={c.id} onPress={() => openClient(c)}
              accessibilityRole="button" accessibilityLabel={`${c.name}, rank ${i + 1}, last check-in rating ${rating} per cent. Opens their messages.`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <Text style={{ ...value(15), color: i === 0 ? t.brand : t.ink3, width: 20, textAlign: 'center' }}>{i + 1}</Text>
              <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                {/* The coach's own unit, not the client's — this row is read by
                    the coach, and app/(trainer)/client-training.tsx already
                    draws that distinction. The delta is stored in kilograms and
                    is converted as a SPAN through `weightDeltaIn`, so a genuine
                    0.4 kg move does not alternate between "0 lb" and "1 lb"
                    week to week off the back of nothing the client did. */}
                {/* Three facts, kept as three. Which direction counts as
                    progress depends on the goal and is said in words, because
                    it cannot honestly be said in a number. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal} · {`${rating}% last check-in`} · {scanned ? `${deltaLabel(weightDeltaIn(c.weightDelta as number, wu), { since: null, unit: wu, noChange: 'no change', noBaseline: 'no change' })}${wantsLoss(c) ? ', aiming down' : ', aiming up'}` : 'never scanned'}</Text>
                {/* The bar is the rating against its own scale — a hundred is a
                    five out of five — and never against the top of the board. A
                    bar drawn as a fraction of whoever happens to lead reads as a
                    gap to close, and it moves for everybody the moment one
                    person's figure changes. */}
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden', marginTop: 7 }}>
                  <View style={{ height: 3, borderRadius: 2, backgroundColor: t.brand, width: `${Math.max(0, Math.min(100, rating))}%` }} />
                </View>
              </View>
              <Text style={{ ...value(18), color: t.ink }}>{rating}%</Text>
            </Pressable>
          ))}
        </Section>

        {unplaced.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Not enough recorded to rank" note={`${unplaced.length}`} />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                These clients have never submitted a check-in, so there is no adherence to compare.
                That is not a low score — it is no score.
              </Text>
              {unplaced.map((c, i) => (
                <Pressable key={c.id} onPress={() => router.push({ pathname: '/(trainer)/chat', params: { clientId: c.id, name: c.name } })}
                  accessibilityRole="button" accessibilityLabel={`Message ${c.name}, who has not checked in`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.ink3 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, textTransform: 'capitalize' }}>{c.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {c.goal} · no check-ins{c.weightDelta == null ? ' · no scans yet' : ''}
                    </Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>—</Text>
                </Pressable>
              ))}
            </Section>
          </View>
        ) : null}

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Use the Broadcast button on Clients to celebrate the top of the board.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
