// Trainer · Leaderboard. Ranks the roster by a composite of adherence + weight
// progress toward goal. A lightweight cohort view. Reached from Analytics.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). The scoring, the roster provider, the route behind each
// row and the empty state are unchanged — only the presentation: the bordered
// per-client cards became hairline-separated rows, the Georgia serif header is
// gone, and the `MEDALS` lookup (which held the strings '1','2','3' and was
// drawn on top of a zero-width, negatively-offset rank label) is now just the
// rank, rendered once.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn } from '../../src/lib/units';
import { useRoster } from '../../src/ui/roster';

export default function Leaderboard() {
  // The COACH's unit, not the client's. This screen is read by the coach.
  const wu = useSettings().weightUnit;
  const t = useTheme();
  const router = useRouter();
  const { roster, status } = useRoster();

  // Composite: adherence (0-100) + a progress bonus (fat-loss clients rewarded
  // for negative weightDelta; others for positive).
  //
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
  const goalScore = (c: (typeof roster)[number]) => {
    const goalDown = /fat|tone/i.test(c.goal);
    return c.weightDelta == null ? null : (goalDown ? -c.weightDelta : c.weightDelta);
  };

  const scored = roster
    .filter((c) => c.adherence != null)
    .map((c) => {
      const prog = goalScore(c);
      // An absent progress figure earns no bonus, which is the same as a
      // measured-flat one earns — so the row says which of the two it is
      // rather than letting the number imply a scan that never happened.
      return { c, score: Math.round((c.adherence as number) + Math.max(0, prog ?? 0) * 4), scanned: prog != null };
    })
    .sort((a, b) => b.score - a.score);

  // Everyone the board cannot place. Not a failure state and not a ranking —
  // a list of people nothing has been recorded about yet.
  const unplaced = roster.filter((c) => c.adherence == null);

  const maxScore = Math.max(1, ...scored.map((s) => s.score));

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
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Adherence + progress toward goal</Text>

        <Rule />

        <Section>
          <SectionHead title="Ranking" note={scored.length ? `${scored.length} client${scored.length === 1 ? '' : 's'}` : undefined} />

          {/* An unread roster is not an empty one. Without this the screen tells
              a coach with a full book that they have no clients, which is the
              most expensive sentence it can say. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nothing is ranked below because the roster did not come back — it does not mean nobody is on your book." />
          ) : status === 'partial' ? (
            <Notice tone={t.warn} kicker="Roster" title="This board is built from part of your book"
              note="Your roster came back short, so the ranking below leaves people out and the order is not final." />
          ) : null}

          {scored.length === 0 && unplaced.length === 0 && status !== 'error' ? (
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

          {scored.map(({ c, score, scanned }, i) => (
            <Pressable key={c.id} onPress={() => router.push('/(trainer)/analytics')}
              accessibilityRole="button" accessibilityLabel={`${c.name}, rank ${i + 1}, score ${score}`}
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
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal} · {`${c.adherence}% adherence`} · {scanned ? `${(c.weightDelta as number) > 0 ? '+' : ''}${weightDeltaIn(c.weightDelta as number, wu)} ${wu}` : 'no scans — progress not counted'}</Text>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden', marginTop: 7 }}>
                  <View style={{ height: 3, borderRadius: 2, backgroundColor: t.brand, width: `${Math.round((score / maxScore) * 100)}%` }} />
                </View>
              </View>
              <Text style={{ ...value(18), color: t.ink }}>{score}</Text>
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
