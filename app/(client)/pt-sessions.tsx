// Client · Personal training. Sessions your trainer has already delivered, and
// the ones you have confirmed. Mirrors the "sessions delivered → approve" flow
// gyms use.
//
// Approving used to write one flag to AsyncStorage on this device and nothing
// else, and the comment box beside it was never read by anything at all — the
// text went into React state and died there. Both now go to Supabase through
// the `approve_session` RPC, and the trainer sees the confirmation and the
// comment on their calendar.
//
// Still true, and still worth saying on screen: approving does not spend a
// package credit.
//
// WHEN one is spent is no longer a single sentence, and this screen no longer
// pretends otherwise. Since supabase/parts/370 there are three answers — a
// one-off the client books draws at booking, a standing appointment and a
// one-off the coach or the gym books draw at delivery, and a gym-sold PT pass
// always draws at delivery — so the copy here points at the ledger
// (app/(client)/session-credits.tsx) instead of naming a moment that is right
// for one route in three.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero, cards spent only on the sessions you can act
// on, and a coloured dot beside ink text where "Approved ✓" used to be painted
// in the reserved `good` colour.
//
// ── The answer that was missing ────────────────────────────────────────────
//
// This screen offered ONE control: Approve Session. There was no decline, no
// query, no "this didn't happen" — and the coach's pay hangs on that approval,
// which made silence the member's only form of objection. Silence is
// unreadable: a client who was never there and a client who has not opened the
// app produce byte-identical records, so the coach could not tell a dispute
// from a forgetful client and the member could not say the thing they meant.
//
// A dispute is now its own answer (supabase/parts/241, src/lib/sessionDispute).
// THE LOAD-BEARING PART IS WHAT IT DOES NOT DO. It writes to
// `session_approvals` and to nothing else: it does not set `sessions.outcome`,
// which is what payroll reads, so it changes nothing about what the coach is
// paid and it returns no pack credit — the credit came off when the session was
// booked. Every screen here says so before and after the tap, because the gap
// between what a member thinks "Dispute" does and what it does is where the
// next complaint comes from.
//
// A session is in exactly one of three lists, decided by `verdictOf` and never
// by `!approvedAt`. A dispute has NO approval timestamp, so the old branch
// would have put one straight back into "Awaiting Your Approval", which is the
// one place it must never appear.
import { useMemo, useState, useEffect, useCallback } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, TextInput, Alert, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Card, Cta, Ghost, ListRow, Flag, PartialRead, PageHead, SyncBadge, Ring, TonedChip, fig, type Tone } from '../../src/ui/kit';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, radius, hairline, elevation, fontScale, type as ty, numeric, font } from '../../src/theme/scale';
import {
  verdictOf, actionsFor, disputeConfirm, disputeFiledLine, disputedSummary,
  DISPUTE_OPTIONS, DISPUTE_MONEY_NOTE, type DisputeKind,
} from '../../src/lib/sessionDispute';
import { useSessions } from '../../src/ui/sessions';
import { useOutbox } from '../../src/ui/outbox';
import { useClientData } from '../../src/ui/clientData';
import { sessionPacks, myPtPasses, type PtPassRow } from '../../src/lib/connect';
import type { PackBalance } from '../../src/lib/packDraw';
import { withDeadline } from '../../src/lib/readDeadline';
import { useToday, useNow } from '../../src/ui/today';
// Whether a session's time has come and gone. One shared answer, argued in that
// file, rather than a bare `Date.now()` in a memo whose dependency list holds no
// clock — which is what this screen had.
import { hasStarted } from '../../src/lib/upcomingWindow';
// The routed balance, shared with app/(client)/session-credits.tsx and
// app/(client)/packages.tsx so the three screens cannot answer "how many
// sessions can I book" three ways. See its header for what they each used to
// read.
import { bookableCredits, creditsHeroNote, creditsEmptyLine } from '../../src/lib/sessionCredits';
// The record of what became of each session, as opposed to what the member said
// about it. See the note on the "What Already Happened" section below for why
// those are two different lists and not one.
import {
  pastSessions, pastVerdict, readBoundary, emptyHistoryLine,
  PAST_STATE_LABEL, PAST_STATE_NOTE, CLIENT_CANCELLED_GAP_NOTE,
  type PastState,
} from '../../src/lib/sessionHistory';
// The other half of the member's record, and the one this screen used to have
// to apologise for. `CLIENT_CANCELLED_GAP_NOTE` below still says that a booking
// you cancelled yourself is not in the list above it — that remains true, and
// is not fixable, because cancelling nulls `client_id` and the hour goes to
// somebody else. What IS possible is reading the cancellation itself out of the
// table a trigger has been writing all along. See src/lib/sessionCancellations.
import {
  actorOf, actorLine, actionLine, noticeLine, emptyCancellationsLine,
  BEST_EFFORT_NOTE, RECORD_START_NOTE, ENDED_SERIES_NOTE, NOT_A_VERDICT_NOTE,
  type CancelAction,
} from '../../src/lib/sessionCancellations';
// What a session was filed as being worth, read in the row's OWN currency.
// `rate_cents` and `rate_currency` have been on every session row since
// supabase/parts/33 and /1010 and the client mapper dropped both, so the member
// could see that an hour had been delivered and nothing about what it was
// worth. The pair is never split: the integer alone names no money.
import { RATE_MEANING_NOTE, sessionRate } from '../../src/lib/sessionRate';
// ── what was actually done in the hour ────────────────────────────────────
//
// This screen listed the HOUR — booked, delivered, approved, disputed, what it
// was worth — and never once what happened inside it. A member reading "Session
// Not Yet Marked · Tue, Sep 15" had no way from here to reach the five
// exercises their coach had recorded against that day, which is half of the
// report this section answers. `entriesInSession` is the one place the pairing
// rule lives: the link when `workouts.session_id` names the session, and the
// coach's rows on the same local day when nothing does — see its header for why
// the hour cannot be used and the day can.
import { entriesInSession, pairingNote } from '../../src/lib/loggedSession';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { setListLabel } from '../../src/lib/timedSets';
import { liftIn } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { useMyCancellations } from '../../src/ui/cancellations';
import { useAuth } from '../../src/ui/auth';
import { num, fmtRelativeDay, fmtTime } from '../../src/lib/format';
import { appLocale } from '../../src/lib/locale';

