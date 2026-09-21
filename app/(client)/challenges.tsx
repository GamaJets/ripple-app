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
//
// ── The board's composition (19 Sep) ───────────────────────────────────────
//
// Board page 14 draws this screen as a centred title over an Active /
// Completed bar, then one row per challenge: a round icon, the name, a "Day 17
// of 30" caption and a thin green bar under it. That is the whole of the first
// viewport, so the list here is exactly that. Everything the row used to carry
// — the score meter, the standing line, Join and Leave — is one tap away in the
// sheet the row opens, which already held the board, the rank and the same two
// controls. Nothing was removed; the row stopped being a control panel.
//
// Round five (the approved look): each challenge is a CARD of its own, and the
// thin bar became a ring of the same fraction with the day inside it. The
// state is chips — Joined, and the head count under a ready read — and the two
// paragraphs of scoring and visibility prose moved behind one Expandable.
//
// The caption is COMPUTED, every render, from the row's own window and the
// live clock (`dayOf` below). It is not a stored figure, and it is not the
// score: a member three days into a thirty-day challenge is on day three
// whatever they have logged, and the bar under it is time elapsed, not
// progress made. The score is the sheet's business.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { num } from '../../src/lib/format';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, Card, Meter, Cta, Ghost, PageHead, Flag, Ring, TonedChip, Segmented, Expandable } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric, value, font } from '../../src/theme/scale';
import { useChallenges, type BoardResult, type ChallengeRow } from '../../src/ui/challenges';
import {
  BOARD_VISIBILITY_NOTE, SCORING_NOTE, canJoin, challengePhase, cohortLabel,
  rankLine, scoreText, standingLine, windowLine,
  challengeActionsAllowed, staleChallengeNote,
} from '../../src/lib/challenges';
import { notifySuccess } from '../../src/ui/haptics';
import { FORWARD_ICON } from '../../src/ui/direction';
import { useReachability } from '../../src/ui/reachability';
// The clock this screen judges every challenge against, kept live. See the note
// at `useNow()` below and src/ui/today.ts.
import { useNow } from '../../src/ui/today';
import { retryLine } from '../../src/lib/reachability';

const EMPTY_BOARD: BoardResult = { rows: [], status: 'loading', message: null };

const DAY = 86_400_000;

/**
 * "Day 17 of 30": where `now` falls inside one challenge's own window.
 *
 * Worked out from `startsAt` and `endsAt` — the two instants `shapeChallenges`
 * already refused to render a row without — and never read from a stored
 * field, so it cannot drift from the window it describes. Whole days, the
 * first day being day 1 rather than day 0, because that is how a person counts
 * them; the total is rounded UP so a window of 29½ days is a 30-day challenge
 * and not a 29-day one. Clamped at both ends: before the start it is day 1 of
 * N (the caption says "Starts in…" instead, see `phaseCaption`), and after the
 * end it stays at N of N rather than counting past the finish.
 *
 * Same arithmetic as `windowLine` in src/lib/challenges.ts, and it belongs
 * beside it with a test — kept here for now because that module is outside
 * this screen's lane.
 */
function dayOf(c: ChallengeRow, now: number): { day: number; total: number } {
  const total = Math.max(1, Math.ceil((c.endsAt - c.startsAt) / DAY));
  const day = Math.min(total, Math.max(1, Math.floor((now - c.startsAt) / DAY) + 1));
  return { day, total };
}

