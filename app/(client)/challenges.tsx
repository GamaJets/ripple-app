// Client · Challenges. The gym's challenges, and your coach's, with the other
// athletes in them.
//
// Reachable from the dashboard and Explore. On the instrument-panel kit
// (`src/ui/kit`) and the scale (`src/theme/scale`).
//
// ── What changed, and what it is careful about ─────────────────────────────
//
// This screen used to read a constant. Three challenges compiled into the
// bundle, a countdown from a literal, and a "leaderboard" containing the reader
// and nobody else — with a footnote promising that other athletes would arrive
// "with the group-coaching update". Before that it listed six invented people
// and ranked the client against them.
//
// It now reads `my_challenges()` and `challenge_board()`. Three rules run
// through everything below and they are all the same rule wearing different
// clothes: DO NOT STATE A FACT ABOUT OTHER PEOPLE THAT THE READ DID NOT
// ESTABLISH.
//
//   · No figure — not a score, not a head count, not a rank — is printed unless
//     `status === 'ready'`. src/lib/challenges.ts owns those sentences and
//     src/lib/challenges.test.ts holds them to it.
//   · An empty list under 'error' is rendered as "we could not check", never as
//     "your gym is not running anything".
//   · The board is fetched only when the sheet is opened, and its own status
//     travels with it, because the list read succeeding says nothing about
//     whether the board read did.
//
// The other thing this screen owes the reader is what joining exposes. A
// leaderboard shows one person's activity to another; the note under the sheet
// says exactly what is shared (a first name and a score) and what is not, and
// it is the same sentence the test holds against the server's select list.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { num } from '../../src/lib/format';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Meter, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { useChallenges, type BoardResult, type ChallengeRow } from '../../src/ui/challenges';
import {
  BOARD_VISIBILITY_NOTE, SCORING_NOTE, canJoin, challengePhase, cohortLabel,
  rankLine, scoreText, standingLine, windowLine,
} from '../../src/lib/challenges';
import { notifySuccess } from '../../src/ui/haptics';

const EMPTY_BOARD: BoardResult = { rows: [], status: 'loading', message: null };