/**
 * The date and time beside Approve and Dispute.
 *
 * Two things were wrong with the line this replaces, and they were on the one
 * screen where the member is being asked to agree that an hour was delivered.
 *
 *   · `d.toLocaleDateString()` with no locale and `toLocaleTimeString([], …)`
 *     with an empty one. Both are the device's, which is right today — but the
 *     `dayLabel` twelve lines down already goes through `appLocale()` and says
 *     why in its own comment, so the same screen was formatting two dates two
 *     ways, and `check:locale` exists because that is how "14 Aug" and
 *     "Aug 14" came to sit in the same view.
 *   · No NaN guard. `new Date('')` is an Invalid Date and every one of those
 *     calls returns the literal "Invalid Date", so a session whose start time
 *     did not parse rendered "Invalid Date · Invalid Date" over an Approve
 *     button — and a member cannot approve an hour they cannot identify. A dash
 *     is the honest version: it says nothing rather than saying nonsense, and
 *     `dayLabel` already answers this shape the same way.
 */
const fmt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
};
/** A bare day, for the sentence naming how far back the record has been read.
 *  Through `appLocale()` like every other formatted date in this app — a
 *  hardcoded tag is what `check:locale` exists to refuse. */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * What the record says about a past session, as the approved look's chip: the
 * words on a pale plate of their own hue, in that hue's measured ink.
 *
 * It replaces a 6pt status dot beside grey words. The house rule that made the
 * dot — `t.crit`/`t.warn`/`t.good` are marks and never text — still holds: a
 * chip's label is the tone's INK, which the kit measures, not the mark.
 * 'unmarked' is amber because it is the state that asks somebody to look — the
 * same state that blocks a payroll settlement in src/lib/gymSessions.ts — and
 * a plain cancellation is neutral, because it is a thing that happened rather
 * than a problem. The labels are PAST_STATE_LABEL's words in Title Case: that
 * map is sentence case because it is spliced into prose, and still is below.
 */