export default function Challenges() {
  const t = useTheme();
  const router = useRouter();
  const ch = useChallenges();
  // A failed read used to strand this screen for the whole session — the only
  // way to ask again was to leave and come back. Pull to refresh is the
  // gesture people already try; see src/ui/pullToRefresh.tsx.
  const pull = usePullToRefresh(useCallback(() => { ch.reload(); }, [ch]));
  const reach = useReachability();
  // ── the clock, and why it is state ────────────────────────────────────
  //
  // `challengePhase`, `canJoin` and `windowLine` all default their `now` to
  // `Date.now()`, which is right at the instant of a render and says nothing
  // about when the next one happens. This screen is registered `href: null`
  // (app/(client)/_layout.tsx), so it mounts once and is never torn down;
  // backgrounding the app does not unmount it either. Left open across a
  // midnight it went on saying "Last day" about a challenge that had closed,
  // and — worse, because it is a control rather than a caption — went on
  // offering a Join that `cp_self_join` refuses once `now() >= ends_at`. The
  // member taps it, the insert comes back with no rows, and the screen tells
  // them "that did not save" over a challenge that is simply over.
  //
  // This is the second half of the defect check:frozen-day catches, described
  // at the top of src/ui/today.ts: not a value frozen in a `useMemo`, but one
  // that is recomputed correctly on every render by a screen that has no reason
  // to render. `useNow` re-settles at the next local midnight and whenever the
  // app comes back to the foreground, which is both of the moments that matter.
  const now = useNow();
  const nowMs = now.getTime();
  // Which half of the list is showing. The board's two segments, and the split
  // is by PHASE, not by whether the member joined: a challenge that has not
  // started yet is something they can still act on, so it sits under Active
  // with a "Starts in…" caption rather than being hidden until it opens.
  const [tab, setTab] = useState<'active' | 'completed'>('active');
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
  // Which board fetch is the one still wanted. src/ui/challenges.tsx guards its
  // list read with exactly this `runRef`, and the sheet needed it more: open
  // challenge A, dismiss it, open B, and B's sheet would be handed A's rows and
  // A's rank the moment A's slower fetch resolved — a leaderboard is other
  // people's names and places, so the wrong board under the right title is the
  // one mistake this screen cannot make. Every result is now checked against
  // the run that asked for it, and the effect's cleanup retires the run when
  // the sheet changes or closes.
  const boardRun = useRef(0);
  const loadBoard = useCallback(async (id: string) => {
    const run = ++boardRun.current;
    setBoard(EMPTY_BOARD);
    const result = await fetchBoard(id);
    if (run !== boardRun.current) return;
    setBoard(result);
  }, [fetchBoard]);

  useEffect(() => {
    // The notice is about ONE challenge and names it: "You are not on Summer
    // Streak — that did not save". It was set by `doJoin`/`doLeave` and cleared
    // by nothing except the next attempt, and it used to be rendered in two
    // places — at the foot of the list and inside the sheet. So a failed Join
    // on Summer Streak, followed by opening any other challenge, printed Summer
    // Streak's failure inside that challenge's sheet, under that challenge's
    // title, directly above its own Join button. A member reading it has been
    // told the thing they are looking at did not save, about a thing they
    // never tapped.
    //
    // Retired here rather than in the two handlers, because "the sheet changed"
    // is the one event that covers opening a different challenge, opening the
    // one it is about, and dismissing the sheet altogether. `doJoin` and
    // `doLeave` still clear it on their own way in, so a second attempt does not
    // read the first one's answer. Both controls now live only in the sheet,
    // so the sheet is the one place the notice is drawn.
    setNotice(null);
    if (!open) { boardRun.current += 1; setBoard(EMPTY_BOARD); return; }
    loadBoard(open.id);
    return () => { boardRun.current += 1; };
  }, [open, loadBoard]);

  // Both halves of both sentences used to be the same seven words — "That did
  // not save. Check your connection and try again." — for two opposite events.
  //
  // The first half now names which way round it is. `join` and `leave` both
  // check the rows PostgREST returns, so a false is either a refusal the server
  // read (the challenge closed, a cohort the client is not in, a row already
  // gone) or a request nobody answered; the sheet's Join/Leave control is
  // drawn from `c.joined`, which has not moved either way, so the member is
  // looking at a control that still says what it said before the tap and needs
  // telling which of those two it is.
  //
  // The second half is `retryLine` — src/lib/reachability.ts — for the reason
  // it exists: sending somebody to their router over a refusal the server made
  // hides the answer. app/(client)/bookings.tsx and app/(client)/classes.tsx
  // replaced this exact sentence with it first.
  const doJoin = async (c: ChallengeRow) => {
    setNotice(null);
    const okJoin = await ch.join(c.id);
    if (!okJoin) { setNotice(`You are not on ${c.title}. That did not save, so nothing has changed. ${retryLine(reach)}`); return; }
    notifySuccess();
    if (open && open.id === c.id) loadBoard(c.id);
  };

  const doLeave = async (c: ChallengeRow) => {
    setNotice(null);
    const okLeave = await ch.leave(c.id);
    if (!okLeave) { setNotice(`You are still on ${c.title}. That did not save, so nothing has changed. ${retryLine(reach)}`); return; }
    if (open && open.id === c.id) setOpen(null);
  };

  // The two halves of the list. `shapeChallenges` already sorted the whole
  // set — running first, soonest-to-end at the top; then upcoming; then
  // finished, most recent first — so each half keeps that order by filtering
  // rather than re-sorting.
  const active = ch.challenges.filter((c) => challengePhase(c, nowMs) !== 'finished');
  const completed = ch.challenges.filter((c) => challengePhase(c, nowMs) === 'finished');
  const shown = tab === 'active' ? active : completed;

  /** The row's one caption, and how far along its bar is drawn. */
  const phaseCaption = (c: ChallengeRow): { caption: string; fraction: number } => {
    const phase = challengePhase(c, nowMs);
    // Before the start there is no day to be on, and after the end the day
    // count would only ever say N of N; `windowLine` already has the right
    // words for both — "Starts in 3 days", "Finished yesterday".
    if (phase === 'upcoming') return { caption: windowLine(c, nowMs), fraction: 0 };
    if (phase === 'finished') return { caption: windowLine(c, nowMs), fraction: 1 };
    const { day, total } = dayOf(c, nowMs);
    return { caption: `Day ${num(day)} of ${num(total)}`, fraction: day / total };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board centres this title between the back control and an
            equal space at the trailing edge, so the title sits on the
            screen's axis rather than on the control's. */}
        <PageHead title="Challenges" />

        {/* ── Active / Completed, as the board draws it ─────────────────── */}
        <Segmented style={{ marginTop: sp.lg }} value={tab} onChange={setTab}
          options={[{ key: 'active', label: 'Active' }, { key: 'completed', label: 'Completed' }] as const} />

        {(ch.status === 'loading' && ch.challenges.length === 0) || ch.status === 'error' || (ch.status === 'ready' && shown.length === 0) ? (
        <Section>
          {ch.status === 'loading' && ch.challenges.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.lg }}>Loading your challenges…</Text>
          ) : null}

          {/* A failed read says so and offers a retry. It does NOT say the gym
              is running nothing — that is a claim, and this does not know it. */}
          {ch.status === 'error' ? (
            <View style={{ paddingVertical: sp.lg }}>
              <Text style={{ ...ty.label, color: t.ink2 }}>We couldn’t check which challenges are running.</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>This is a connection problem, not an empty gym.</Text>
              <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
                <Ghost label="Try Again" onPress={ch.reload} />
              </View>
            </View>
          ) : null}

          {/* Safe to say only under 'ready': the server answered, and the
              answer was none. Two sentences, because the two halves are empty
              for different reasons — the server keeps a finished challenge for
              a month and then drops it, so an empty Completed is not "you have
              never finished one". */}
          {ch.status === 'ready' && shown.length === 0 ? (
            <View style={{ paddingVertical: sp.lg }}>
              <Text style={{ ...ty.label, color: t.ink2 }}>
                {tab === 'active' ? 'Nothing is running right now.' : 'Nothing has finished recently.'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                {tab === 'active'
                  ? 'Your gym or your coach sets these up. When one opens it appears here.'
                  : 'A finished challenge stays here for a month after it ends.'}
              </Text>
            </View>
          ) : null}

        </Section>
        ) : null}

        {/* One CARD per challenge (round five): a ring of where its window has
            got to — the day it is on inside the ring, "of 30" under it — the
            name, and its state as chips. The ring is TIME, not score: a member
            three days into thirty is on day three whatever they have logged.
            The whole card opens the sheet — the score, the rank and the
            Join/Leave controls are all in there. The cards below a "we
            couldn’t check" banner are the last thing that was true, and they
            stay: hiding them would say the gym is running nothing, which is
            the claim the provider deliberately refuses to make. The sheet is
            where the controls come off under that read.

            No rank here. A rank comes from `challenge_board()`, which is
            fetched only when a sheet opens and only for a participant; the
            head count is the one fact about other people the LIST read
            establishes, and only under 'ready'. The rank chip is in the sheet. */}
        {shown.map((c) => {
          const { caption, fraction } = phaseCaption(c);
          const phase = challengePhase(c, nowMs);
          const d = phase === 'open' ? dayOf(c, nowMs) : null;
          return (
            <Card key={c.id} onPress={() => setOpen(c)} style={{ marginTop: 14 }}>
              {/* The standing is said here as well as in the sheet, because a
                  sighted reader gets it from the chips and the ring. Only for
                  a joined row: the sentence `standingLine` writes for an
                  unjoined one has an em dash in it where the score would be. */}
              <View accessible accessibilityLabel={`${c.title}. ${caption}.${c.joined ? ` ${standingLine(ch.status, c)}.` : ' Not joined.'} Opens the leaderboard.`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
                <Ring size={84} tone={c.joined ? 'brand' : 'neutral'}
                  value={phase === 'upcoming' ? null : fraction}
                  figure={d ? num(d.day) : phase === 'finished' ? 'Done' : null}
                  sub={d ? `of ${num(d.total)}` : undefined}
                  spoken={caption} />
                <View style={{ flex: 1, minWidth: 0, gap: sp.xs }}>
                  <Text style={{ ...ty.head, color: t.ink }}>{c.title}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{caption}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.xs, marginTop: sp.xs }}>
                    <TonedChip label={c.joined ? 'Joined' : 'Not Joined'} tone={c.joined ? 'brand' : 'neutral'} icon={c.joined ? 'check' : undefined} />
                    {ch.status === 'ready' && c.joined && c.participants > 1 ? (
                      <TonedChip label={`${num(c.participants)} Athletes`} tone="blue" icon="people" />
                    ) : null}
                  </View>
                </View>
                <Icon name={FORWARD_ICON} size={18} color={t.ink3} />
              </View>
            </Card>
          );
        })}

        {/* How scoring works and who sees what: prose, so it is behind a
            control on the list. The visibility sentence is ALSO in the sheet,
            in full, directly above Join — which is where it is owed. */}
        <Section>
          <Expandable title="How Challenges Work" note="Scoring, and what joining shares">
            <Text style={{ ...ty.caption, color: t.ink3 }}>{SCORING_NOTE}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{BOARD_VISIBILITY_NOTE}</Text>
          </Expandable>
        </Section>
      </ScrollView>

      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '80%', ...elevation.e2 }}>
          {sheet && (
            <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{cohortLabel(sheet)} · {windowLine(sheet, nowMs)}</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{sheet.title}</Text>
              {/* The place the SERVER ranked them at, as a chip under the name.
                  Drawn under 'partial' too: `place` is computed over every
                  participant before the page is cut (see `rankLine`), so it is
                  true even when the list under it is not the whole board. */}
              {sheet.joined && (board.status === 'ready' || board.status === 'partial') && board.rows.some((r) => r.isMe) ? (
                <View style={{ marginTop: sp.sm }}>
                  <TonedChip label={`Rank ${num(board.rows.find((r) => r.isMe)!.place)}`} tone="amber" icon="trophy" />
                </View>
              ) : null}
              {sheet.blurb ? <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{sheet.blurb}</Text> : null}

              {/* The score, which the row used to carry and the sheet now
                  does. The meter is only drawn from a score the server
                  computed. A null score under a ready read is rendered as a
                  dash — it must never fall back to zero, which on a board is
                  last. */}
              {ch.status === 'ready' && sheet.myScore != null ? (
                <Meter label="Your Score" val={sheet.myScore} target={sheet.goal} unit={' ' + sheet.unit} dim={!sheet.joined} />
              ) : (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.md }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>Your Score</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                    {scoreText(sheet.metric, null)} / {sheet.goal} {sheet.unit}
                  </Text>
                </View>
              )}

              {/* Only a participant has a board to be ranked on. The effect
                  above fetches one whenever a sheet opens, joined or not, and
                  `challenge_board()` deliberately raises 42501 for everybody
                  else — so this line, ungated, printed "The board could not be
                  read." under every challenge the member had not joined. It is
                  a working refusal being reported as a broken server, sitting
                  directly above the paragraph that correctly explains joining.
                  The error block further down was gated on `joined` for this
                  reason; this line was missed by the same gate.

                  The standing — "12 athletes on this board", or under a read
                  that was not whole, why there is no figure — sits over the
                  rank, because the head count comes from the list read and
                  the rank from the board read, and either can fail alone. */}
              {sheet.joined ? (
                <View style={{ marginTop: sp.md, marginBottom: sp.lg, gap: 4 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{standingLine(ch.status, sheet)}</Text>
                  <Text style={{ ...ty.label, color: t.ink3 }}>{rankLine(board.status, board.rows)}</Text>
                </View>
              ) : null}

              {/* Not on the board yet. challenge_board() refuses with 42501 and
                  its own words rather than answering with an empty list, so
                  "you have not joined" can never be drawn as "nobody is here". */}
              {!sheet.joined ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, marginBottom: sp.lg }}>
                  {/* `scoreText` returns an em dash for a score that could not
                      be worked out, and an em dash is an answer in a slot and a
                      hole in a sentence: this read "your score so far is — days
                      of 20", with a second em dash already in the same sentence
                      four words earlier, so it parsed as a broken clause rather
                      than as a missing figure. Where there is no score the
                      clause is dropped instead of being filled with a dash. */}
                  {sheet.myScore == null
                    ? `Join to see the other athletes. Until you do, this challenge is just you against the goal of ${sheet.goal} ${sheet.unit}. We do not have a score for you yet.`
                    : `Join to see the other athletes. Until you do, this challenge is just you against the goal. Your score so far is ${scoreText(sheet.metric, sheet.myScore)} ${sheet.unit} of ${sheet.goal}.`}
                </Text>
              ) : null}

              {sheet.joined && board.status === 'loading' ? (
                <View style={{ paddingVertical: sp.lg, alignItems: 'flex-start' }}>
                  {/* A spinner is drawn, not spoken. Without a name this View is
                      not in the accessibility tree at all, so the board reads as
                      absent rather than pending — and the sentence under it that
                      says why is only rendered on 'error'. */}
                  <ActivityIndicator color={t.ink3} accessible accessibilityRole="progressbar" accessibilityLabel="Reading the leaderboard…" />
                </View>
              ) : null}

              {sheet.joined && board.status === 'error' ? (
                <View style={{ paddingVertical: sp.md }}>
                  {/* The server's own sentence when it has one. `challenge_board()`
                      raises with words a member can act on — "join the challenge to
                      see who else is on the board" — and this file was printing a
                      hardcoded guess over the top of it and dropping
                      `BoardResult.message` on the floor everywhere. Where there is
                      no message (a network failure, a thrown fetch) the general
                      sentence still stands. */}
                  <Text style={{ ...ty.label, color: t.ink2 }}>{board.message || 'The board could not be read.'}</Text>
                  {board.message ? null : (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                      Nobody has been removed from it. We just could not reach it.
                    </Text>
                  )}
                  <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                    <Ghost label="Try Again" onPress={() => loadBoard(sheet.id)} />
                  </View>
                </View>
              ) : null}

              {/* The rows are drawn under 'partial' as well as under 'ready'.
                  A truncated board is two hundred real athletes with real
                  places, and withholding them would take the leaderboard away
                  to protect a denominator nobody is being shown any more —
                  `rankLine` already drops the "of N" on its own. What the
                  member gets instead is the list plus the sentence saying it
                  does not end where it appears to. */}
              {board.status === 'ready' || board.status === 'partial' ? board.rows.map((r, i) => (
                <View key={`${r.place}-${r.name}-${i}`}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <Text style={{ ...value(15), color: t.ink3, width: 26 }}>{num(r.place)}</Text>
                    <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ ...ty.caption, ...font('500'), color: r.isMe ? t.brand : t.ink2 }}>{r.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <Text style={{ flex: 1, ...ty.body, ...font(r.isMe ? '500' : '400'), color: r.isMe ? t.ink : t.ink2 }}>
                      {r.isMe ? 'You' : r.name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(15), color: t.ink }}>{scoreText(sheet.metric, r.score)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginStart: 3 }}>{sheet.unit}</Text>
                    </View>
                  </View>
                </View>
              )) : null}

              {/* Said at the FOOT of the list as well as at the head of it.
                  The member who needs this sentence is the one who has just
                  scrolled two hundred names looking for their own, and by then
                  `rankLine` is far off the top of the sheet. */}
              {board.status === 'partial' ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  This is the top of the board, not all of it. Everyone who
                  entered is still on it and still being scored.
                </Text>
              ) : null}

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{BOARD_VISIBILITY_NOTE}</Text>

              <View style={{ marginTop: sp.lg }}>
                {/* A control that changes a state the screen has said it
                    cannot see is not offered. The rows behind this sheet stay
                    under a failed or partial read — they are the last thing
                    that was true — and this is where the controls come off. */}
                {!challengeActionsAllowed(ch.status) ? (
                  <Flag tone={t.warn}>{staleChallengeNote(ch.status)}</Flag>
                ) : sheet.joined ? (
                  // "Joined" is a STATUS, and this control does not report it —
                  // it removes the member from the leaderboard, with no
                  // confirmation. A button says what it does.
                  <Ghost label="Leave Challenge" onPress={() => doLeave(sheet)} />
                ) : (
                  <Cta label={challengePhase(sheet, nowMs) === 'upcoming' ? 'Join Early' : 'Join Challenge'} wide disabled={!canJoin(sheet, nowMs)}
                    a11yLabel={`${challengePhase(sheet, nowMs) === 'upcoming' ? 'Join early' : 'Join'}: ${sheet.title}`}
                    onPress={() => doJoin(sheet)} />
                )}
              </View>
              {notice ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>{notice}</Flag>
              ) : null}
              <Pressable onPress={() => setOpen(null)} style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: sp.sm }}>
                <Text style={{ ...ty.label, ...font('500'), color: t.ink3 }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