export default function Challenges() {
  const t = useTheme();
  const router = useRouter();
  const ch = useChallenges();
  const [open, setOpen] = useState<ChallengeRow | null>(null);
  const [board, setBoard] = useState<BoardResult>(EMPTY_BOARD);
  // What went wrong with the last Join or Leave. A write that silently did not
  // happen is the failure this replaces: the old screen toggled a local flag
  // and told the client they were in.
  const [notice, setNotice] = useState<string | null>(null);

  // The open sheet's row, re-read from the list so that a Join reflected in the
  // list is reflected in the sheet without a second source of truth.
  const sheet = open ? ch.challenges.find((c) => c.id === open.id) || open : null;

  // Depends on `ch.board` rather than on `ch`: the context value changes
  // identity on every list read, and hanging the effect below off the whole
  // context would refetch the open board each time the list refreshed.
  const fetchBoard = ch.board;
  const loadBoard = useCallback(async (id: string) => {
    setBoard(EMPTY_BOARD);
    setBoard(await fetchBoard(id));
  }, [fetchBoard]);

  useEffect(() => {
    if (!open) { setBoard(EMPTY_BOARD); return; }
    loadBoard(open.id);
  }, [open, loadBoard]);

  const doJoin = async (c: ChallengeRow) => {
    setNotice(null);
    const okJoin = await ch.join(c.id);
    if (!okJoin) { setNotice('That did not save. Check your connection and try again.'); return; }
    notifySuccess();
    if (open && open.id === c.id) loadBoard(c.id);
  };

  const doLeave = async (c: ChallengeRow) => {
    setNotice(null);
    const okLeave = await ch.leave(c.id);
    if (!okLeave) { setNotice('That did not save. Check your connection and try again.'); return; }
    if (open && open.id === c.id) setOpen(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>You, and everyone else in it</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Challenges</Text>
          </View>
        </View>

        <Section>
          <SectionHead title="Open Challenges" />

          {ch.status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.lg }}>Loading your challenges…</Text>
          ) : null}

          {/* A failed read says so and offers a retry. It does NOT say the gym
              is running nothing — that is a claim, and this does not know it. */}
          {ch.status === 'error' ? (
            <View style={{ paddingVertical: sp.lg }}>
              <Text style={{ ...ty.label, color: t.ink2 }}>We couldn’t check which challenges are running.</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>This is a connection problem, not an empty gym.</Text>
              <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
                <Ghost label="Try again" onPress={ch.reload} />
              </View>
            </View>
          ) : null}

          {/* Safe to say only under 'ready': the server answered, and the
              answer was none. */}
          {ch.status === 'ready' && ch.challenges.length === 0 ? (
            <View style={{ paddingVertical: sp.lg }}>
              <Text style={{ ...ty.label, color: t.ink2 }}>Nothing is running right now.</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                Your gym or your coach sets these up. When one opens it appears here.
              </Text>
            </View>
          ) : null}

          {ch.challenges.map((c, ci) => {
            const phase = challengePhase(c);
            return (
              <View key={c.id}>
                {ci > 0 ? <Rule /> : null}
                <View style={{ paddingVertical: sp.lg }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={c.icon as any} size={17} color={c.joined ? t.brand : t.ink2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={2}>
                        {cohortLabel(c)}{c.blurb ? ' · ' + c.blurb : ''}
                      </Text>
                    </View>
                  </View>

                  {/* The meter is only drawn from a score the server computed.
                      A null score under a ready read is rendered as a dash — it
                      must never fall back to zero, which on a board is last. */}
                  {ch.status === 'ready' && c.myScore != null ? (
                    <Meter label="Your Score" val={c.myScore} target={c.goal} unit={' ' + c.unit} dim={!c.joined} />
                  ) : (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.md }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>Your Score</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                        {scoreText(c.metric, null)} / {c.goal} {c.unit}
                      </Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sp.lg }}>
                    <Pressable onPress={() => setOpen(c)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <Icon name="trophy" size={14} color={t.ink3} />
                      <Text style={{ ...ty.label, color: t.ink2 }} numberOfLines={1}>{standingLine(ch.status, c)}</Text>
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{windowLine(c)}</Text>
                      {c.joined ? (
                        <Ghost label="Joined" onPress={() => doLeave(c)} />
                      ) : (
                        <Cta label={phase === 'upcoming' ? 'Join early' : 'Join'} disabled={!canJoin(c)} onPress={() => doJoin(c)} />
                      )}
                    </View>
                  </View>
                </View>
              </View>
            );
          })}

          {notice ? (
            <Text style={{ ...ty.caption, color: t.warn, marginTop: sp.md }}>{notice}</Text>
          ) : null}
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{SCORING_NOTE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{BOARD_VISIBILITY_NOTE}</Text>
        </Section>
      </ScrollView>

      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '80%', ...elevation.e2 }}>
          {sheet && (
            <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{cohortLabel(sheet)} · {windowLine(sheet)}</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{sheet.title}</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, marginBottom: sp.lg }}>{rankLine(board.status, board.rows)}</Text>

              {/* Not on the board yet. challenge_board() refuses with 42501 and
                  its own words rather than answering with an empty list, so
                  "you have not joined" can never be drawn as "nobody is here". */}
              {!sheet.joined ? (
                <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
                  Join to see the other athletes. Until you do, this challenge is just you against the goal —
                  your score so far is {scoreText(sheet.metric, sheet.myScore)} {sheet.unit} of {sheet.goal}.
                </Text>
              ) : null}

              {sheet.joined && board.status === 'loading' ? (
                <View style={{ paddingVertical: sp.lg, alignItems: 'flex-start' }}>
                  <ActivityIndicator color={t.ink3} />
                </View>
              ) : null}

              {sheet.joined && board.status === 'error' ? (
                <View style={{ paddingVertical: sp.md }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>The board could not be read.</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                    Nobody has been removed from it — we just could not reach it.
                  </Text>
                  <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                    <Ghost label="Try again" onPress={() => loadBoard(sheet.id)} />
                  </View>
                </View>
              ) : null}

              {board.status === 'ready' ? board.rows.map((r, i) => (
                <View key={`${r.place}-${r.name}-${i}`}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <Text style={{ ...value(15), color: t.ink3, width: 26 }}>{num(r.place)}</Text>
                    <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ ...ty.caption, fontWeight: '500', color: r.isMe ? t.brand : t.ink2 }}>{r.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <Text style={{ flex: 1, ...ty.body, fontWeight: r.isMe ? '500' : '400', color: r.isMe ? t.ink : t.ink2 }}>
                      {r.isMe ? 'You' : r.name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(15), color: t.ink }}>{scoreText(sheet.metric, r.score)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>{sheet.unit}</Text>
                    </View>
                  </View>
                </View>
              )) : null}

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{BOARD_VISIBILITY_NOTE}</Text>

              <View style={{ marginTop: sp.lg }}>
                {sheet.joined ? (
                  <Ghost label="Leave Challenge" onPress={() => doLeave(sheet)} />
                ) : (
                  <Cta label="Join Challenge" wide disabled={!canJoin(sheet)} onPress={() => doJoin(sheet)} />
                )}
              </View>
              {notice ? (
                <Text style={{ ...ty.caption, color: t.warn, marginTop: sp.md }}>{notice}</Text>
              ) : null}
              <Pressable onPress={() => setOpen(null)} style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