const STATE_CHIP: Record<PastState, { label: string; tone: Tone }> = {
  delivered: { label: 'Delivered', tone: 'brand' },
  missed: { label: 'Not Attended', tone: 'red' },
  late_cancelled: { label: 'Cancelled Late', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  unmarked: { label: 'Not Yet Marked', tone: 'amber' },
};

export default function PtSessions() {
  const t = useTheme();
  const router = useRouter();
  // The balance below is handled with three states and a written explanation of
  // why; the DELIVERED SESSIONS list beside it read `sessions` and dropped the
  // provider's `status` on the floor. So a refused read printed "Nothing to
  // approve right now." to a client with three sessions waiting on them — and
  // the coach on the other side, whose pay depends on those approvals, has no
  // way of telling that from a client who simply has not looked.
  const { sessions, status: sessionStatus, approveSession, disputeSession, refresh: refreshSessions } = useSessions();
  const sessionsWhole = isWhole(sessionStatus);
  const c = useClientData();
  /* ── the training that went with the hour ─────────────────────────────────
   *
   * The member's own log, which is where a coach's write-up of a session lands:
   * `workouts` rows against the member with `logged_by` set (supabase/parts/53).
   * Its status matters as much as its rows — an empty log under a failed read
   * would put "Nothing was logged in this session" under an hour that was fully
   * written up, which is the same collapse this whole screen is built to refuse.
   */
  const { log, status: logStatus } = useWorkoutLog();
  const logWhole = isWhole(logStatus);
  const wu = useSettings().weightUnit;
  // The reader's own language for a movement. The stored name is the identity
  // and is untouched; only the sentence moves.
  const { textOf: movement } = useMovementName();
  // Read against the signed-in id rather than `useClientData().id`, which falls
  // back to the literal 'unknown' when Supabase has not answered — a string
  // that matches no row, so the read would come back empty and the screen would
  // tell somebody nothing of theirs had ever been cancelled. Null is the honest
  // value for "we do not know who is signed in", and the hook treats it as
  // "nothing to read about" rather than as an empty record.
  const uid = useAuth().user?.id ?? null;
  const cancels = useMyCancellations(uid);
  const cancelsWhole = isWhole(cancels.status);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Which session the "what is wrong with it" sheet is open for, or null.
  const [disputeFor, setDisputeFor] = useState<string | null>(null);

  // ── the balance, on the screen where somebody is thinking about sessions ──
  //
  // This screen has always sent people to /packages to find out what is left,
  // which is the wrong place to make them look: it is the screen where they
  // approve the sessions that were delivered, so it is the screen where "and
  // how many have I got left" is the next thought.
  //
  // Three states, not two. `left` is `number | null`, and `sessionsRemaining`
  // returns null for a count it could not read — never a fabricated zero. That
  // distinction is the whole reason this is not `useState(0)`:
  //
  //   'loading'  first read still in flight — no figure yet.
  //   number     the database's count. 0 is real and is stated plainly.
  //   null       we could not read it. A dash, and a sentence saying so, so a
  //              client holding ten credits is never shown a zero.
  //
  // ── The read that was missing, and the sentence it produced ───────────
  //
  // This screen read `sessionPacks()` and nothing else. That is
  // `client_purchases` — the packs a COACH sold — and it is only one of the two
  // places a PT credit can come from. A gym sells a PT pass out of `gym_passes`
  // (supabase/parts/370), assigns the member a coach, and the member arrives
  // here holding eight sessions.
  //
  // `packBalance` correctly returns a real 0 for a purchase history that was
  // read and came back empty, so this screen put **0** under "Sessions
  // Remaining" and wrote **"You have not bought a session pack"** underneath
  // it. Both statements were true of `client_purchases` and both were false of
  // the member. `app/(client)/session-credits.tsx` — reading both tables —
  // showed the same person 8 at the same moment.
  //
  // So the balance now comes from `bookableCredits`, which is the composition
  // that screen was already doing inline: route by `chooseRoute` first, then
  // count only what will actually be spent. NOT the sum of the two — an
  // exhausted coach pack still beats a live gym pass, so somebody holding a
  // spent 10-pack and an 8-use gym pass can book nothing, and a hero reading 8
  // would send them to fill a week that ends in eight unpaid hours.
  const [packs, setPacks] = useState<PackBalance | null | undefined>(undefined);
  const [passes, setPasses] = useState<PtPassRow[] | null | undefined>(undefined);
  const loadLeft = useCallback(async () => {
    // One deadline over both, for the reason src/lib/readDeadline.ts gives:
    // neither of these rejects on a socket that is accepted and never answers,
    // so without one a member on gym wifi behind a captive portal waits for
    // ever on a balance they are about to book against.
    const got = await withDeadline(Promise.all([sessionPacks(), myPtPasses()]));
    if (!got.answered) {
      // Only where there was nothing to lose. A pull-to-refresh that stalls
      // over a balance already on screen must not blank it — this is money, and
      // an unread refresh does not mean the credits stopped existing.
      setPacks((v) => (v === undefined ? null : v));
      setPasses((v) => (v === undefined ? null : v));
      return;
    }
    const [p, g] = got.value;
    setPacks(p); setPasses(g);
  }, []);
  useEffect(() => { loadLeft(); }, [loadLeft]);

  // The day a gym pass is judged live against. `useToday`, never a `todayIso`
  // computed once per render: a pass that ran out at midnight decides WHOSE
  // MONEY pays for the next session, and a stale day goes on offering one the
  // gym will refuse at the door.
  const today = useToday();
  // `undefined` is still loading and `null` is a read that did not land, and
  // `bookableCredits` must be given null for both — 'unknown' is its answer to
  // an unread half, and 'unknown' is never a figure.
  const book = useMemo(
    () => bookableCredits(
      packs === undefined ? null : (packs?.lines ?? null),
      passes === undefined ? null : passes,
      today),
    [packs, passes, today]);
  // Three states, not two, and they are three different sentences: nothing has
  // landed yet, we asked and could not get an answer, and here is the number.
  const leftRead = packs !== undefined && passes !== undefined;
  const left = book.left;
  const heroNote = creditsHeroNote(book);
  // What the paying lines were sold as — the ring's whole.
  const soldTotal = (book.lines ?? []).reduce((n, l) => n + l.sessions_total, 0);
  const emptyLine = creditsEmptyLine(book);

  // Two reads: the sessions themselves — including which of them a coach has
  // marked and this member has yet to approve — and the pack balance above
  // them. A session marked delivered while this screen was open is exactly the
  // thing somebody pulls down to see.
  const pull = usePullToRefresh(useCallback(() => {
    void refreshSessions(); void loadLeft(); c.reload(); void cancels.reload();
  }, [refreshSessions, loadLeft, c.reload, cancels]));

  /**
   * The member's sessions that have actually happened — the set the three lists
   * below are cut from, and therefore the set that can be approved or disputed.
   *
   * `nowMs` is a dependency, and its absence was a defect that cost the member
   * their say. The filter used to read `Date.parse(s.startsAt) <= Date.now()`
   * with the clock evaluated in the memo body and no clock in the list, on a
   * screen `app/(client)/_layout.tsx` registers `href: null` — mounted once and
   * never torn down. So the boundary was frozen at whenever Personal Training
   * was first opened. A session that took place AFTER that moment did not
   * appear under "Awaiting Your Approval" at all: the member could not see what
   * their coach had recorded against it and could not dispute it, and an unread
   * session is read by everything downstream as one nobody objected to.
   *
   * It self-healed only if `sessions` happened to change, which is precisely
   * what does not happen on a quiet account.
   */
  const nowMs = useNow().getTime();
  const mine = useMemo(() => sessions
    .filter((s) => s.clientId === c.id && s.status === 'booked' && hasStarted(s.startsAt, nowMs))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)), [sessions, c.id, nowMs]);
  // `verdictOf`, not `!approvedAt`. A disputed session carries no approval
  // timestamp, so the old test would have shown it as still awaiting approval —
  // telling the member their objection went nowhere, and the coach that nobody
  // had answered.
  const verdict = (s: { approvalState?: string | null; approvedAt?: string | null }) =>
    verdictOf({ state: s.approvalState ?? null, approvedAt: s.approvedAt ?? null });
  // The next hour this member has booked and has not begun — the other side of
  // the `hasStarted` boundary `mine` is cut on, so a session is in exactly one
  // of the two. Only off a whole read: see the row it feeds.
  const nextUp = useMemo(() => (sessionStatus !== 'ready' ? null : sessions
    .filter((s) => s.clientId === c.id && s.status === 'booked' && !hasStarted(s.startsAt, nowMs))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null),
  [sessions, sessionStatus, c.id, nowMs]);
  const pending = mine.filter((s) => verdict(s) === 'none');
  const done = mine.filter((s) => verdict(s) === 'approved');
  const disputed = mine.filter((s) => verdict(s) === 'disputed');

  /* ── the record, as distinct from the answer the member gave to it ────────
   *
   * The three lists above are sorted by the MEMBER'S verdict: approved,
   * disputed, or not answered. That is the right shape for the thing this
   * screen does, and it is not a history. A session the coach marked as a
   * no-show and a session nobody has marked at all both sit under "Awaiting
   * Your Approval", identically, because `verdictOf` is not asked what
   * happened — only what the member said.
   *
   * `sessions.outcome` is what happened, and it has been readable on these rows
   * since supabase/parts/33 (the row mapper in src/ui/sessions.tsx was throwing
   * it away; it no longer does). So this list is the same sessions ordered by
   * time with the record beside each, and the member's own verdict shown next
   * to it rather than instead of it. Where they disagree — the coach recorded
   * delivered, the member disputed — BOTH are on the row. Neither is edited.
   *
   * `mine` cannot be reused: it filters `status === 'booked'`, which drops any
   * row whose slot state moved after the fact, and dropping a cancellation from
   * a history is precisely what supabase/parts/195 argues against.
   */
  /* `nowMs` passed, and IN the dependency list. `pastSessions` defaults its
   * second argument to `Date.now()`, so leaving it off put the clock read
   * inside a memo keyed `[sessions, c.id]` — the same defect the `mine` memo
   * above was fixed for, in the same file, one screen apart. It is the
   * UNDER-including direction again: `hasEnded` kept only sessions whose start
   * had passed at the moment this screen first mounted, and this screen is
   * reached from a tab registered `href: null`, so it never unmounts. A session
   * the member took this afternoon was simply absent from their own history —
   * not marked, not disputed, not there — while the coach's copy showed it. */
  const history = useMemo(
    () => pastSessions(sessions.filter((s) => s.clientId === c.id), nowMs),
    [sessions, c.id, nowMs],
  );
  /* How far back these rows actually reach. The provider reads newest-first and
   * capped (src/lib/rowCap.ts), so under 'partial' the cut is at the OLD end of
   * the member's record — and the screen has to say where, or a member who
   * trained through 2024 reads a list that starts in 2025 as their whole
   * history with the gym. */
  const historyEdge = readBoundary(history, sessionStatus === 'partial');

  // Which sessions have an approval sitting in this phone's outbox. Read from
  // the outbox itself — the same items `useSessions` registers the
  // 'pt-approval' handler for — so the mark clears the moment the queue drains.
  // No outbox above this screen is an empty set, not a claim that all was sent:
  // the mark is only ever drawn for an item actually held.
  const outbox = useOutbox();
  const queuedApprovals = useMemo(() => {
    const ids = new Set<string>();
    for (const item of outbox?.pending ?? []) {
      if (item.kind !== 'pt-approval') continue;
      const id = (item.payload as { id?: unknown } | null)?.id;
      if (typeof id === 'string' && id) ids.add(id);
    }
    return ids;
  }, [outbox]);

  const approve = async (id: string) => {
    setBusy(id);
    const r = await approveSession(id, note[id]);
    setBusy(null);
    // Three answers, not two. A queued approval is on this phone and goes on
    // its own — not a failure, and heading it "Not approved" would send
    // somebody back to tap the button again from the same dead spot at
    // reception. The note is cleared either way, because the words are in the
    // queued intent and leaving them in the box would send them twice.
    if (r.queued) {
      setNote((p) => ({ ...p, [id]: '' }));
      Alert.alert('Waiting to Send', r.error || 'This is saved on this phone and goes up when you are back online.');
      return;
    }
    if (!r.ok) { Alert.alert('Not Approved', r.error || 'Could not save that. Try again in a moment.'); return; }
    setNote((p) => ({ ...p, [id]: '' }));
    // Approving spends nothing — the credit came off when the session was
    // booked. The balance is re-read anyway rather than left stale, because
    // the number beside this button is the one the client is checking.
    loadLeft();
    Alert.alert('Approved', 'Your trainer can see this. Approving spends nothing. Session Credits shows what actually paid for each one.');
  };

  /**
   * Disputing, in two steps: pick what is wrong, then confirm what it does.
   *
   * The confirm is not ceremony. It is the only place the member is told, before
   * they commit, that this returns no credit and moves no money — and it is
   * repeated afterwards, because somebody reads one line and puts the phone
   * down. Both sentences come from `src/lib/sessionDispute` so this screen and
   * its tests cannot come to say different things about the member's money.
   */
  const dispute = (id: string, kind: DisputeKind) => {
    const cf = disputeConfirm(kind);
    Alert.alert(cf.title, cf.body, [
      { text: 'Not Now', style: 'cancel' },
      { text: 'Dispute', style: 'destructive', onPress: async () => {
        setBusy(id); setDisputeFor(null);
        const r = await disputeSession(id, kind, note[id]);
        setBusy(null);
        if (!r.ok) {
          Alert.alert('Not Sent', r.error || 'That did not save, so nothing has been recorded and your coach has not been told.');
          return;
        }
        setNote((p) => ({ ...p, [id]: '' }));
        Alert.alert('Disputed', disputeFiledLine(kind));
      } },
    ]);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <PageHead title="Personal Training" subtitle="Sessions your trainer delivered — approve them, or say what is wrong" />

        {/* ── what is left, and where it comes from ───────────────────────
            Loading, unread, empty and a real figure are four states and four
            sentences. They used to be two, decided on whether
            `client_purchases` came back empty — which is how somebody holding a
            gym PT pass was shown a nought and told they had never bought a
            pack. */}
        {!leftRead ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Reading what pays for your sessions…</Text>
        ) : (
          <>
            {/* A figure only over a balance that was read, and it is the balance
                on the route that will actually pay — not the sum of the two,
                and no longer `client_purchases` alone. The note names the
                business whose credit it is, because a coach's pack and a gym's
                PT pass are two different businesses' money and the member is
                owed the name of the one about to be spent. */}
            {left != null && heroNote ? (
              /* The board's figure card — the section's name, the figure at
                 hero size, the note under it — in place of the retired Hero.
                 One spoken sentence for the three, as the Hero grouped them:
                 three stops over one fact is what that grouping avoided. */
              <Section>
                <SectionHead title="Sessions Remaining" onPress={() => router.push('/(client)/session-credits')} />
                {/* As a ring against what was SOLD on the lines that pay —
                    the set `left` is itself summed from, so the arc and the
                    figure are one fact. Sessions are one unit; nothing here
                    adds money. A total of nothing draws the bare track. */}
                <View style={{ flexDirection: fontScale >= 1.35 ? 'column' : 'row', alignItems: 'center', gap: sp.lg }}>
                  <Ring size={124} tone="brand" value={soldTotal > 0 ? left / soldTotal : null}
                    figure={num(left)} sub={soldTotal > 0 ? `of ${num(soldTotal)}` : undefined}
                    spoken={`Sessions remaining, ${num(left)}${soldTotal > 0 ? ` of ${num(soldTotal)}` : ''}. ${heroNote}`} />
                  <Text style={{ ...ty.label, color: t.ink2, flex: fontScale >= 1.35 ? undefined : 1, minWidth: 0 }}>{heroNote}</Text>
                </View>
              </Section>
            ) : null}
            {/* Four sentences where this screen had two, and it picked between
                those two on whether `client_purchases` was empty — which is how
                "You have not bought a session pack" came to be printed to
                somebody holding a gym PT pass. `creditsEmptyLine` decides on
                the ROUTE, so an unread half says so, a member who holds nothing
                is told that plainly and without alarm, and an empty
                entitlement names which one is empty. */}
            {emptyLine ? (
              book.route === 'unknown' || left == null ? (
                <Flag tone={t.crit}>{emptyLine}</Flag>
              ) : book.route === 'none' ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{emptyLine}</Text>
              ) : (
                <Flag tone={t.warn}>{emptyLine}</Flag>
              )
            ) : null}
          </>
        )}

        {/* ── what is next, before what already happened ──────────────────
            The data-layout review asks every scheduling screen to lead with the
            next confirmed booking, and this one — headed Personal Training —
            said nothing about the session a member is about to go to: it began
            at the ones already delivered. One row, off the same `sessions` read
            the rest of the screen uses, and it opens the calendar, which is
            where that booking is changed or cancelled.

            "Next" is a claim about the whole diary, so it is made only off a
            whole read. Under anything else the row still opens the calendar and
            says why it is not naming a time — never "nothing booked" over a
            read that did not land. */}
        <Section>
          <ListRow icon="calendar" tone="brand"
            title={nextUp ? `Next: ${fmtRelativeDay(nextUp.startsAt)} · ${fmtTime(nextUp.startsAt)}` : 'Your Calendar'}
            note={nextUp ? `${nextUp.durationMin} min · confirmed with your coach. Change or cancel it on your calendar`
              : sessionStatus === 'loading' ? 'Reading what you have booked…'
              : !sessionsWhole ? 'What you have booked could not be read in full, so no next session is named here. Nothing has been cancelled.'
              : 'Nothing booked yet. Your coach’s open times are here'}
            onPress={() => router.push('/(client)/calendar')} />
        </Section>

        {/* ── awaiting approval: the only actionable thing here ───────────── */}
        <Section>
          <SectionHead title="Awaiting Your Approval" note={sessionsWhole && pending.length > 0 ? String(pending.length) : undefined} />
          {/* `mine`, not `sessions`. The provider holds every session it could
              read — both parties, every status, cancelled and upcoming included
              — and this screen is about the ones delivered to THIS client
              (`mine`, above). Quoting the provider's count said "Showing the
              first 1,000" to a member with eleven sessions on the screen, which
              reads as a truncation of the eleven. */}
          {sessionStatus === 'partial' ? <PartialRead what="delivered sessions" shown={mine.length} /> : null}
          {pending.map((s) => {
            // WHAT THE COACH RECORDED, on the card that asks the member to
            // approve it. This screen is headed "Sessions your trainer has
            // delivered" and `pending` is sorted by the member's own verdict
            // alone — so a session the coach marked as a NO-SHOW sat here,
            // under that heading, with a primary "Approve Session" button and
            // nothing anywhere saying what the record said. Approving is what
            // releases the fee.
            //
            // The same file computes exactly this forty lines below for the
            // history list. It is the same function, on the card where the
            // decision is actually made.
            const rec = pastVerdict(s);
            return (
            <Card key={s.id} style={{ marginBottom: sp.md }}>
              <Text style={{ ...ty.body, ...numeric, ...font('500'), color: t.ink }}>{fmt(s.startsAt)}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{s.durationMin} min personal training session</Text>
              <View style={{ marginTop: sp.sm, gap: 6 }}>
                <TonedChip {...STATE_CHIP[rec.state]} />
                <Text style={{ ...ty.caption, color: t.ink2 }}>
                  Your trainer recorded this as {PAST_STATE_LABEL[rec.state]}{rec.at ? ` on ${fmt(rec.at)}` : ''}.
                </Text>
              </View>
              {/* An hour the coach's own record says the member missed, with a
                  primary button under it that confirms and pays for it. The
                  button stays — the member may well have been there, and this
                  is the screen where they say so — but never silently. */}
              {rec.state !== 'delivered' && rec.state !== 'unmarked' ? (
                <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                  {PAST_STATE_NOTE[rec.state]} Approving it confirms the session and releases the fee for it. If that is not what happened, dispute it below.
                </Flag>
              ) : null}
              <TextInput value={note[s.id] || ''} onChangeText={(v) => setNote((p) => ({ ...p, [s.id]: v }))}
                placeholder="Add a comment for your trainer (optional)…" placeholderTextColor={t.ink3}
                accessibilityLabel="A comment for your trainer, optional"
                editable={busy !== s.id} multiline
                style={{ ...ty.label, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginTop: sp.md, marginBottom: sp.md }} />
              {/* ── an approval that is on this phone and nowhere else ────────
                  `approveSession` keeps an approval it could not send in the
                  outbox and says so once, in an alert — and then this card went
                  back to looking exactly as it did before the tap: same button,
                  same empty box, nothing saying the answer had been given. The
                  member's next move from there is to approve it again. The
                  state is said ON the session it belongs to (rule 6) with the
                  kit's `SyncBadge` and a sentence under it, and the button stands down while it
                  is true so one session cannot be queued twice. Dispute stays:
                  it is a different answer and the member may still need it. */}
              {queuedApprovals.has(s.id) ? (
                <View style={{ marginBottom: sp.md }}>
                  <SyncBadge state="queued" />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    Your approval is saved on this phone and has not reached your trainer yet. It goes up on its own when you are back online.
                  </Text>
                </View>
              ) : null}
              <Cta label={busy === s.id ? 'Approving…' : queuedApprovals.has(s.id) ? 'Approval Waiting to Send' : 'Approve Session'} wide
                disabled={busy === s.id || queuedApprovals.has(s.id)}
                a11yLabel={queuedApprovals.has(s.id)
                  ? `Approval for the ${s.durationMin} minute session on ${fmt(s.startsAt)} is waiting to send`
                  : `Approve the ${s.durationMin} minute session on ${fmt(s.startsAt)}`}
                onPress={() => approve(s.id)} />
              {/* The other answer, and deliberately NOT a second primary button:
                  approving is the ordinary case and should stay the emphasised
                  one. What matters is that it is here at all, on the same card,
                  in the same moment — a member who has to go and find the
                  objection somewhere else objects by saying nothing. */}
              {actionsFor('none').dispute ? (
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  <Ghost label="Dispute This Session"
                    a11yLabel={`Dispute the ${s.durationMin} minute session on ${fmt(s.startsAt)}`}
                    onPress={() => setDisputeFor(s.id)} />
                </View>
              ) : null}
            </Card>
            );
          })}
          {/* "Nothing to approve right now" is a claim about the coach's
              record, not about this screen, and only a whole read may make it. */}
          {pending.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {/* 'partial' fell through to the confident sentence, and it is
                  the one status where a pending session may simply not have
                  come back — leaving a client told nobody is waiting on them
                  while their coach's pay waits on those approvals. */}
              {sessionStatus === 'loading' ? 'Reading your sessions…'
                : sessionStatus === 'error' ? 'We couldn’t read your sessions, so we can’t say whether your coach is waiting on you. Nothing has been approved or declined by this.'
                : !sessionsWhole ? 'You have more sessions on record than we can read at once, so we can’t say whether one is waiting on you. Nothing has been approved or declined by this.'
                : 'Nothing to approve right now.'}
            </Text>
          ) : null}
        </Section>

        {/* Under the approvals now, not over them: the review's order is state,
            next action, then tools, and these two rows are ways into other
            screens while the block above is the one thing this screen is for.
            Same rows, same routes. */}
        {/* The balance says how many. Which hours used the rest, and which of
            the booked ones are due to draw, are the next two questions and
            they live on the ledger. It reads a gym-sold PT pass and a
            coach-sold pack the same way, so a member assigned a coach by their
            gym gets the same answer as one who buys direct. */}
        <Section>
          <ListRow icon="calendar" tone="blue" title="Session Credits"
            note="Which sessions used a credit, and what your bookings are due to draw"
            onPress={() => router.push('/(client)/session-credits')} />

        {/* The second way into asking, because this is the screen somebody is
            on when they realise there is no session to be seen. The Book screen
            has the other one, beside the open slots it could not offer. The
            note says what it is not, in the row itself, because a row headed
            "Ask for a Time" sitting under a list of credits is otherwise read
            as another way to spend one. */}
          <ListRow icon="clock" tone="teal" title="Ask for a Time"
            note="Ask your coach for an hour they haven’t opened. It asks — it doesn’t book"
            onPress={() => router.push('/(client)/request-session')} />
        </Section>


        {/* ── history ────────────────────────────────────────────────────── */}
        {done.length > 0 ? (
          <>
            <Section>
              <SectionHead title="Approved" note={sessionsWhole ? String(done.length) : undefined} />
              {done.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Text style={{ ...ty.body, ...numeric, color: t.ink2, flex: 1 }}>{fmt(s.startsAt)}</Text>
                      <TonedChip label="Approved" tone="brand" icon="check" />
                    </View>
                    {s.approvalNote ? (
                      <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>“{s.approvalNote}”</Text>
                    ) : null}
                    {/* An approval is not irreversible. Somebody who signs a
                        session off and then checks their diary must be able to
                        say so, and `actionsFor` is the one place that decides
                        which answers each verdict still offers. */}
                    {actionsFor('approved').dispute ? (
                      <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                        <Ghost label="Dispute This Session"
                          a11yLabel={`Dispute the session on ${fmt(s.startsAt)}, which you approved`}
                          onPress={() => setDisputeFor(s.id)} />
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* ── disputed ────────────────────────────────────────────────────
            Its own list, above nothing and below the approvals, because a
            member who has objected wants to see that the objection is still
            standing. Every row says what was disputed, when, and that nothing
            about the money moved — the sentence is the same one the confirm
            used, from the same module. */}
        {disputed.length > 0 ? (
          <>
            <Section>
              <SectionHead title="Disputed" note={sessionsWhole ? String(disputed.length) : undefined} />
              {disputed.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Text style={{ ...ty.body, ...numeric, color: t.ink2, flex: 1 }}>{fmt(s.startsAt)}</Text>
                      {/* Red is "needs you" — and the label is the tone's
                          measured ink, never the status colour as text. */}
                      <TonedChip label="Disputed" tone="red" />
                    </View>
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                      {disputedSummary((s.disputeKind as DisputeKind) ?? 'other', s.disputedAt ? fmt(s.disputedAt) : null)}
                    </Text>
                    {s.approvalNote ? (
                      <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>“{s.approvalNote}”</Text>
                    ) : null}
                    {actionsFor('disputed').approve ? (
                      <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                        {/* Approving IS how a dispute is withdrawn — the RPC
                            clears the three dispute columns (part 241) — so
                            there is no separate "withdraw" verb to get out of
                            step with it. */}
                        <Ghost label="Approve It After All"
                          a11yLabel={`Withdraw your dispute and approve the session on ${fmt(s.startsAt)}`}
                          onPress={() => approve(s.id)} />
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{DISPUTE_MONEY_NOTE}</Flag>
            </Section>
          </>
        ) : null}

        {/* ── what already happened ───────────────────────────────────────
            Every past session in one place, newest first, each with what the
            record says became of it and when. Not a filtered view of the three
            lists above: those are sorted by the member's answer, and a member
            who has never opened this screen has no answers at all — so before
            this section a client could see that a session was booked and could
            not see whether their coach had recorded it as delivered, as a
            no-show, or as nothing yet. */}
        <Section>
          <SectionHead title="What Already Happened"
            note={sessionsWhole && history.length > 0 ? String(history.length) : undefined} />

          {/* Said above the list, not below it. `PartialRead` is the existing
              shape for "this is real but it is not all of it", and it is the
              first thing read rather than a footnote under thirty rows. */}
          {sessionStatus === 'partial' ? <PartialRead what="past sessions" shown={history.length} /> : null}

          {/* Rows under 'error' are whatever this device had before the read
              failed — the provider keeps a cached calendar rather than blanking
              the screen, which is right in a basement gym and wrong to present
              as current. The empty case is handled below by
              `emptyHistoryLine`; this is the other half of the same rule. */}
          {sessionStatus === 'error' && history.length > 0 ? (
            <Flag tone={t.crit}>
              We couldn&apos;t reach the server, so this list is the copy already on this phone. Anything
              recorded since is not on it, and nothing here has been confirmed as still current.
            </Flag>
          ) : null}

          {history.length === 0 ? (
            /* Four statuses, four sentences, and only 'ready' may state that
               nothing has happened. `emptyHistoryLine` holds that rule where a
               test can reach it — an empty history under a failed read telling
               a member their own past is empty is the one outcome this whole
               feature exists to prevent. */
            <Text style={{ ...ty.label, color: t.ink3 }}>{emptyHistoryLine(sessionStatus, 'sessions')}</Text>
          ) : history.map((s, i) => {
            const v = pastVerdict(s);
            // What the session was filed as being worth. Both columns or
            // neither — the integer alone names no money, because the
            // minor-unit factor belongs to the currency and is 1, 100 or 1000.
            // See src/lib/sessionRate.ts and supabase/parts/1010.
            const rate = sessionRate(s.rateCents, s.rateCurrency);
            // The training filed under this hour, and how sure that filing is.
            const paired = entriesInSession(log, { id: s.id, startsAt: s.startsAt, trainerId: s.trainerId });
            const pairNote = pairingNote(paired.by);
            return (
              <View key={s.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ paddingVertical: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <Text style={{ ...ty.body, ...numeric, color: t.ink2, flex: 1 }}>{fmt(s.startsAt)}</Text>
                    <TonedChip {...STATE_CHIP[v.state]} />
                  </View>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                    {PAST_STATE_NOTE[v.state]}
                    {v.at ? ` Recorded ${fmt(v.at)}.` : ''}
                  </Text>
                  {/* The rate, in the ROW's own currency and in no other. A
                      session delivered last year is priced in the money it was
                      priced in then, which is the entire purpose of the
                      snapshot — labelling it with the gym's setting today is the
                      relabelling part 1010 refused to backfill.

                      'none' draws nothing at all: most rows carry no rate and a
                      line on every one of them would bury the 'unstated' case,
                      which is the one that matters. */}
                  {rate.state === 'priced' ? (
                    <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: 4 }}>
                      Recorded at {rate.amount}
                    </Text>
                  ) : rate.note ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{rate.note}</Text>
                  ) : null}
                  {/* The member's own answer, beside the record and never
                      instead of it. A session marked delivered that the member
                      disputed is both things at once, and hiding either half is
                      how one side comes to believe the other agreed. */}
                  {v.disputed ? (
                    <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
                      {disputedSummary((s.disputeKind as DisputeKind) ?? 'other', v.disputedAt ? fmt(v.disputedAt) : null)}
                    </Flag>
                  ) : verdict(s) === 'approved' ? (
                    <View style={{ marginTop: sp.sm }}>
                      <TonedChip label="You Approved This" tone="brand" icon="check" />
                    </View>
                  ) : null}
                  {/* ── what was logged in it ──────────────────────────────
                      The exercises, sets, reps and loads recorded against this
                      hour — the thing this screen has never shown and the
                      thing the member asked for. Drawn only under a WHOLE log
                      read: a short log under this heading is an hour that
                      looks emptier than it was, and "nothing was logged" is a
                      claim about somebody's session that a prefix cannot
                      support. Under anything less the line below says which it
                      is instead of listing rows. */}
                  {logWhole ? (
                    paired.entries.length ? (
                      <View style={{ marginTop: sp.md, gap: sp.xs }}>
                        <Text style={{ ...ty.caption, ...font('600'), color: t.ink2 }}>
                          {paired.by === 'link' ? 'Logged In This Session' : 'Logged On This Day'}
                        </Text>
                        {paired.entries.map((e, j) => (
                          <View key={e.id ?? `${e.t}-${j}`}>
                            <Text style={{ ...ty.label, color: t.ink }}>{movement(e.exercise)}</Text>
                            {e.sets?.length ? (
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                                {setListLabel(e, (kg) => fig(liftIn(kg, wu)), wu)}
                              </Text>
                            ) : e.cardio ? (
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                                {[`${e.cardio.mins} min`, e.cardio.dist > 0 ? `${e.cardio.dist} ${e.cardio.unit}` : null].filter(Boolean).join(' · ')}
                              </Text>
                            ) : null}
                          </View>
                        ))}
                        {/* Said where the list is read, not as a footnote. A
                            day match is a likelihood and the member is looking
                            at it under a heading that names an hour. */}
                        {pairNote ? <Flag tone={t.ink3} style={{ marginTop: sp.xs }}>{pairNote}</Flag> : null}
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                        Nothing was logged against this session. Your coach records what you did from
                        their own app, and not every session is written up.
                      </Text>
                    )
                  ) : (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                      Your training log could not be read in full, so what was logged in this session is
                      not known here. It is missing from this screen rather than from your record.
                    </Text>
                  )}
                </View>
              </View>
            );
          })}

          {/* Said once, and only where a figure was actually drawn. A rate on
              this screen looks like a bill and is not one — Repple takes no PT
              payment and has nowhere to settle one — so a member reading a
              figure without this sentence goes looking for a Pay button that
              does not exist. No total sits beside it either: two sessions in two
              currencies are two amounts and no sum (src/lib/sumCurrency.ts). */}
          {history.some((s) => sessionRate(s.rateCents, s.rateCurrency).state === 'priced') ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{RATE_MEANING_NOTE}</Text>
          ) : null}

          {/* Where the record stops, stated rather than left to be inferred
              from a list that simply ends. Only under 'partial' is there a
              boundary to name; a whole read has none and says nothing, which
              keeps this quiet for every member under the row cap. */}
          {historyEdge.bounded && historyEdge.oldestISO ? (
            <Flag tone={t.warn} style={{ marginTop: sp.md }}>
              This goes back to {dayLabel(historyEdge.oldestISO)} and no further. Anything before that is on
              the server and has not been read onto this screen, so it is missing here rather than absent
              from your record.
            </Flag>
          ) : null}

          {/* The omission that cannot be closed in this app at all, said out
              loud. `cancel_my_session` (supabase/parts/126) hands the hour back
              by clearing `client_id`, so a booking the member cancelled
              themselves stops being theirs and cannot be read back. A list that
              stayed silent about that would be read as complete. */}
          <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{CLIENT_CANCELLED_GAP_NOTE}</Flag>
        </Section>

        {/* ── sessions you cancelled ───────────────────────────────────────
            The other half of the record, and the section the Flag directly
            above now points at.

            ── Why here and not on app/(client)/bookings.tsx ────────────────

            Bookings is the FORWARD half of the member's diary: everything they
            have booked, classes and PT together, in chronological order, with
            Cancel and Move on each row. It is the screen somebody opens to do
            something about an hour that is still coming. A cancellation is a
            thing that has already happened and can no longer be acted on, and
            putting a history of them under a list of live bookings would make
            the two look like the same kind of row — with a Cancel button four
            lines up from hours that are already gone.

            This screen is the member's RECORD of personal training. It already
            has "What Already Happened", and it is the screen that has been
            carrying the apology: `CLIENT_CANCELLED_GAP_NOTE` has said, for as
            long as the section above has existed, that a session the member
            cancelled themselves is not listed. The place to answer that is
            underneath the sentence that admits it.

            ── The list is of ACTIONS, not of hours ─────────────────────────

            A fortnight's pause on a standing appointment is one decision that
            removed several hours, and it is drawn as one entry with the hours
            inside it. Why a shared `cancelled_at` is the test for that, and why
            `was_series` is NOT, is argued in src/lib/sessionCancellations.ts. */}
        <Section>
          <SectionHead title="Sessions You Cancelled"
            note={cancelsWhole && cancels.actions.length > 0 ? String(cancels.actions.length) : undefined} />

          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
            Personal-training hours you had booked that were cancelled — by you, by your coach, or by
            your gym. {NOT_A_VERDICT_NOTE}
          </Text>

          {cancels.status === 'partial'
            ? <PartialRead what="cancelled sessions" shown={cancels.rows.length} onPress={() => { void cancels.reload(); }} />
            : null}

          {/* Rows under 'error' are whatever this device had before the read
              failed. The empty case is handled by `emptyCancellationsLine`
              below; this is the other half of the same rule, and it is the same
              pair of branches the history section above uses. */}
          {cancels.status === 'error' && cancels.rows.length > 0 ? (
            <Flag tone={t.crit}>
              We couldn&apos;t reach the server, so this list is the copy already on this phone. Anything
              cancelled since is not on it.
            </Flag>
          ) : null}

          {/* Who ended them, split rather than added up. A member reading "4
              cancelled" would take every one of them as theirs; two of them may
              have been their coach's, and the record knows which. */}
          {cancelsWhole && cancels.rows.length > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              {`You: ${num(cancels.tally.byClient)} · Your coach: ${num(cancels.tally.byCoach)} · Somebody else: ${num(cancels.tally.byOther)} · Not recorded: ${num(cancels.tally.unattributed)}`}
            </Text>
          ) : null}

          {cancels.actions.length === 0 ? (
            /* Four statuses, four sentences, and only 'ready' may state that
               nothing of yours was ever cancelled. */
            <Text style={{ ...ty.label, color: t.ink3 }}>{emptyCancellationsLine(cancels.status, 'member')}</Text>
          ) : cancels.actions.map((a: CancelAction, i: number) => {
            const said = actorLine(actorOf(a.rows[0]), 'member', '');
            const together = actionLine(a);
            return (
              <View key={a.key}>
                {i > 0 ? <Rule /> : null}
                <View accessible accessibilityRole="text"
                  accessibilityLabel={[`Cancelled ${fmt(a.cancelledAt)}`, said, together ?? '',
                    ...a.rows.map((row) => `${fmt(row.startsAt)}. ${noticeLine(row)}`)].filter(Boolean).join(' ')}
                  style={{ paddingVertical: sp.md }}>
                  <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>{fmt(a.cancelledAt)}</Text>
                  <Text style={{ ...ty.body, ...font('500'), color: t.ink, marginTop: 3 }}>{said}</Text>
                  {together ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{together}</Text>
                  ) : null}
                  {a.rows.map((row) => (
                    <View key={row.id} style={{ marginTop: sp.sm, paddingStart: sp.lg }}>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{fmt(row.startsAt)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{noticeLine(row)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}

          <Flag tone={t.ink3} style={{ marginTop: sp.md }}>{RECORD_START_NOTE}</Flag>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{ENDED_SERIES_NOTE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{BEST_EFFORT_NOTE}</Text>
        </Section>


        <Section>
          <ListRow icon="trophy" title="My Packages & Sessions" note="What you have bought and what is left"
            onPress={() => router.push('/(client)/packages')} />
        </Section>
      </ScrollView>

      {/* ── what is wrong with it ───────────────────────────────────────────
          A sheet rather than an alert, because each option carries a sentence
          saying what it covers and an alert cannot show one. Choosing here does
          not commit: the confirm that follows is where the member is told what
          disputing does to their money, and it is the last thing before the
          write. */}
      <Modal visible={!!disputeFor} transparent animationType="slide" onRequestClose={() => setDisputeFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setDisputeFor(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={{ ...ty.title, color: t.ink }}>What is wrong with this session?</Text>
            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm, marginBottom: sp.lg }}>
              Your coach sees your answer and anything you wrote in the comment box.
            </Text>
            {DISPUTE_OPTIONS.map((o, i) => (
              <View key={o.id}>
                {i > 0 ? <Rule /> : null}
                <Pressable onPress={() => { if (disputeFor) dispute(disputeFor, o.id); }}
                  accessibilityRole="button" accessibilityLabel={o.label} accessibilityHint={o.note}
                  style={{ paddingVertical: sp.md }}>
                  <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{o.label}</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{o.note}</Text>
                </Pressable>
              </View>
            ))}
            <Rule />
            <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{DISPUTE_MONEY_NOTE}</Flag>
            <Pressable onPress={() => setDisputeFor(null)} accessibilityRole="button"
              accessibilityLabel="Close without disputing anything"
              style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, ...font('500'), color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
